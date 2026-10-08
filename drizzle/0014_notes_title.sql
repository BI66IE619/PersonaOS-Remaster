-- A journal entry can carry a name.
--
-- Notes are one per day, so a title is optional metadata on an otherwise date-named
-- entry — "The day the offer came through" rather than just a date. Empty rather
-- than null: a note with no title is the normal case, and "" is the value the
-- device already stores, so there is nothing to migrate.
--
-- Bounded at 200 in the route, matching the store's own limit.

ALTER TABLE "notes"
	ADD COLUMN IF NOT EXISTS "title" text DEFAULT '' NOT NULL;
