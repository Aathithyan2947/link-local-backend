import { z } from 'zod';

const passwordField = z.string().min(6, 'Password must be at least 6 characters').max(72);

export const registerSchema = z
  .object({
    name: z.string().min(1).max(120),
    email: z.string().email().optional(),
    mobile: z
      .string()
      .regex(/^\+?[0-9]{7,15}$/, 'Invalid mobile number')
      .optional(),
    password: passwordField,
    userType: z.enum(['resident', 'service_provider', 'business_listing']).default('resident'),
    referralCode: z.string().optional(),
    referralSourceId: z.coerce.number().int().optional(),
  })
  .refine((d) => d.email || d.mobile, {
    message: 'Either email or mobile is required',
    path: ['email'],
  });

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or mobile is required'),
  password: passwordField,
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const mobileField = z.string().regex(/^\+?[0-9]{7,15}$/, 'Invalid mobile number');

export const otpRequestSchema = z
  .object({
    mobile: mobileField.optional(),
    email: z.string().email().optional(),
    purpose: z.enum(['registration', 'login']).default('registration'),
    name: z.string().min(1).max(100).optional(),
    userType: z.enum(['resident', 'service_provider', 'business_listing']).optional(),
  })
  .refine((d) => d.mobile || d.email, { message: 'mobile or email required', path: ['mobile'] });

export const otpVerifySchema = z
  .object({
    mobile: mobileField.optional(),
    email: z.string().email().optional(),
    otp: z.string().length(6),
    purpose: z.enum(['registration', 'login']).default('registration'),
    name: z.string().min(1).max(100).optional(),
    userType: z.enum(['resident', 'service_provider', 'business_listing']).default('resident'),
    referralCode: z.string().optional(),
  })
  .refine((d) => d.mobile || d.email, { message: 'mobile or email required', path: ['mobile'] });

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
