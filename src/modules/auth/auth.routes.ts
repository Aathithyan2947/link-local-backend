import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { attemptLimiter, codeRequestLimiter } from '../../lib/authLimits.js';
import * as controller from './auth.controller.js';
import {
  adminLoginSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordForgotSchema,
  passwordResetSchema,
  refreshSchema,
  registerSchema,
} from './auth.schema.js';

export const authRouter = Router();

authRouter.post('/register', validate({ body: registerSchema }), controller.register);
authRouter.post('/login', attemptLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/otp/request', codeRequestLimiter, validate({ body: otpRequestSchema }), controller.requestOtp);
authRouter.post('/otp/verify', attemptLimiter, validate({ body: otpVerifySchema }), controller.verifyOtp);
// Forgot password (BUG-066): a code to the account, then a new password with it.
authRouter.post('/password/forgot', codeRequestLimiter, validate({ body: passwordForgotSchema }), controller.requestPasswordReset);
authRouter.post('/password/reset', attemptLimiter, validate({ body: passwordResetSchema }), controller.resetPassword);
authRouter.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
authRouter.post('/admin/login', validate({ body: adminLoginSchema }), controller.adminLogin);
authRouter.get('/me', authenticate('user'), controller.me);
