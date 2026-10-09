-- When each member last opened Payments (profile badge counts payments after it). Additive only:
-- existing rows get the migration time, so past payments don't show as new.
ALTER TABLE "users" ADD COLUMN "payments_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
