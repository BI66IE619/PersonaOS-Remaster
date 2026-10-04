-- The mentor's sharing switches, as a row of their own.
--
-- 0004 put them on mentor_chats, one boolean pair per conversation, and that was
-- wrong in a way that only showed up once two devices existed. A switch had nowhere
-- to live on a user with no chats yet, so the first toggle was silently dropped; and
-- because the flags rode on a chat row, they were only ever written when some chat
-- also changed, which a toggle never does. The server's last-write-wins clause then
-- saw an unchanged timestamp and discarded the new value. Turning sharing off did
-- not work anywhere but the device that turned it off.
--
-- One row per user, on its own clock, fixes all three at once: it exists before the
-- first conversation, it is written whether or not any chat moved, and "off" is a
-- value a timestamp can compare rather than an absence of information.
--
-- The booleans on mentor_chats are left in place by this file and dropped by 0006.
-- Splitting it keeps this migration a pure addition, so it cannot take away a column
-- from a build that is still reading it — which is the failure mode of combining
-- "add the right thing" with "remove the wrong thing" in one transaction.
CREATE TABLE "mentor_settings" (
	"user_id" uuid PRIMARY KEY REFERENCES "profiles"("id") ON DELETE CASCADE,
	"share_notes" boolean DEFAULT false NOT NULL,
	"share_events" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Row-level security, in the shape 0001 gave every other table: one policy per
-- operation, each scoped to auth.uid(). The app's own queries run as a role that
-- bypasses RLS, so this is not what scopes them — the user_id in every query is.
-- It is here so this table is not the one place a different set of credentials could
-- read past.
--
-- FORCE, as mentor_chats and mentor_turns both have. Without it the table owner
-- still reads every row, and the owner is the role a connection string grants.
ALTER TABLE "mentor_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mentor_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "mentor_settings_select_own" ON "mentor_settings" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);

CREATE POLICY "mentor_settings_insert_own" ON "mentor_settings" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);

CREATE POLICY "mentor_settings_update_own" ON "mentor_settings" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);

CREATE POLICY "mentor_settings_delete_own" ON "mentor_settings" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
