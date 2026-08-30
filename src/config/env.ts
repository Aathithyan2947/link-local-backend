import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/api/v1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  CORS_ORIGINS: z.string().default('*'),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
  CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),
  // Google Maps server key, used only for reverse geocoding. Deliberately optional:
  // without it /geo/reverse serves cache-only rather than the whole API refusing
  // to boot, so a missing key degrades one feature instead of the deployment.
  GOOGLE_MAPS_SERVER_KEY: z.string().optional(),
  // Hard ceiling on billed geocoding calls per day. Past it the endpoint serves
  // cache only, so a runaway client or a leaked key cannot run up an open bill.
  GEO_DAILY_LIMIT: z.coerce.number().default(2000),
  // Biases geocoding results to a country. India-only for now.
  GEO_REGION: z.string().default('in'),
  // Set to "true" to return the OTP in the API response even in production
  // (for device testing against a hosted backend before SMS/email is wired up).
  EXPOSE_OTP: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isDev: parsed.data.NODE_ENV === 'development',
  exposeOtp: parsed.data.EXPOSE_OTP === 'true',
  corsOrigins:
    parsed.data.CORS_ORIGINS === '*'
      ? '*'
      : parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()),
};
