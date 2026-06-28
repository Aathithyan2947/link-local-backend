-- Enable the "Other" document type for every existing city (idempotent — only inserts where missing).
INSERT INTO "city_allowed_doc_types" ("city_id", "doc_type", "is_active")
SELECT c."id", 'other', true
FROM "cities" c
WHERE NOT EXISTS (
  SELECT 1 FROM "city_allowed_doc_types" d
  WHERE d."city_id" = c."id" AND d."doc_type" = 'other'
);
