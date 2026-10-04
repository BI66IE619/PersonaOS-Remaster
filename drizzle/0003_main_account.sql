-- Let the user nominate one account as the primary spending account.
--
-- Null means unchosen, and every account contributes to the month's figures. That
-- is the behaviour from before this column, so an existing connection keeps working
-- without a migration step. Defaulting to a guessed account instead would let the
-- wrong one silently drive the category chart and the net figure.
ALTER TABLE "finance_connections" ADD COLUMN "main_account_id" text;