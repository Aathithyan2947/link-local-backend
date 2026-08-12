-- CreateTable
CREATE TABLE "sp_product_customizations" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "input_type" TEXT NOT NULL DEFAULT 'toggle',
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sp_product_customizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sp_product_customizations_product_id_idx" ON "sp_product_customizations"("product_id");

-- AddForeignKey
ALTER TABLE "sp_product_customizations" ADD CONSTRAINT "sp_product_customizations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "sp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the previous UI could only ever write these two phrases into
-- sp_products.customization_notes, so they map one-to-one onto structured rows.
-- The column itself is deliberately kept (it holds real data and may carry free text).
INSERT INTO "sp_product_customizations" ("product_id", "label", "input_type", "sort_order")
SELECT "id", 'Eggless', 'toggle', 0
FROM "sp_products"
WHERE "customization_notes" ILIKE '%eggless%';

INSERT INTO "sp_product_customizations" ("product_id", "label", "input_type", "sort_order")
SELECT "id", 'Custom message', 'text', 1
FROM "sp_products"
WHERE "customization_notes" ILIKE '%custom message%';
