-- The background health worker gets its own credential.
--
-- The worker used to authenticate by refreshing the Supabase login, which meant the
-- phone had two things refreshing one rotating token: the WebView while the app was
-- open and the worker while it was closed. Whichever refreshed last invalidated the
-- other's copy, the WebView then failed to refresh and signed out, and the user was
-- asked to log in again -- and the worker, with nothing left to refresh, stopped
-- syncing.
--
-- This column holds a SHA-256 hash of a long-lived token minted for the worker
-- alone. It never touches the login, so it can never invalidate it. The token
-- itself is returned to the phone once and never stored here in plaintext.

ALTER TABLE "profiles"
	ADD COLUMN IF NOT EXISTS "ingest_token_hash" text;
