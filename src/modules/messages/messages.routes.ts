import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import * as service from './messages.service.js';

export const messagesRouter = Router();
const auth = authenticate('user');

const sendSchema = z.object({
  receiverId: z.coerce.number().int(),
  content: z.string().min(1).max(4000),
  messageType: z.enum(['direct', 'enquiry']).optional(),
  entityType: z.enum(['sp_profile', 'event', 'group', 'post']).optional(),
  entityId: z.coerce.number().int().optional(),
});

messagesRouter.get('/', auth, asyncHandler(async (req, res) => ok(res, await service.listConversations(req.auth!.sub))));
messagesRouter.get('/unread-count', auth, asyncHandler(async (req, res) => ok(res, await service.unreadCount(req.auth!.sub))));
messagesRouter.get('/:userId', auth, asyncHandler(async (req, res) => ok(res, await service.getThread(req.auth!.sub, Number(req.params.userId)))));
messagesRouter.post('/', auth, validate({ body: sendSchema }), asyncHandler(async (req, res) => ok(res, await service.sendMessage(req.auth!.sub, req.body), 201)));
