-- CreateTable
CREATE TABLE "address_master" (
    "id" SERIAL NOT NULL,
    "city_id" INTEGER NOT NULL,
    "lane1" TEXT,
    "lane2" TEXT,
    "area" TEXT,
    "suburb" TEXT,
    "pincode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'user',
    "submitted_by" INTEGER,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_master_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "address_master_city_id_status_idx" ON "address_master"("city_id", "status");

-- AddForeignKey
ALTER TABLE "address_master" ADD CONSTRAINT "address_master_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
