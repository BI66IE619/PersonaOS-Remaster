-- Habits can be due on chosen weekdays.
--
-- 1 = Monday … 7 = Sunday, the same ISO numbering the streak maths uses. An empty
-- array means every day, which is what every existing habit becomes, so no row
-- needs rewriting and the streak of an ordinary habit is unchanged.
--
-- jsonb rather than a join table: a schedule has no identity of its own, it is
-- replaced wholesale whenever it changes, and the whole set is at most seven
-- numbers.

ALTER TABLE "habits"
	ADD COLUMN IF NOT EXISTS "schedule" jsonb DEFAULT '[]'::jsonb NOT NULL;
