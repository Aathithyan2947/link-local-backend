import { z } from 'zod';

/**
 * Strong password policy: 8+ characters with an uppercase letter, a lowercase letter, a number
 * and a special character. Sign-up, password reset and Change Password all use it; the app
 * shows the same messages (`PasswordRules` in password_rules.dart).
 */
export const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password can be at most 72 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a special character');
