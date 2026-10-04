-- Let mentor conversations follow the user across devices.
--
-- Both tables already existed and were never written to: the app kept every chat in
-- localStorage and /api/sync had no mentor key, so a second device started with an
-- empty recents log. This migration makes the existing tables able to carry what the
-- local record already holds.
--
-- mentor_turns gains client_id because a push has to be idempotent. Every other synced
-- table keys on (user_id, client_id); a turn without one would insert a duplicate every
-- time a sync was retried, and a mentor repeating itself back at you is worse than one
-- that loses a reply.
--
-- mentor_turns also gains updated_at and deleted_at. A turn is append-only in practice —
-- nothing edits the text of a sent message — but the pull is a "everything strictly newer
-- than the cursor" query, and without updated_at a turn written between two pulls would
-- never be offered to the other device at all.
ALTER TABLE "mentor_turns"
	ADD COLUMN "client_id" text,
	ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	ADD COLUMN "deleted_at" timestamp with time zone;

-- The recents log falls back to a preview when a chat has no name, and the name is the
-- user's own typing, so it is stored as given: null rather than an empty string, which
-- are different things on the way back out.
ALTER TABLE "mentor_chats" ADD COLUMN "title" text;

-- Two booleans riding on the chat row. The settings have to live somewhere that syncs,
-- and giving them a table would mean a second row that could be lost independently of
-- the conversations. Both default off, which is what sharing has always meant.
ALTER TABLE "mentor_chats"
	ADD COLUMN "share_notes" boolean DEFAULT false NOT NULL,
	ADD COLUMN "share_events" boolean DEFAULT false NOT NULL;

-- client_id is required before these indexes mean anything, so backfill first. Every
-- pre-existing turn gets a distinct id derived from its own primary key, which makes the
-- backfill idempotent if this file is ever re-run against the same table.
UPDATE "mentor_turns"
SET "client_id" = "id"::text
WHERE "client_id" IS NULL;

-- Backed by the FK, so a turn cannot name a chat that is not there. The FK is not
-- marked NOT VALID because this table has never been written to in production and
-- there is nothing to defer past.
ALTER TABLE "mentor_turns" ALTER COLUMN "client_id" SET NOT NULL;

CREATE UNIQUE INDEX "mentor_chats_client_idx" ON "mentor_chats" USING btree ("user_id","client_id");

CREATE UNIQUE INDEX "mentor_turns_client_idx" ON "mentor_turns" USING btree ("user_id","chat_id","client_id");
