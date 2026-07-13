import { prisma } from './prisma.js';
import { logger } from './logger.js';

/** Notification categories (mirrors notifications.notification_type in the schema). */
export type NotificationType =
  | 'message'
  | 'enquiry'
  | 'event_invite'
  | 'group_invite'
  | 'event_reminder'
  | 'payment'
  | 'referral'
  | 'order_update'
  | 'admin_email'
  | 'abuse_review'
  | 'profile_verified';

export interface EmitNotificationInput {
  userId: number;
  title: string;
  body?: string;
  type: NotificationType;
  entityType?: string;
  entityId?: number;
}

/**
 * Creates an in-app notification and best-effort triggers a push send.
 * Never throws — a notification failure must not break the parent action.
 */
export async function emitNotification(input: EmitNotificationInput) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        body: input.body,
        notificationType: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
    void sendPush(notification.id, input.userId).catch(() => {});
    return notification;
  } catch (err) {
    logger.error({ err }, 'emitNotification failed');
    return null;
  }
}

/**
 * No-op push adapter for the July MVP. Phase 2 swaps this for FCM/APNs:
 * look up active user_devices, dispatch, then mark notification.isPushed = true.
 */
async function sendPush(_notificationId: number, _userId: number): Promise<void> {
  // TODO(push): FCM/APNs dispatch via user_devices.
}
