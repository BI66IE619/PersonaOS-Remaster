/* A browser whose contexts arrive already signed in.
 *
 * Every page in this app sits behind src/proxy.ts, which redirects anything without
 * a session to the sign-in card. A browser with no cookies therefore cannot reach
 * a single page worth testing, and a suite that navigates anyway is asserting on
 * the sign-in card — which is exactly what test-cold-start.mjs did before this
 * existed: its first checks passed, because the sign-in card reuses the splash's
 * Mark and carries the same data-splash-p attribute, and then it timed out.
 *
 * So the session is loaded from a file that scripts/auth-setup.mjs writes, rather
 * than bypassed. That keeps the auth path under test: the cookies came from a real
 * sign-in against Supabase, through the same endpoint a person uses.
 *
 * Run `node scripts/auth-setup.mjs` first. The session is about an hour old, so a
 * suite that starts reporting the sign-in card where a page should be needs it run
 * again rather than a debug session.
 */

import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const STATE = "playwright/auth.json";

const MISSING = `No saved session at ${STATE}.

Run this first:

    node scripts/auth-setup.mjs

It signs in with TEST_USER_EMAIL / TEST_USER_PASSWORD from .env.local and writes
the session there. Re-run it when it expires, which is about an hour.`;

export function hasSession() {
  return existsSync(STATE);
}

/**
 * chromium.launch(), with storageState folded into every context.
 *
 * Patching newContext rather than exporting a newContext for callers to use means
 * the twenty-odd suites that already had working context options — viewport,
 * colorScheme, reducedMotion — keep them, and keep working, unchanged. A helper
 * that returned a context would have meant editing the option object at every call
 * site, including the two-context ones where the second context is deliberately a
 * different viewport or motion setting.
 *
 * Explicit options win over the session, so a suite that wants a clean context
 * with no cookies can still ask for one by passing storageState: undefined.
 */
export async function launchBrowser() {
  if (!existsSync(STATE)) {
    throw new Error(MISSING);
  }

  const browser = await chromium.launch();
  const newContext = browser.newContext.bind(browser);

  browser.newContext = (options = {}) => newContext({ storageState: STATE, ...options });

  return browser;
}