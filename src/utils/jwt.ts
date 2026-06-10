import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export type Principal = 'user' | 'admin';

export interface TokenPayload {
  sub: number;
  principal: Principal;
  userType?: string; // for users: resident | service_provider | business_listing
  role?: string; // for admins: super_admin | ops_admin
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as SignOptions);
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as unknown as TokenPayload;
}
