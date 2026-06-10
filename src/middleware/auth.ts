import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken, type TokenPayload } from '../utils/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Requires a valid access token of the given principal(s). */
export const authenticate =
  (...allowed: TokenPayload['principal'][]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) return next(ApiError.unauthorized('Missing access token'));
    try {
      const payload = verifyAccessToken(token);
      if (allowed.length && !allowed.includes(payload.principal)) {
        return next(ApiError.forbidden('Insufficient privileges'));
      }
      req.auth = payload;
      next();
    } catch {
      next(ApiError.unauthorized('Invalid or expired token'));
    }
  };

/** Requires an admin with one of the given roles. */
export const requireAdminRole =
  (...roles: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (req.auth?.principal !== 'admin') return next(ApiError.forbidden());
    if (roles.length && !roles.includes(req.auth.role ?? '')) {
      return next(ApiError.forbidden('Requires role: ' + roles.join(', ')));
    }
    next();
  };
