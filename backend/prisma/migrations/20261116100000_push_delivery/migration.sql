-- Push delivery: each notification is pushed to the user's phones at most once. `pushed_at` is the claim marker (set when a worker takes it).
ALTER TABLE "notifications" ADD COLUMN "pushed_at" TIMESTAMP(3);
-- Everything that already exists was never meant to be pushed (and must not be, when push is switched on).
UPDATE "notifications" SET "pushed_at" = "created_at";
-- The dispatcher only ever looks at what is still waiting.
CREATE INDEX "notifications_unpushed_idx" ON "notifications" ("created_at") WHERE "pushed_at" IS NULL;
