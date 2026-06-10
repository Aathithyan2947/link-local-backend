-- CreateTable
CREATE TABLE "city_address_fields" (
    "id" SERIAL NOT NULL,
    "city_id" INTEGER NOT NULL,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "city_address_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "city_address_fields_city_id_field_key_key" ON "city_address_fields"("city_id", "field_key");

-- AddForeignKey
ALTER TABLE "city_address_fields" ADD CONSTRAINT "city_address_fields_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
