import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config/env.js';
import { analysisRouter, companiesRouter } from './routes/companies.js';
import { importsRouter } from './routes/imports.js';
import { exportsRouter } from './routes/exports.js';
import { metaRouter } from './routes/meta.js';
import { settingsRouter } from './routes/settings.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // The report endpoint serves its own inline styles, so the default CSP is relaxed only there.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));

  app.use(
    cors({
      origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: false,
    }),
  );

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  if (!config.isProduction) app.use(morgan('dev'));

  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { message: 'Too many requests. Wait a moment and try again.' } },
    }),
  );

  app.use('/api/meta', metaRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/companies', companiesRouter);
  app.use('/api/analyze', analysisRouter);
  app.use('/api/import', importsRouter);
  app.use('/api/export', exportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
