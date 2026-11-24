-- A check-in can carry a hand-entered night's sleep.
--
-- When the watch is off for a night, the user can type the amount on that day's
-- check-in. It is used for the sleep trend and debt only; the readiness score keeps
-- using watch-measured nights, because a number with no stages or window is not
-- something it can score honestly.
--
-- Nullable: most days have no manual entry.

ALTER TABLE "checkins"
	ADD COLUMN IF NOT EXISTS "sleep_min" integer;
