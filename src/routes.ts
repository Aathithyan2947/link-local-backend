import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes.js';
import { mastersRouter } from './modules/masters/masters.routes.js';
import { addressesRouter } from './modules/addresses/addresses.routes.js';
import { profilesRouter } from './modules/profiles/profiles.routes.js';
import { homeRouter } from './modules/home/home.routes.js';
import { feedRouter } from './modules/feed/feed.routes.js';
import {
  eventsRouter,
  groupsRouter,
  serviceProvidersRouter,
} from './modules/discovery/discovery.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { mediaRouter } from './modules/media/media.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { messagesRouter } from './modules/messages/messages.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export const router = Router();

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/masters', mastersRouter);
router.use('/addresses', addressesRouter);
router.use('/profiles', profilesRouter);
router.use('/home', homeRouter);
router.use('/posts', feedRouter);
router.use('/events', eventsRouter);
router.use('/groups', groupsRouter);
router.use('/service-providers', serviceProvidersRouter);
router.use('/media', mediaRouter);
router.use('/orders', ordersRouter);
router.use('/messages', messagesRouter);
router.use('/notifications', notificationsRouter);
router.use('/admin', adminRouter);
