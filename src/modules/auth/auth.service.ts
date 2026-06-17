import { randomBytes, randomInt } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { signAccessToken, signRefreshToken, type TokenPayload } from '../../utils/jwt.js';
import { logger } from '../../lib/logger.js';
import type {
  AdminLoginInput,
  LoginInput,
  OtpRequestInput,
  OtpVerifyInput,
  RegisterInput,
} from './auth.schema.js';

function issueTokens(payload: TokenPayload) {
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

function generateReferralCode(name: string): string {
  const prefix = name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'USER';
  return `${prefix}${randomBytes(3).toString('hex').toUpperCase()}`;
}

const userPublicSelect = {
  id: true,
  mobile: true,
  email: true,
  userType: true,
  referralCode: true,
  isVerified: true,
  isActive: true,
  createdAt: true,
  profile: { select: { id: true, name: true, photoUrl: true } },
} as const;

export async function register(input: RegisterInput) {
  const { name, email, mobile, password, userType, referralCode, referralSourceId } = input;

  const existing = await prisma.user.findFirst({
    where: { OR: [email ? { email } : undefined, mobile ? { mobile } : undefined].filter(Boolean) as object[] },
  });
  if (existing) throw ApiError.conflict('An account with this email or mobile already exists');

  let referredBy: number | undefined;
  if (referralCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode } });
    if (referrer) referredBy = referrer.id;
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      mobile,
      passwordHash,
      authType: 'password',
      userType,
      referredBy,
      referralSourceId,
      referralCode: generateReferralCode(name),
      profile: { create: { name } }, // user's display name lives on the profile
      stats: { create: {} },
    },
    select: userPublicSelect,
  });

  const payload: TokenPayload = { sub: user.id, principal: 'user', userType: user.userType };
  return { user, ...issueTokens(payload) };
}

export async function login(input: LoginInput) {
  const { identifier, password } = input;
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { mobile: identifier }] },
  });
  if (!user || !user.passwordHash) throw ApiError.unauthorized('Invalid credentials');
  if (!user.isActive || user.isBlocked) throw ApiError.forbidden('Account is disabled');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Invalid credentials');

  const payload: TokenPayload = { sub: user.id, principal: 'user', userType: user.userType };
  const safeUser = await prisma.user.findUnique({ where: { id: user.id }, select: userPublicSelect });
  return { user: safeUser, ...issueTokens(payload) };
}

export async function getMe(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...userPublicSelect,
      profile: {
        select: {
          id: true,
          name: true,
          photoUrl: true,
          aboutMe: true,
          gender: true,
          address: {
            select: {
              id: true,
              fullAddress: true,
              area: { select: { areaName: true, city: { select: { name: true, state: true } } } },
            },
          },
        },
      },
      stats: true,
    },
  });
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

export async function adminLogin(input: AdminLoginInput) {
  const admin = await prisma.admin.findUnique({ where: { email: input.email } });
  if (!admin || !admin.isActive) throw ApiError.unauthorized('Invalid credentials');
  const valid = await verifyPassword(input.password, admin.password);
  if (!valid) throw ApiError.unauthorized('Invalid credentials');

  const payload: TokenPayload = { sub: admin.id, principal: 'admin', role: admin.role ?? undefined };
  const { password: _pw, ...safe } = admin;
  return { admin: safe, ...issueTokens(payload) };
}

// ── OTP (dev mode) ───────────────────────────────────────────
function genOtp(): string {
  return randomInt(100000, 1000000).toString();
}

export async function requestOtp(input: OtpRequestInput) {
  const { mobile, email, purpose } = input;

  const existing = await prisma.user.findFirst({
    where: { OR: [mobile ? { mobile } : undefined, email ? { email } : undefined].filter(Boolean) as object[] },
  });
  if (purpose === 'login' && !existing) {
    throw ApiError.notFound('No account found. Please sign up first.');
  }
  // Registering with an already-used mobile/email must NOT silently log into the existing
  // account (which would ignore the new name). Stop here and ask them to log in instead.
  if (purpose === 'registration' && existing) {
    throw ApiError.conflict(
      `An account with this ${mobile ? 'mobile number' : 'email'} already exists. Please log in.`,
    );
  }

  const otpCode = genOtp();
  await prisma.otpToken.create({
    data: {
      userId: existing?.id,
      mobile,
      email,
      otpCode,
      purpose,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  // In production this would be sent via SMS/email. For now we log it, and also
  // return it when not in production OR when EXPOSE_OTP=true (device testing).
  logger.info(`OTP for ${mobile ?? email} (${purpose}): ${otpCode}`);
  return {
    sent: true,
    expiresInSeconds: 600,
    ...(env.isProd && !env.exposeOtp ? {} : { devOtp: otpCode }),
  };
}

export async function verifyOtp(input: OtpVerifyInput) {
  const { mobile, email, otp, purpose, name, userType, referralCode } = input;

  const token = await prisma.otpToken.findFirst({
    where: {
      purpose,
      isUsed: false,
      expiresAt: { gt: new Date() },
      ...(mobile ? { mobile } : {}),
      ...(email ? { email } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!token || token.otpCode !== otp) throw ApiError.unauthorized('Invalid or expired OTP');
  await prisma.otpToken.update({ where: { id: token.id }, data: { isUsed: true } });

  let user = await prisma.user.findFirst({
    where: { OR: [mobile ? { mobile } : undefined, email ? { email } : undefined].filter(Boolean) as object[] },
  });

  // Defense-in-depth: never let a registration verify into an existing account.
  if (user && purpose === 'registration') {
    throw ApiError.conflict(
      `An account with this ${mobile ? 'mobile number' : 'email'} already exists. Please log in.`,
    );
  }

  if (!user) {
    if (purpose === 'login') throw ApiError.notFound('No account found');
    let referredBy: number | undefined;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode } });
      if (referrer) referredBy = referrer.id;
    }
    user = await prisma.user.create({
      data: {
        mobile,
        email,
        authType: 'otp',
        userType,
        isVerified: false,
        referredBy,
        referralCode: generateReferralCode(name ?? 'User'),
        profile: { create: { name: name ?? 'Member' } },
        stats: { create: {} },
      },
    });
  }

  const payload: TokenPayload = { sub: user.id, principal: 'user', userType: user.userType };
  const safeUser = await prisma.user.findUnique({ where: { id: user.id }, select: userPublicSelect });
  return { user: safeUser, ...issueTokens(payload) };
}
