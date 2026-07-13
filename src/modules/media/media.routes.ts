import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { upload, fileUrl } from '../../middleware/upload.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Shared media uploads. Any authenticated user uploads an image here and
 * attaches the returned URL when creating an event / group / product / post.
 */
export const mediaRouter = Router();

// Single file → { url }
mediaRouter.post(
  '/',
  authenticate('user'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('file is required');
    ok(res, { url: fileUrl(req.file.filename) }, 201);
  }),
);

// Multiple files (max 10) → { urls: [] }
mediaRouter.post(
  '/batch',
  authenticate('user'),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw ApiError.badRequest('at least one file is required');
    ok(res, { urls: files.map((f) => fileUrl(f.filename)) }, 201);
  }),
);
