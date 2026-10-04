-- Remove the settings that were on mentor_chats, now that mentor_settings exists.
--
-- Dead weight between 0005 and here: 0004 added two booleans to every conversation
-- intending them to carry the sharing switches, and 0005 put the switches where they
-- could actually be written. Nothing has read these columns since 0005, so this drops
-- them.
--
-- Two files rather than one, so 0005 is a pure addition. A migration that both adds
-- the replacement and removes the original cannot be applied by a build that is still
-- reading the original — the deploy would go out in the order the code is built, and
-- the code that compiles against the old columns would fail against a database that
-- had already lost them. Adding first means there is a window where both exist, which
-- is a window where nothing is broken.
--
-- The default is dropped with the column. It was never anything but the answer for a
-- row that had not been written, and a NOT NULL column left behind by a dropped
-- default is a column the next person assumes is required to supply.
ALTER TABLE "mentor_chats"
	DROP COLUMN "share_notes",
	DROP COLUMN "share_events";
