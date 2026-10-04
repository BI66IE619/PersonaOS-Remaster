-- Row level security.
--
-- Written by hand rather than generated, because the policy is uniform and
-- the interesting part is the one table that gets none.
--
-- Why this is not optional: the app connects as postgres, which bypasses RLS, so
-- lib/dal.ts's where-clauses are the only thing scoping its queries. That is fine,
-- but Supabase also grants anon and authenticated on tables in public, and the
-- publishable key that identifies those roles is in the client bundle. With RLS off,
-- anyone who opened devtools could read every note, task and transaction in the
-- database. Enabling it costs nothing and closes that regardless of what the
-- application layer does.
--
-- Only authenticated gets a policy, and only for its own rows. anon gets none,
-- so a signed-out request matches no policy and sees nothing -- which is the
-- default-deny that makes enabling RLS meaningful in the first place.
--
-- Separate policies per command rather than one FOR ALL. USING covers reads and
-- deletes; WITH CHECK covers inserts and updates and is what stops a client writing
-- a row into someone else's account. A single ALL policy with only USING would let a
-- write through unconstrained -- the classic way an RLS setup leaks.

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notes_select_own" ON "notes" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "notes_insert_own" ON "notes" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "notes_update_own" ON "notes" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "notes_delete_own" ON "notes" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "checkins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "checkins_select_own" ON "checkins" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "checkins_insert_own" ON "checkins" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "checkins_update_own" ON "checkins" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "checkins_delete_own" ON "checkins" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "habits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "habits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "habits_select_own" ON "habits" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "habits_insert_own" ON "habits" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "habits_update_own" ON "habits" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "habits_delete_own" ON "habits" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "habit_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "habit_days" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "habit_days_select_own" ON "habit_days" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "habit_days_insert_own" ON "habit_days" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "habit_days_update_own" ON "habit_days" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "habit_days_delete_own" ON "habit_days" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "weight_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weight_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "weight_log_select_own" ON "weight_log" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "weight_log_insert_own" ON "weight_log" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "weight_log_update_own" ON "weight_log" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "weight_log_delete_own" ON "weight_log" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tasks_select_own" ON "tasks" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "tasks_insert_own" ON "tasks" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "tasks_update_own" ON "tasks" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "tasks_delete_own" ON "tasks" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "events_select_own" ON "events" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "events_insert_own" ON "events" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "events_update_own" ON "events" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "events_delete_own" ON "events" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "sport_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sport_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sport_sessions_select_own" ON "sport_sessions" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "sport_sessions_insert_own" ON "sport_sessions" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "sport_sessions_update_own" ON "sport_sessions" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "sport_sessions_delete_own" ON "sport_sessions" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "strength_exercises" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strength_exercises" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "strength_exercises_select_own" ON "strength_exercises" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "strength_exercises_insert_own" ON "strength_exercises" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "strength_exercises_update_own" ON "strength_exercises" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "strength_exercises_delete_own" ON "strength_exercises" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "strength_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "strength_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "strength_sets_select_own" ON "strength_sets" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "strength_sets_insert_own" ON "strength_sets" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "strength_sets_update_own" ON "strength_sets" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "strength_sets_delete_own" ON "strength_sets" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "health_daily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_daily" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "health_daily_select_own" ON "health_daily" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "health_daily_insert_own" ON "health_daily" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "health_daily_update_own" ON "health_daily" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "health_daily_delete_own" ON "health_daily" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "health_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "health_sessions_select_own" ON "health_sessions" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "health_sessions_insert_own" ON "health_sessions" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "health_sessions_update_own" ON "health_sessions" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "health_sessions_delete_own" ON "health_sessions" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "finance_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "finance_transactions_select_own" ON "finance_transactions" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "finance_transactions_insert_own" ON "finance_transactions" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "finance_transactions_update_own" ON "finance_transactions" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "finance_transactions_delete_own" ON "finance_transactions" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "finance_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "finance_accounts_select_own" ON "finance_accounts" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "finance_accounts_insert_own" ON "finance_accounts" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "finance_accounts_update_own" ON "finance_accounts" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "finance_accounts_delete_own" ON "finance_accounts" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "mentor_chats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mentor_chats" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mentor_chats_select_own" ON "mentor_chats" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "mentor_chats_insert_own" ON "mentor_chats" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "mentor_chats_update_own" ON "mentor_chats" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "mentor_chats_delete_own" ON "mentor_chats" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "mentor_turns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mentor_turns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mentor_turns_select_own" ON "mentor_turns" FOR SELECT TO authenticated USING (user_id = auth.uid()::uuid);
CREATE POLICY "mentor_turns_insert_own" ON "mentor_turns" FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::uuid);
--> statement-breakpoint
CREATE POLICY "mentor_turns_update_own" ON "mentor_turns" FOR UPDATE TO authenticated USING (user_id = auth.uid()::uuid) WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY "mentor_turns_delete_own" ON "mentor_turns" FOR DELETE TO authenticated USING (user_id = auth.uid()::uuid);
--> statement-breakpoint

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- profiles is keyed on id rather than user_id: the id IS the auth.users id, so the
-- comparison is against the primary key directly.
CREATE POLICY "profiles_select_own" ON "profiles" FOR SELECT TO authenticated USING (id = auth.uid()::uuid);

--> statement-breakpoint
CREATE POLICY "profiles_insert_own" ON "profiles" FOR INSERT TO authenticated WITH CHECK (id = auth.uid()::uuid);

--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" FOR UPDATE TO authenticated USING (id = auth.uid()::uuid) WITH CHECK (id = auth.uid()::uuid);

--> statement-breakpoint

-- finance_connections holds the SimpleFIN access URL, which carries the bank
-- credential in its userinfo segment. It gets RLS enabled and NO policy at all,
-- which means authenticated matches nothing and reads nothing.
--
-- This is the one table that must never be reachable from a client, and the
-- reason it is called out rather than folded into the loop above: RLS with a
-- policy on this table would look correct and still hand out the bank token to
-- anyone holding the publishable key. Reads go through the server-side money
-- sync route using the postgres role, which bypasses RLS -- so nothing in the
-- app stops working.
ALTER TABLE "finance_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "finance_connections" FORCE ROW LEVEL SECURITY;
