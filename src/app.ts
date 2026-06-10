import path from 'node:path';
import { createRequire } from 'node:module';
import express, { type RequestHandler } from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';

// helmet exposes a callable default at runtime, but its package `exports` map omits
// a `types` condition — under strict NodeNext type resolution (some CI, e.g. Vercel)
// the default import resolves to a non-callable namespace. Require it directly so the
// build is portable across environments.
const nodeRequire = createRequire(import.meta.url);
const helmet = nodeRequire('helmet') as (options?: Record<string, unknown>) => RequestHandler;
import { router as apiRouter } from './routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { ok } from './utils/http.js';

export function createApp() {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.corsOrigins === '*' ? true : env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (env.isDev) app.use(morgan('dev'));

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  // Serve uploaded files
  app.use(`/${env.UPLOAD_DIR}`, express.static(path.resolve(process.cwd(), env.UPLOAD_DIR)));

  // Health check
  app.get('/health', (_req, res) => ok(res, { status: 'ok', service: 'link-local-api' }));

  // API
  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
