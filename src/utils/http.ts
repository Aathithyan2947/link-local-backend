import type { Response } from 'express';

/** Standard success envelope. */
export function ok<T>(res: Response, data: T, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Success envelope for paginated lists. */
export function paginated<T>(res: Response, items: T[], meta: PaginationMeta) {
  return res.status(200).json({ success: true, data: items, meta });
}
