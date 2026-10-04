-- Strength catches up to the store it mirrors, and the set model is replaced.
--
-- Two mismatches, both because the tables were written before the store existed:
--
-- 1. strength_exercises modelled "exercises logged on a day" — a required day, a
--    name, a position. The store keeps a global list of movements with a usual rep
--    count, a target set count and the weight each is loaded to. The day column is
--    dropped and those three fields added.
--
-- 2. strength_sets held one row per set with a uuid primary key and an FK to the
--    exercise, but a logged set has no identity of its own in the store — it is an
--    array position. Giving every set an id would mean rewriting every strength
--    component to mint and carry one. Instead the whole set array for a movement on
--    a day is one row in strength_logs, keyed by day and exercise, with a single
--    clock: editing today's bench replaces today's bench, last write wins. Coarser
--    than per-set, and enough for one person editing one device at a time.
--
-- Both tables are empty, so nothing is lost. Everything is IF EXISTS/IF NOT EXISTS
-- so a replay after a partial run is a no-op.

ALTER TABLE "strength_exercises" DROP COLUMN IF EXISTS "day";
ALTER TABLE "strength_exercises" ADD COLUMN IF NOT EXISTS "client_id" text;
ALTER TABLE "strength_exercises" ADD COLUMN IF NOT EXISTS "usual_reps" integer DEFAULT 0 NOT NULL;
ALTER TABLE "strength_exercises" ADD COLUMN IF NOT EXISTS "target_sets" integer DEFAULT 0 NOT NULL;
ALTER TABLE "strength_exercises" ADD COLUMN IF NOT EXISTS "weight_lb" real DEFAULT 0 NOT NULL;

ALTER TABLE "strength_exercises" ALTER COLUMN "client_id" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "strength_exercises_user_client_idx"
	ON "strength_exercises" ("user_id", "client_id");

-- Superseded, and empty. Its RLS policies go with it.
DROP TABLE IF EXISTS "strength_sets";

CREATE TABLE IF NOT EXISTS "strength_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"day" date NOT NULL,
	"exercise_client_id" text NOT NULL,
	"sets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE "strength_logs" ADD CONSTRAINT "strength_logs_user_id_profiles_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "strength_logs_user_client_idx"
	ON "strength_logs" ("user_id", "client_id");
CREATE INDEX IF NOT EXISTS "strength_logs_user_day_idx"
	ON "strength_logs" ("user_id", "day");

-- Same RLS as every other synced table: enabled, forced, own rows only.
ALTER TABLE "strength_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strength_logs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "strength_logs_select_own" ON "strength_logs";
CREATE POLICY "strength_logs_select_own" ON "strength_logs" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
DROP POLICY IF EXISTS "strength_logs_insert_own" ON "strength_logs";
CREATE POLICY "strength_logs_insert_own" ON "strength_logs" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
DROP POLICY IF EXISTS "strength_logs_update_own" ON "strength_logs";
CREATE POLICY "strength_logs_update_own" ON "strength_logs" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
DROP POLICY IF EXISTS "strength_logs_delete_own" ON "strength_logs";
CREATE POLICY "strength_logs_delete_own" ON "strength_logs" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
