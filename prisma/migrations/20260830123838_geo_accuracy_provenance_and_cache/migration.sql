-- AlterTable
ALTER TABLE "address_master" ADD COLUMN     "google_place_id" TEXT;

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "accuracy_m" DECIMAL(8,2),
ADD COLUMN     "geocoded_at" TIMESTAMP(3),
ADD COLUMN     "google_place_id" TEXT,
ADD COLUMN     "location_source" TEXT;

-- CreateTable
CREATE TABLE "geocode_cache" (
    "id" SERIAL NOT NULL,
    "lat_key" DECIMAL(10,4) NOT NULL,
    "lng_key" DECIMAL(10,4) NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geocode_cache_expires_at_idx" ON "geocode_cache"("expires_at");

-- CreateIndex
CREATE INDEX "geocode_cache_created_at_idx" ON "geocode_cache"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "geocode_cache_lat_key_lng_key_provider_key" ON "geocode_cache"("lat_key", "lng_key", "provider");
