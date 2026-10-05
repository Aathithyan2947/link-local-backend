-- Rapid taps used to insert several likes for one person (toggle = check, then insert).
-- Keep each person's earliest like / reaction and drop the rest, then forbid duplicates.
DELETE FROM "post_likes" a
USING "post_likes" b
WHERE a."post_id" = b."post_id" AND a."user_id" = b."user_id" AND a."id" > b."id";

DELETE FROM "post_comment_reactions" a
USING "post_comment_reactions" b
WHERE a."user_id" = b."user_id" AND a."entity_type" = b."entity_type"
  AND a."entity_id" = b."entity_id" AND a."emoji" = b."emoji" AND a."id" > b."id";

-- CreateIndex
CREATE UNIQUE INDEX "post_likes_post_id_user_id_key" ON "post_likes"("post_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_comment_reactions_user_id_entity_type_entity_id_emoji_key" ON "post_comment_reactions"("user_id", "entity_type", "entity_id", "emoji");
