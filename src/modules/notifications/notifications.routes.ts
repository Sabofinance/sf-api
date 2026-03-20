import { Router } from 'express';

import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { listNotifications, markRead, markAllRead } from './notifications.controller'

export const notificationsRouter = Router();

notificationsRouter.use(authMiddleware);

notificationsRouter.get('/', asyncHandler(listNotifications));
notificationsRouter.post('/mark-all-read', asyncHandler(markAllRead));
notificationsRouter.patch('/:id/read', asyncHandler(markRead));