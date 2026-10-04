import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser-side Supabase client. Singleton: createBrowserClient caches its
 * instance internally, so calling this repeatedly returns the same one.
 *
 * Most of this app will NOT use this. The session lives in cookies, so server
 * components and route handlers read it through lib/supabase/server.ts. This
 * exists for the few places that need auth from a client component — currently
 * just signing in, and reading the session when the UI needs to branch on it.
 */

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}