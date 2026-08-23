import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { upload } from '../../middleware/upload.js';
import { uploadBuffer } from '../../lib/cloudinary.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Shared media uploads. Any authenticated user uploads an image here and
 * attaches the returned URL when creating an event / group / product / post.
 */
export const mediaRouter = Router();

const FOLDER_BY_TYPE: Record<string, string> = {
  post: 'link-local/posts',
  event: 'link-local/events',
  group: 'link-local/groups',
  product: 'link-local/products',
};

function resolveMediaFolder(type: unknown): string {
  return (typeof type === 'string' && FOLDER_BY_TYPE[type]) || 'link-local/media';
}

// Single file → { url }
mediaRouter.post(
  '/',
  authenticate('user'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('file is required');
    const folder = resolveMediaFolder(req.body.type);
    const { url } = await uploadBuffer(req.file.buffer, { folder });
    ok(res, { url }, 201);
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
    const folder = resolveMediaFolder(req.body.type);
    const results = await Promise.all(files.map((f) => uploadBuffer(f.buffer, { folder })));
    ok(res, { urls: results.map((r) => r.url) }, 201);
  }),
);
