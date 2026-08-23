import { Readable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { logger } from './logger.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export type CloudinaryResourceType = 'image' | 'video' | 'raw' | 'auto';

/** Uploads a buffer to Cloudinary under the given folder. */
export function uploadBuffer(
  buffer: Buffer,
  opts: { folder: string; resourceType?: CloudinaryResourceType },
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: opts.folder, resource_type: opts.resourceType ?? 'auto' },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error('Cloudinary upload returned no result'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    Readable.from(buffer).pipe(stream);
  });
}

/**
 * Best-effort deletion of a previously uploaded asset, given its stored URL.
 * Never throws — a cleanup failure must not break the caller's request.
 */
export async function destroyByUrl(
  url: string | null | undefined,
  resourceType: 'image' | 'video' | 'raw' = 'image',
): Promise<void> {
  if (!url || !url.includes('res.cloudinary.com')) return;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  const publicId = match?.[1];
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    logger.error({ err, url }, 'cloudinary destroy failed');
  }
}
