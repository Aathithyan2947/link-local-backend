-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "service_phone" TEXT,
ADD COLUMN     "service_email" TEXT;

-- Backfill from what SPs already entered during onboarding: the basic_details
-- "Service Phone No." / "Service Email" answers, which were collected but never displayed.
-- Matched on field name (case-insensitive) the same way the app resolves these fields.
UPDATE "profiles" p
SET "service_phone" = v."field_value"
FROM "sp_profile_custom_fields" v
JOIN "service_subcategory_fields" f ON f."id" = v."field_id"
WHERE v."profile_id" = p."id"
  AND f."category" = 'basic_details'
  AND (f."field_name" ILIKE '%phone%' OR f."field_name" ILIKE '%mobile%')
  AND btrim(v."field_value") <> ''
  AND p."service_phone" IS NULL;

UPDATE "profiles" p
SET "service_email" = v."field_value"
FROM "sp_profile_custom_fields" v
JOIN "service_subcategory_fields" f ON f."id" = v."field_id"
WHERE v."profile_id" = p."id"
  AND f."category" = 'basic_details'
  AND f."field_name" ILIKE '%email%'
  AND btrim(v."field_value") <> ''
  AND p."service_email" IS NULL;
