import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import { ApiError } from '../../utils/ApiError.js';
import { verifyRefreshToken, type TokenPayload } from '../../utils/jwt.js';
import * as authService from './auth.service.js';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body);
  ok(res, result, 201);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body);
  ok(res, result);
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getMe(req.auth!.sub);
  ok(res, user);
});

export const adminLogin = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.adminLogin(req.body);
  ok(res, result);
});

export const requestOtp = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await authService.requestOtp(req.body));
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await authService.verifyOtp(req.body));
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  let payload: TokenPayload;
  try {
    payload = verifyRefreshToken(req.body.refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid refresh token');
  }
  // Outside the try: a disabled account must surface as its own 403, not "Invalid refresh token".
  ok(res, await authService.refreshAccessToken(payload));
});
