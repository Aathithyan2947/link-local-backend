-- AlterTable
ALTER TABLE "order_payments" ADD COLUMN     "payment_sub_method" TEXT;

-- AlterTable
ALTER TABLE "referrals" ADD COLUMN     "referred_name" TEXT,
ADD COLUMN     "referred_phone" TEXT;
