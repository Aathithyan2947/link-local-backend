import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

/**
 * Who a sign-in code or password attempt is for: the mobile number or email in the body.
 * Limits are per account rather than per network, so testers on one office connection don't
 * use up each other's attempts, and spreading guesses over many IPs doesn't help.
 */
function accountKey(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const id = [body.identifier, body.mobile, body.email].find((v) => typeof v === 'string' && v.trim());
  return id ? `acct:${(id as string).trim().toLowerCase()}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

const tooMany = (what: string) => ({
  success: false,
  message: `Too many ${what}. Please wait a few minutes and try again.`,
});

/** Sending a code (OTP sign-in/sign-up, password reset): 5 per account per 15 minutes. */
export const codeRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: accountKey,
  message: tooMany('code requests'),
});

/** Trying a code or a password: 10 per account per 15 minutes, so a 6-digit code can't be
 *  guessed in the 10 minutes it lives. */
export const attemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: accountKey,
  message: tooMany('attempts'),
});
