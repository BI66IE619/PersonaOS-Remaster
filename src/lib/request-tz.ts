import { cookies, headers } from "next/headers";

/**
 * The visitor's IANA timezone, used to turn the server's UTC clock into the day
 * they are actually living in.
 *
 * The server is in UTC, so a date taken from its own clock is wrong for anyone
 * east or west of it — an evening in the US is already the next day in UTC, and a
 * Thursday check-in would be filed under Friday. Vercel stamps each request with
 * the timezone of the caller's IP, which is the one signal available on the very
 * first render, before any cookie exists. Once the device has set its own zone as
 * a cookie, that wins, because the device knows its zone and the IP only suggests
 * one.
 */
export async function requestTimezone(): Promise<string | undefined> {
  try {
    const fromCookie = (await cookies()).get("tz")?.value;
    if (fromCookie) return fromCookie;
  } catch {
    /* Outside a request scope (a script or a test): fall through to no answer. */
  }
  try {
    return (await headers()).get("x-vercel-ip-timezone") ?? undefined;
  } catch {
    return undefined;
  }
}
