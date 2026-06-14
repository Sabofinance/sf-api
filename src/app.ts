import 'reflect-metadata';

import cors from 'cors';
import express from 'express';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env';
import { createSwaggerSpec } from './docs/swagger';
import { errorHandler } from './middleware/errorHandler';
import { requestMetricsMiddleware } from './middleware/requestMetricsMiddleware';
import { asyncHandler } from './utils/asyncHandler';
import { getDeepHealth } from './modules/reliability/reliability.controller';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();

  app.use(cors({
    origin: env.CORS_ORIGIN.split(','),
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestMetricsMiddleware);

  const swaggerSpec = createSwaggerSpec();
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(apiRouter);

  app.get('/health', asyncHandler(getDeepHealth));

  app.use(errorHandler);

  return app;
}
