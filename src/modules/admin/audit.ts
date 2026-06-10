import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/** Records an admin action in the audit trail (best-effort; never throws). */
export async function writeAudit(
  adminId: number,
  action: string,
  entityType?: string,
  entityId?: number,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        entityType,
        entityId,
        details: details === undefined ? undefined : (details as Prisma.InputJsonValue),
      },
    });
  } catch {
    /* audit logging must not break the request */
  }
}
