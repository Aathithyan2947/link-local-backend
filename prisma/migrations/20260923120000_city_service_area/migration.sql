-- Service area per city: a centre + radius that addresses must fall inside.
ALTER TABLE "cities" ADD COLUMN "center_lat" DECIMAL(10,7),
ADD COLUMN "center_lng" DECIMAL(10,7),
ADD COLUMN "radius_km" DECIMAL(6,2);

-- Seed the active cities. Mumbai deliberately includes Thane (and Navi Mumbai):
-- its existing approved localities all sit in Thane. Vasai-Virar stays separate.
UPDATE "cities" SET "center_lat" = 19.1000000, "center_lng" = 72.9200000, "radius_km" = 25.00 WHERE "name" = 'Mumbai';
UPDATE "cities" SET "center_lat" = 19.4200000, "center_lng" = 72.8200000, "radius_km" = 12.00 WHERE "name" = 'Vasai-Virar';
UPDATE "cities" SET "center_lat" = 28.6139000, "center_lng" = 77.2090000, "radius_km" = 30.00 WHERE "name" = 'Delhi';
