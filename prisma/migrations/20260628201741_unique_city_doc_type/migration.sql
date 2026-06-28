-- Defensive: drop any pre-existing duplicates (keep the lowest id per city + docType)
-- so the unique index can be created safely.
DELETE FROM "city_allowed_doc_types" a
USING "city_allowed_doc_types" b
WHERE a."city_id" = b."city_id"
  AND a."doc_type" = b."doc_type"
  AND a."id" > b."id";

-- CreateIndex: a document type may be allowed only once per city.
CREATE UNIQUE INDEX "city_allowed_doc_types_city_id_doc_type_key" ON "city_allowed_doc_types"("city_id", "doc_type");
