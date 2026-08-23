-- AlterTable
ALTER TABLE "profile_privacy_settings" ADD COLUMN     "alert_messages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alert_orders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alert_payments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "contact_visibility" TEXT NOT NULL DEFAULT 'only_me',
ADD COLUMN     "notify_app" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_whatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "profile_visibility" TEXT NOT NULL DEFAULT 'all';
