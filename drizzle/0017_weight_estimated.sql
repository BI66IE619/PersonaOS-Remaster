-- Weight readings can be estimates.
--
-- The skip-week button fills a missed Monday from the trend either side of it.
-- Until now that was stored indistinguishably from a real weigh-in, so the screens
-- could not say which number was measured and which was calculated. This flag lets
-- them. Existing rows are all real readings, so the default is false.

ALTER TABLE "weight_log"
	ADD COLUMN IF NOT EXISTS "estimated" boolean DEFAULT false NOT NULL;
