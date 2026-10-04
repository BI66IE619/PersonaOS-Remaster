/* Signs in once and saves the session for every other script to reuse.
 *
 * The app gates every page behind src/proxy.ts, so a browser with no session gets
 * redirected to the sign-in card and no suite can reach the pages they are
 * testing. Rather than bypass that — which would mean a code path that skips auth,
 * and that path would then exist in production — this signs in for real, through
 * the same route the sign-in card posts to, and writes the resulting cookies to a
 * file the other scripts load.
 *
 * It posts a password rather than clicking through Google because Google cannot be
 * automated: the consent screen needs a real account picker and a real human. The
 * password route is not a bypass — it calls Supabase's signInWithPassword and gets
 * the same verified session the OAuth flow produces. It is behind EMAIL_SIGNIN, so
 * it is a 404 unless that flag is on.
 *
 *   node scripts/auth-setup.mjs
 *
 * Writes playwright/auth.json, which is gitignored: it holds live session cookies.
 * The session is about an hour old, so a suite that starts reporting the sign-in
 * card where a page should be wants this re-run, not a debug session.
 */

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loadEnvFile } from "node:process";

/* Node's own loader, not dotenv — one less dependency, and it reads the same file
 * Next does. */
loadEnvFile(".env.local");

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const email = process.env.TEST_USER_EMAIL;
const password = process.env.TEST_USER_PASSWORD;

if (!email || !password) {
  console.error(
    "TEST_USER_EMAIL and TEST_USER_PASSWORD are not set.\n" +
      "Add them to .env.local, along with EMAIL_SIGNIN=1 so the password route exists.",
  );
  process.exit(1);
}

const OUT_DIR = "playwright";
const OUT = `${OUT_DIR}/auth.json`;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

/* Straight to the route, not through the card. The card renders the form only when
 * NEXT_PUBLIC_EMAIL_SIGNIN is set, and going through it would make this script
 * depend on a UI that is off by default — so a missing form would look like a
 * broken password rather than a missing flag. */
await page.goto(`${BASE}/`, { waitUntil: "load" });
const result = await page.evaluate(
  async ({ email, password }) => {
    const body = new URLSearchParams({ email, password });
    const res = await fetch("/auth/password", {
      method: "POST",
      body,
      /* manual, so the 302 comes back here instead of the browser following it.
       * The Set-Cookie on that response is the whole point of this, and a followed
       * redirect would land on /home before we had looked. */
      redirect: "manual",
    });
    return { status: res.status };
  },
  { email, password },
);

if (result.status === 404) {
  console.error("/auth/password returned 404 — EMAIL_SIGNIN is not set to 1.");
  console.error("Add EMAIL_SIGNIN=1 to .env.local and restart the dev server.");
  await browser.close();
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
await context.storageState({ path: OUT });

const cookies = await context.cookies();
const session = cookies.find((c) => c.name.startsWith("sb-"));
if (!session) {
  console.error("Posted to /auth/password but no Supabase session cookie was set.");
  console.error("Either the password was wrong, or the account is unconfirmed.");
  console.error("Supabase > Authentication > Sign In / Providers > Email needs Email enabled and");
  console.error("Confirm email off, otherwise the account has to confirm itself first.");
  await browser.close();
  process.exit(1);
}

console.log(`ok   signed in as ${email}`);
console.log(`ok   saved ${cookies.length} cookies to ${OUT}`);
console.log("\nRun a suite with the session loaded, e.g. node scripts/test-home.mjs");
console.log("Re-run this if a suite sees the sign-in card where a page should be.");

await browser.close();