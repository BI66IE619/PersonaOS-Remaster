/**
 * Stand-in for `next/headers`, so a script can import a module that reaches for the
 * request cookies outside a request.
 *
 * Nothing here works, and nothing is meant to. Reading throws rather than returning
 * an empty store, because a stub that quietly answers would let a test pass while
 * the real code took a different branch: "no cookies" is a plausible answer that
 * would turn an auth check into a silent pass. Failing loudly keeps the scope of
 * these tests narrow and explicit — they exercise the database, never the session.
 */
export async function cookies() {
  throw new Error("cookies() was called outside a request — a test tried to reach the session");
}
