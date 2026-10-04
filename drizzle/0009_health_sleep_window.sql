-- The Health Connect tables gain the columns the read path was missing.
--
-- 0000 built health_daily and health_sessions with a day's totals but not the
-- window they happened in, and no heart rate on a session. Both are load-bearing
-- for the provider that reads them, so this is a new file rather than an edit to
-- 0000.
--
-- sleep_start_utc / sleep_end_utc: Vitality shows "9:12 PM -> 6:41 AM" above the
-- sleep bar and derives its staleness chip from when the night ended. A total of
-- 448 minutes cannot produce either — one of them needs the clock time and the
-- other needs a timestamp to compare against now. Null rather than a guess,
-- because a made-up bedtime would render as a real one.
--
-- active_kcal: the day tile shows total calories as BMR plus activity. BMR is
-- estimated from logged weight, but the activity half is measured, and Active
-- Calories Burned is one of the records Health Connect hands over for free.
--
-- avg_hr / max_hr: Workout carries an average and a maximum heart rate, and
-- intensityFromHr buckets the average into the 1-5 scale training load is scored
-- on. Without them every session would score the same and a threshold run would
-- be indistinguishable from a walk. Samsung Health reports both on a Galaxy
-- Fit, so this is real data rather than an estimate.
--
-- All nullable. A watch without a HR sensor sends nothing here, and a partial row
-- is honest where a zero would be a measurement that never happened.

ALTER TABLE "health_daily"
	ADD COLUMN "sleep_start_utc" timestamp with time zone,
	ADD COLUMN "sleep_end_utc" timestamp with time zone,
	ADD COLUMN "active_kcal" real;

ALTER TABLE "health_sessions"
	ADD COLUMN "avg_hr" real,
	ADD COLUMN "max_hr" real;