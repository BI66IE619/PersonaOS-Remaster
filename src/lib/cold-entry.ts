/**
 * Is this Home mount entitled to the opening animation?
 *
 * The intro where the P flies to the corner and the word assembles behind it is
 * a first impression. Played on every in-app move from Notes or Vitality it stops
 * being one and becomes latency, so the two cases are told apart here and the
 * distinction is made once, at the one place that can see it.
 *
 * It has to be a flag rather than a look at history because the splash hands off
 * with location.replace, precisely so the title card is not a back-button trap.
 * That erases the splash from history, so by the time Home mounts there is no
 * earlier entry to ask about. Reading the previous pathname would therefore
 * always answer "nothing", and the intro would never play at all.
 *
 * Both sessionStorage and a cookie, because there are two ways in and only one of
 * them can set the first:
 *
 * - sessionStorage is written by the splash, on the client, immediately before it
 *   navigates. Nothing server-side is involved.
 * - The Google hand-off ends at /auth/callback, which is a route handler. It runs
 *   on the server and has no access to sessionStorage at all, so it leaves a
 *   cookie instead.
 *
 * The cookie is also what the pre-paint script in the root layout reads. That
 * script has to decide before the first paint, and at that point React has not
 * run and no module of ours has executed — document.cookie is the only one of the
 * two that can be read synchronously from an inline script in the head. The two
 * stores are therefore not redundant: each is the only one available to whichever
 * side needs it.
 *
 * sessionStorage rather than a module variable, because the hand-off may be a
 * hard navigation on some paths and a module would be a fresh, empty realm by the
 * time Home ran. It clears when the tab closes, so a stale flag cannot outlive
 * the browsing session that set it. The cookie is short-dated for the same
 * reason, and is written with a path and no domain so it stays first-party.
 */
const KEY = "personaos:cold-entry";
const COOKIE = "personaos-intro";

/* Shared with the pre-paint script in the root layout, which has to make the
   same decision before React exists. Kept here so the two cannot drift; a test
   asserts they still agree, because a script string is otherwise the one piece
   of this that nothing would notice breaking. */
export const COLD_ENTRY_KEY = KEY;

/* A flag that outlives a few seconds means a hand-off never completed, and
   playing the intro minutes later on an unrelated visit would be worse than not
   playing it. The splash reaches Home well inside this.

   Ten seconds is measured from the moment Home is being loaded, not from the
   moment the user clicked sign in. That is the whole reason the OAuth path works:
   the callback route sets the flag on arrival, so a consent screen the user took
   forty seconds over is already spent and still counts. Measuring from the click
   instead would expire the flag before the user ever came back. */
const MAX_AGE_MS = 10_000;

/* The cookie has to survive the navigation it authorises. Long enough for a slow
   load, short enough that a browser left open overnight does not play the intro
   on the next visit. */
const COOKIE_MAX_AGE_S = 60;

function isFresh(at: number): boolean {
  return Number.isFinite(at) && Date.now() - at <= MAX_AGE_MS;
}

function writeCookie(at: number): void {
  try {
    document.cookie = `${COOKIE}=${at}; path=/; max-age=${COOKIE_MAX_AGE_S}; samesite=lax`;
  } catch {
    /* Cookies blocked. The intro is decoration; the sessionStorage copy still
       covers the in-app hand-off. */
  }
}

function clearCookie(): void {
  try {
    document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    /* as above */
  }
}

export function markColdEntry(): void {
  const at = Date.now();
  try {
    sessionStorage.setItem(KEY, String(at));
  } catch {
    /* Private mode or a blocked store. */
  }
  writeCookie(at);
}

/**
 * Read and clear in one step. Clearing is the part that makes the in-app case
 * work: the flag is spent on the very first Home it authorises, so arriving
 * later from another tab finds nothing waiting and gets ordinary navigation.
 */
export function takeColdEntry(): boolean {
  let at = NaN;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw !== null) at = Number(raw);
    sessionStorage.removeItem(KEY);
  } catch {
    /* fall through to the cookie */
  }

  /* The cookie is always cleared when looked at, even when the sessionStorage
     copy already answered, so a stale one cannot survive to authorise a later
     load. */
  let cookieAt = NaN;
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
    if (match) cookieAt = Number(decodeURIComponent(match[1]));
  } catch {
    /* as above */
  }
  clearCookie();

  const fresh = isFresh(at) || isFresh(cookieAt);
  return fresh;
}

/**
 * The raw Set-Cookie header value, for /auth/callback.
 *
 * The timestamp is taken here, on arrival, deliberately — see MAX_AGE_MS above.
 */
export function coldEntryCookie(now: number = Date.now()): string {
  return `${COOKIE}=${now}; path=/; max-age=${COOKIE_MAX_AGE_S}; samesite=lax`;
}

/**
 * The same cookie as name/value/options, for NextResponse.cookies.set().
 *
 * Both forms exist because the two writers cannot share one. The callback is a
 * redirect it builds by hand and appends a raw header to; the proxy holds a
 * NextResponse and wants the structured setter, because that is the only way to add
 * a cookie without discarding the response object — and discarding it would throw
 * away the refreshed session token setAll just put there, which is the bug the
 * proxy exists to prevent.
 */
export function coldEntryCookieParts(now: number = Date.now()) {
  return {
    name: COOKIE,
    value: String(now),
    options: { path: "/", maxAge: COOKIE_MAX_AGE_S, sameSite: "lax" as const },
  };
}

/**
 * The pre-paint script in the root layout decides from this, because it runs
 * before any module of ours has been evaluated and cannot import anything. It
 * reads the cookie directly; the sessionStorage key is checked too, since the
 * in-app splash hand-off writes both and the cookie may have been blocked.
 *
 * Exported as a string because it is emitted verbatim into a <script> tag.
 */
/* The inline probe is a hand-written string of plain ES5 rather than an IIFE
   stringified out of a function object. Two reasons, both learned the hard way:
   String(function) injects newlines and the TypeScript parser complains about
   them inside a template literal, and anything fancier than ES5 is a liability in
   a script whose only job is to not throw before the page has a chance to paint.

   The reduced-motion and viewport checks are here rather than in the layout
   because the layout's copy of them was a second place holding the same rule. The
   gates are not decoration: below 640px the mark is not positioned where the
   animation starts it, so playing would move it from nowhere to somewhere. */
const PROBE_SRC = `(function(){` +
  `if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return false;` +
  `if(window.matchMedia&&!window.matchMedia('(min-width: 640px)').matches)return false;` +
  `var KEY='${KEY}';var COOKIE='${COOKIE}';var MAX_AGE=${MAX_AGE_MS};` +
  `try{var s=sessionStorage.getItem(KEY);if(s!==null){var v=Number(s);if(Number.isFinite(v)&&Date.now()-v<=MAX_AGE)return true}}catch(e){}` +
  `try{var m=document.cookie.match(new RegExp('(?:^|; )'+COOKIE+'=([^;]*)'));if(m){var at=Number(decodeURIComponent(m[1]));if(Number.isFinite(at)&&Date.now()-at<=MAX_AGE)return true}}catch(e){}` +
  `return false})()`;

/**
 * Sets data-intro on <html> before first paint when a cold entry is authorised.
 *
 * The attribute is what the stylesheet keys off to hold the title card's letters
 * back, so it has to be on the element before the browser decides what to draw.
 * A React effect would be one paint too late: the letters would show unanimated
 * and then be taken away, which reads as a glitch rather than an intro.
 *
 * It clears itself after 3s. That is not the 10s freshness window — it is a
 * backstop for the case where the page never mounts React at all. Left set, it
 * would hold the letters back on whatever rendered next.
 */
export const COLD_ENTRY_PROBE = `try{if(${PROBE_SRC}){var d=document.documentElement;d.dataset.intro='';setTimeout(function(){delete d.dataset.intro},3000);}}catch(e){}`;