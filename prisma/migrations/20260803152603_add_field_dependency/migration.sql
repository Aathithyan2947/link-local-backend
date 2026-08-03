-- AlterTable
ALTER TABLE "service_subcategory_fields" ADD COLUMN     "depends_on_field_id" INTEGER,
ADD COLUMN     "depends_on_value" TEXT;

-- AddForeignKey
ALTER TABLE "service_subcategory_fields" ADD CONSTRAINT "service_subcategory_fields_depends_on_field_id_fkey" FOREIGN KEY ("depends_on_field_id") REFERENCES "service_subcategory_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;
