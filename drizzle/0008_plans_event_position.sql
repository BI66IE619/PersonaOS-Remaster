-- events gains position.
--
-- 0007 is already applied, so this is a new file rather than an edit to it.
--
-- The calendar sorts a day's entries by start time and leaves all-day entries
-- first, and a task list groups by due date — in both cases the order inside a
-- group is the array order, which the device has to be able to reproduce from a
-- pull. That makes the arrangement a real part of the data rather than a
-- side effect of insertion, so it needs a column. It is pushed as the row's
-- index and read back as day, position, client_id: the client_id tie-break is
-- there because two rows can hold the same position — one device pushes an
-- index for a list the other device has never seen — and Postgres is free to
-- return same-position rows in any order it likes.
--
-- DEFAULT 0 for existing rows, which is a real position rather than a null to
-- interpret.

ALTER TABLE "events"
	ADD COLUMN "position" integer DEFAULT 0 NOT NULL;