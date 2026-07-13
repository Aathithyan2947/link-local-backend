import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

export interface AuditOptions {
  entityType?: string;
  entityId?: number;
  details?: Prisma.InputJsonValue;
}

/**
 * Records an admin action in admin_audit_logs. Never throws — an audit failure
 * must not block the admin operation it describes.
 *
 *   await writeAudit(req.auth!.sub, 'verify_profile', { entityType: 'user', entityId, details: { reason } });
 */
export async function writeAudit(
  adminId: number,
  action: string,
  opts: AuditOptions = {},
): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        details: opts.details,
      },
    });
  } catch (err) {
    logger.error({ err }, 'writeAudit failed');
  }
}
