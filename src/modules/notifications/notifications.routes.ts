import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import * as service from './notifications.service.js';

export const notificationsRouter = Router();
const auth = authenticate('user');

notificationsRouter.get('/', auth, asyncHandler(async (req, res) => ok(res, await service.listNotifications(req.auth!.sub))));
notificationsRouter.get('/unread-count', auth, asyncHandler(async (req, res) => ok(res, await service.unreadCount(req.auth!.sub))));
notificationsRouter.patch('/read-all', auth, asyncHandler(async (req, res) => ok(res, await service.markAllRead(req.auth!.sub))));
notificationsRouter.patch('/:id/read', auth, asyncHandler(async (req, res) => ok(res, await service.markRead(req.auth!.sub, Number(req.params.id)))));
