-- Habits can be paused for a break.
--
-- A pause is a date range in which the habit is neither due nor missed: the days
-- inside it do not count toward the streak and cannot break it. paused_from is the
-- first paused day; paused_until is the resume day (exclusive), or null for a pause
-- that lasts until the user resumes it explicitly.
--
-- Nulls on every existing row mean "not paused", so nothing needs rewriting.

ALTER TABLE "habits"
	ADD COLUMN IF NOT EXISTS "paused_from" date,
	ADD COLUMN IF NOT EXISTS "paused_until" date;
