-- AlterTable
ALTER TABLE "profile_privacy_settings" ADD COLUMN     "show_call_button" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "service_subcategory_fields" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'basic_details';
