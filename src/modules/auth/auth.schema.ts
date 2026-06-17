import { z } from 'zod';

// Strong password policy: 8+ chars with at least one uppercase, one lowercase, one number
// and one special character.
const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72)
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a special character');

const emailField = z.string().email('Please enter a valid email address');

export const registerSchema = z
  .object({
    name: z.string().min(1).max(120),
    email: emailField.optional(),
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
  // Login only checks presence — the strong-password policy applies at registration.
  password: z.string().min(1, 'Password is required'),
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
    email: emailField.optional(),
    purpose: z.enum(['registration', 'login']).default('registration'),
    name: z.string().min(1).max(100).optional(),
    userType: z.enum(['resident', 'service_provider', 'business_listing']).optional(),
  })
  .refine((d) => d.mobile || d.email, { message: 'mobile or email required', path: ['mobile'] });

export const otpVerifySchema = z
  .object({
    mobile: mobileField.optional(),
    email: emailField.optional(),
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
