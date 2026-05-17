import 'reflect-metadata';

import cors from 'cors';
import express, { type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';


import { env } from './config/env';
import { createSwaggerSpec } from './docs/swagger';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();

  const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
  app.use(cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? '*' : corsOrigins,
    credentials: corsOrigins[0] !== '*',
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  const swaggerSpec = createSwaggerSpec();
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(apiRouter);

  app.get('/health', (_req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      data: { status: 'ok' },
      meta: {},
      error: null,
    });
  });

  app.use(errorHandler);

  return app;
}

