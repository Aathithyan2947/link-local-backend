-- Map position of an event's location when picked from place search (null when typed).
ALTER TABLE "events" ADD COLUMN "latitude" DECIMAL(10,7),
ADD COLUMN "longitude" DECIMAL(10,7),
ADD COLUMN "google_place_id" TEXT;
