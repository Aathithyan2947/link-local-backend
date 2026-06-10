import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import * as controller from './auth.controller.js';
import {
  adminLoginSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  registerSchema,
} from './auth.schema.js';

export const authRouter = Router();

authRouter.post('/register', validate({ body: registerSchema }), controller.register);
authRouter.post('/login', validate({ body: loginSchema }), controller.login);
authRouter.post('/otp/request', validate({ body: otpRequestSchema }), controller.requestOtp);
authRouter.post('/otp/verify', validate({ body: otpVerifySchema }), controller.verifyOtp);
authRouter.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
authRouter.post('/admin/login', validate({ body: adminLoginSchema }), controller.adminLogin);
authRouter.get('/me', authenticate('user'), controller.me);
