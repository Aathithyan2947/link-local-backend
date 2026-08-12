-- Move the menu/date feature flag out of ServiceSubcategory.type and into the field system,
-- so every onboarding step is configured the same way (Basic Details / Travel / Service Type).
--
-- resolveProviderFeatures used to OR two signals; after this it reads fields only. Ten live
-- subcategories carried the flag ONLY on the column, so without this backfill every food SP
-- would lose their menu and cart, and Tutor would lose slot booking.

-- 1. Give each column-flagged subcategory a marker field, unless it already has one.
INSERT INTO "service_subcategory_fields"
  ("subcategory_id", "field_name", "field_type", "category", "is_required", "sort_order", "is_active")
SELECT s."id",
       CASE WHEN s."type" = 'menu' THEN 'Menu items' ELSE 'Availability' END,
       -- 'booking', not 'date': fieldType 'date' is a date QUESTION that renders a picker.
       -- Reusing it as the feature marker meant any date question silently switched on slot
       -- booking for the whole subcategory.
       CASE WHEN s."type" = 'menu' THEN 'menu' ELSE 'booking' END,
       'service_type',
       false,
       0,
       true
FROM "service_subcategories" s
WHERE s."type" IN ('menu', 'date')
  AND NOT EXISTS (
    SELECT 1 FROM "service_subcategory_fields" f
    WHERE f."subcategory_id" = s."id" AND f."is_active" = true
      AND f."field_type" = CASE WHEN s."type" = 'menu' THEN 'menu' ELSE 'booking' END
  );

-- 2. Markers created before this lived under whatever category the admin picked; normalise
--    them so the feature is always configured under Service Type.
UPDATE "service_subcategory_fields"
SET "category" = 'service_type'
WHERE "field_type" IN ('menu', 'booking')
  AND "category" <> 'service_type';
