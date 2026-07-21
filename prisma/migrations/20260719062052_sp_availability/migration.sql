-- CreateTable
CREATE TABLE "sp_availability" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "working_days" INTEGER[],
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "slot_minutes" INTEGER,
    "willing_to_travel" BOOLEAN NOT NULL DEFAULT false,
    "max_travel_km" DECIMAL(5,2),
    "horizon_days" INTEGER NOT NULL DEFAULT 14,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sp_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sp_availability_profile_id_key" ON "sp_availability"("profile_id");

-- AddForeignKey
ALTER TABLE "sp_availability" ADD CONSTRAINT "sp_availability_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
