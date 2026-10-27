import { z } from 'zod';
import { PROFILE_LIMITS } from '../profiles/profiles.schema.js';
import { passwordField } from '../../lib/passwordRules.js';

const emailField = z.string().email('Please enter a valid email address');

// Sign-up name: letters in any language plus spaces and . ' - (no digits or symbols),
// 2–100 characters (the profile name limit). The app's name_rules.dart uses the same rule
// and messages, shown under the field.
const nameField = z
  .string()
  .trim()
  .min(1, 'Enter your name')
  .min(2, 'Name must be at least 2 characters')
  .max(PROFILE_LIMITS.name, `Name can be at most ${PROFILE_LIMITS.name} characters`)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, "Name can only contain letters, spaces and . ' -");

export const registerSchema = z
  .object({
    name: nameField,
    email: emailField.optional(),
    mobile: z
      .string()
      .regex(/^[0-9]{10}$/, 'Mobile number must be 10 digits')
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

const mobileField = z.string().regex(/^[0-9]{10}$/, 'Mobile number must be 10 digits');

export const otpRequestSchema = z
  .object({
    mobile: mobileField.optional(),
    email: emailField.optional(),
    purpose: z.enum(['registration', 'login']).default('registration'),
    name: nameField.optional(),
    userType: z.enum(['resident', 'service_provider', 'business_listing']).optional(),
  })
  .refine((d) => d.mobile || d.email, { message: 'mobile or email required', path: ['mobile'] });

export const otpVerifySchema = z
  .object({
    mobile: mobileField.optional(),
    email: emailField.optional(),
    otp: z.string().length(6),
    purpose: z.enum(['registration', 'login']).default('registration'),
    name: nameField.optional(),
    userType: z.enum(['resident', 'service_provider', 'business_listing']).default('resident'),
    referralCode: z.string().optional(),
    referralSourceId: z.coerce.number().int().optional(),
  })
  .refine((d) => d.mobile || d.email, { message: 'mobile or email required', path: ['mobile'] });

/** The account a password reset is for: its email or 10-digit mobile number. */
const resetIdentifier = z
  .string()
  .trim()
  .min(1, 'Enter your email or mobile number')
  .refine((v) => /^[0-9]{10}$/.test(v) || z.string().email().safeParse(v).success, 'Enter a valid email or 10-digit mobile number');

export const passwordForgotSchema = z.object({ identifier: resetIdentifier });

export const passwordResetSchema = z.object({
  identifier: resetIdentifier,
  otp: z.string().regex(/^[0-9]{6}$/, 'Enter the 6-digit code'),
  newPassword: passwordField,
});

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
