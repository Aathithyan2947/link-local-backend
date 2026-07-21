-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "accepted_at" TIMESTAMP(3),
ADD COLUMN     "order_kind" TEXT NOT NULL DEFAULT 'product',
ADD COLUMN     "packaging_charge" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "platform_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rate_amount" DECIMAL(10,2),
ADD COLUMN     "rate_type" TEXT,
ADD COLUMN     "rejected_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "service_categories" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'service';

-- AlterTable
ALTER TABLE "sp_delivery_preferences" ADD COLUMN     "free_delivery_threshold" DECIMAL(10,2),
ADD COLUMN     "order_lead_time_hours" INTEGER,
ADD COLUMN     "packaging_charge" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "sp_rates" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "rate_type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sp_rates_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sp_rates" ADD CONSTRAINT "sp_rates_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
