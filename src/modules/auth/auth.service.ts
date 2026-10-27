import { randomBytes, randomInt } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { signAccessToken, signRefreshToken, type TokenPayload } from '../../utils/jwt.js';
import { logger } from '../../lib/logger.js';
import { creditReferralOnRegistration } from '../referrals/referrals.service.js';
import type {
  AdminLoginInput,
  LoginInput,
  OtpRequestInput,
  OtpVerifyInput,
  PasswordResetInput,
  RegisterInput,
} from './auth.schema.js';

function issueTokens(payload: TokenPayload) {
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

/** Admin-blocked or deactivated accounts can't sign in, by any method, or refresh a session. */
function assertAccountEnabled(account: { isActive: boolean; isBlocked?: boolean }) {
  if (!account.isActive || account.isBlocked) throw ApiError.forbidden('Account is disabled');
}

function generateReferralCode(name: string): string {
  const prefix = name.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'USER';
  return `${prefix}${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Resolves the referring member from a referral code. Throws if the code doesn't match anyone. */
async function resolveReferrer(referralCode?: string): Promise<number | undefined> {
  const code = referralCode?.trim();
  if (!code) return undefined;
  const referrer = await prisma.user.findUnique({ where: { referralCode: code } });
  if (!referrer) throw ApiError.badRequest("That referral code isn't valid. Check the member ID and try again.");
  return referrer.id;
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

  const referredBy = await resolveReferrer(referralCode);

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

  if (referredBy) await creditReferralOnRegistration(referredBy, { id: user.id, mobile: user.mobile ?? null });

  const payload: TokenPayload = { sub: user.id, principal: 'user', userType: user.userType };
  return { user, ...issueTokens(payload) };
}

export async function login(input: LoginInput) {
  const { identifier, password } = input;
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { mobile: identifier }] },
  });
  if (!user || !user.passwordHash) throw ApiError.unauthorized('Invalid credentials');
  assertAccountEnabled(user);

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
          // The app sends a provider with no services back to the services step (BUG-095).
          _count: { select: { serviceTypes: true } },
        },
      },
      stats: true,
    },
  });
  if (!user) throw ApiError.notFound('User not found');
  const { profile, ...rest } = user;
  if (!profile) return { ...rest, profile };
  const { _count, ...profileFields } = profile;
  return { ...rest, profile: { ...profileFields, serviceTypeCount: _count.serviceTypes } };
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

/**
 * Issues a new access token for an already-verified refresh token. Re-reads the account so a
 * block or deactivation ends the session at the next refresh (access tokens last 15 min), and
 * signs the current userType/role rather than the ones copied into the refresh token at login.
 */
export async function refreshAccessToken(payload: TokenPayload) {
  if (payload.principal === 'admin') {
    const admin = await prisma.admin.findUnique({ where: { id: payload.sub }, select: { isActive: true, role: true } });
    if (!admin) throw ApiError.unauthorized('Invalid refresh token');
    assertAccountEnabled(admin);
    return { accessToken: signAccessToken({ sub: payload.sub, principal: 'admin', role: admin.role ?? undefined }) };
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { isActive: true, isBlocked: true, userType: true },
  });
  if (!user) throw ApiError.unauthorized('Invalid refresh token');
  assertAccountEnabled(user);
  return { accessToken: signAccessToken({ sub: payload.sub, principal: 'user', userType: user.userType }) };
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
  // Say so before sending a code; verifyOtp checks again, since that's what issues tokens.
  if (purpose === 'login' && existing) assertAccountEnabled(existing);
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
  const { mobile, email, otp, purpose, name, userType, referralCode, referralSourceId } = input;

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
  if (user) assertAccountEnabled(user);

  if (!user) {
    if (purpose === 'login') throw ApiError.notFound('No account found');
    const referredBy = await resolveReferrer(referralCode);
    user = await prisma.user.create({
      data: {
        mobile,
        email,
        authType: 'otp',
        userType,
        isVerified: false,
        referredBy,
        referralSourceId,
        referralCode: generateReferralCode(name ?? 'User'),
        profile: { create: { name: name ?? 'Member' } },
        stats: { create: {} },
      },
    });
    if (referredBy) await creditReferralOnRegistration(referredBy, { id: user.id, mobile: user.mobile ?? null });
  }

  const payload: TokenPayload = { sub: user.id, principal: 'user', userType: user.userType };
  const safeUser = await prisma.user.findUnique({ where: { id: user.id }, select: userPublicSelect });
  return { user: safeUser, ...issueTokens(payload) };
}

// ── Forgot password ──────────────────────────────────────────
const RESET_CODE_MINUTES = 10;

/** The account a reset is for, by email (any letter case) or mobile number. */
function findByIdentifier(identifier: string) {
  return /^[0-9]{10}$/.test(identifier)
    ? prisma.user.findFirst({ where: { mobile: identifier } })
    : prisma.user.findFirst({ where: { email: { equals: identifier, mode: 'insensitive' } } });
}

/**
 * Sends a code for setting a new password (BUG-066). Answers the same whether or not the
 * account exists, so it can't be used to find out who has one. With no SMS or email provider
 * yet, the code comes back as `devOtp` wherever OTPs are exposed (as for sign-in).
 */
export async function requestPasswordReset(identifier: string) {
  const user = await findByIdentifier(identifier);
  const reply = { sent: true, expiresInSeconds: RESET_CODE_MINUTES * 60 };
  if (!user || !user.isActive || user.isBlocked) return reply;

  // A new code replaces any earlier one.
  await prisma.otpToken.updateMany({
    where: { userId: user.id, purpose: 'password_reset', isUsed: false },
    data: { isUsed: true },
  });
  const otpCode = genOtp();
  await prisma.otpToken.create({
    data: {
      userId: user.id,
      mobile: user.mobile,
      email: user.email,
      otpCode,
      purpose: 'password_reset',
      expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000),
    },
  });
  if (!env.isProd) logger.info(`Password reset code for ${identifier}: ${otpCode}`);
  return { ...reply, ...(env.isProd && !env.exposeOtp ? {} : { devOtp: otpCode }) };
}

/** Sets a new password with the code from [requestPasswordReset]. Works for accounts made
 *  with a one-time code too (they have no password yet), which can then use email login. */
export async function resetPassword(input: PasswordResetInput) {
  const invalid = () => ApiError.badRequest('Invalid or expired code', { otp: ['Invalid or expired code'] });
  const user = await findByIdentifier(input.identifier);
  if (!user) throw invalid();
  const token = await prisma.otpToken.findFirst({
    where: { userId: user.id, purpose: 'password_reset', isUsed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!token || token.otpCode !== input.otp) throw invalid();
  assertAccountEnabled(user);

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.otpToken.update({ where: { id: token.id }, data: { isUsed: true } }),
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, authType: 'password' } }),
  ]);
  return { reset: true };
}
