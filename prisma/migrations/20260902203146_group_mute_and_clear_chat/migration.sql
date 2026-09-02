-- AlterTable
ALTER TABLE "interest_group_members" ADD COLUMN     "chat_cleared_at" TIMESTAMP(3),
ADD COLUMN     "muted" BOOLEAN NOT NULL DEFAULT false;
