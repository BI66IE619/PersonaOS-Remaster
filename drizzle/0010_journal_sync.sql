-- Notes gain tags; check-ins gain soreness.
--
-- Both tables were created for an earlier shape of the two stores and have since
-- drifted. Notes grew a tag list on the device that has nowhere to live here, and
-- the check-in moved from free text plus mood/energy to the three 1-5 scales with
-- no text at all. Syncing either without these columns would silently drop the
-- part of the record the user actually looks at.
--
-- tags is jsonb rather than text[] so the array round-trips as JSON without a
-- driver-level array encoder, and defaulted to '[]' so existing rows read as "no
-- tags" rather than null. soreness is nullable: an old check-in that never rated
-- it, and a new one where the user left that scale blank, are the same thing here.
--
-- The text column on checkins is left in place. It is not written by the app any
-- more, but dropping a NOT NULL column is a destructive migration for a field
-- that costs nothing to keep, and "mood/energy/soreness" is the whole record.

ALTER TABLE "notes"
	ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "checkins"
	ADD COLUMN "soreness" integer;
