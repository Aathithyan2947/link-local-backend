-- Add the "Referred by a user" referral source so members can credit who referred them.
INSERT INTO "referral_sources" ("source", "label")
SELECT 'user_id', 'Referred by a user'
WHERE NOT EXISTS (
  SELECT 1 FROM "referral_sources" WHERE "source" = 'user_id'
);
