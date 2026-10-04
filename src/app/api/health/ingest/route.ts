import { z } from "zod";
import {
  ensureProfile,
  upsertHealthDaily,
  upsertHealthSessions,
} from "@/lib/dal";
import { getUserId, getUserIdFromBearer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Who is posting this, from whichever of the two sessions the caller has.
 *
 * The browser arrives with a Supabase session cookie; the Health Connect phone
 * app arrives with a bearer token, because a native app has no cookie jar to
 * keep in sync and should not have to grow one just to satisfy a server that was
 * written for a browser first. Both are verified against Supabase rather than
 * decoded, so neither is a claim the caller is trusted on.
 *
 * The cookie is tried first because it is free. The token path costs a round
 * trip to the Auth server, which is worth avoiding for the browser case where a
 * perfectly good session is already sitting in the request.
 */
async function callerUserId(request: Request): Promise<string | null> {
  try {
    const cookieUserId = await getUserId();
    if (cookieUserId) return cookieUserId;
  } catch {
    /* getUserId swallows its own failures and returns null, but a broken cookie
       store should not stop the token path from being tried. */
  }
  return getUserIdFromBearer(request);
}

/**
 * Where Health Connect data lands.
 *
 * The only writer for health_daily and health_sessions, and the only thing in the
 * app that accepts measurements from outside a browser session. The phone is a
 * native app holding a Supabase access token, which is why this is an ordinary
 * authenticated POST rather than an OAuth dance or a webhook with a shared secret:
 * the caller is already a user of the app and is posting only their own data.
 *
 * Not on /api/sync, deliberately. That endpoint is a reconciliation protocol for
 * stores the client owns — it merges by cursor, keeps tombstones, and pages until
 * convergence. Health records have none of that: there is no client copy to
 * reconcile against, so the whole protocol would be ceremony around an upsert.
 *
 * Three things worth knowing about the contract:
 *
 * Sleep arrives pre-aggregated, one row per night, not as the dozens of
 * stage segments Health Connect actually stores. The alternative — segments up,
 * aggregated here — cannot be made idempotent without tracking which segments have
 * already been counted, because a re-sync that re-sends two new segments has no way
 * to know whether the night it half-remembers is the night already stored. The
 * phone re-reads the whole window each time and recomputes the night from scratch,
 * so a re-send is a genuine replacement rather than an increment. That is why the
 * phone derives a stable id from the night rather than passing a record id, and it
 * is the one place where the schema's "the record's own Health Connect id" is
 * stretched: the id is still stable across re-reads, which is the property the
 * upsert actually depends on.
 *
 * The clock is the device's, not the server's, for the reason /api/sync documents
 * in full: the server knows when it heard about a night, not when the night
 * ended, and a phone with a wrong timezone would otherwise win every conflict
 * against the phone that actually wore the watch.
 *
 * A row is replaced, never merged field-by-field. Health Connect records are whole
 * measurements — a re-read either has a resting heart rate or it does not — so a
 * partial update would need the caller to know which fields the previous read had,
 * which is exactly the state that re-reading is meant to eliminate.
 */

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Origin = z.string().min(1).max(200);

/** Epoch millis, as a number or an ISO string — whichever the caller finds easier. */
const Stamp = z.union([z.number().int(), z.string().min(1)]);

/**
 * Bounded so one request cannot carry an unbounded window.
 *
 * 400 daily rows is roughly 13 months of a day each, and 400 sessions is well
 * past a fortnight of daily training. A phone syncing a normal window lands an
 * order of magnitude below both. The cap is here to make a runaway loop fail
 * loudly rather than to ration a real user, and it is deliberately per-kind
 * rather than shared — a legitimate 400-row sleep history plus 400 sessions is
 * two requests, not a rejected one.
 */
const MAX_DAILY = 400;
const MAX_SESSIONS = 400;

const DailyRow = z.object({
  /** Stable across re-reads of the same night. See the note above. */
  recordId: z.string().min(1).max(200),
  day: Day,
  origin: Origin,
  steps: z.number().min(0).max(200_000).nullish(),
  activeMin: z.number().min(0).max(24 * 60).nullish(),
  restingHr: z.number().min(20).max(250).nullish(),
  /** RMSSD in milliseconds, which is what Samsung Health reports and what the
   *  readiness baseline is built on. Not SDNN — the two are not interchangeable
   *  and a baseline mixing them is meaningless. */
  hrvRmssd: z.number().min(0).max(5_000).nullish(),
  spo2: z.number().min(50).max(100).nullish(),
  respiratoryRate: z.number().min(2).max(80).nullish(),
  sleepTotalMin: z.number().min(0).max(24 * 60).nullish(),
  sleepDeepMin: z.number().min(0).max(24 * 60).nullish(),
  sleepRemMin: z.number().min(0).max(24 * 60).nullish(),
  sleepLightMin: z.number().min(0).max(24 * 60).nullish(),
  sleepStartUtc: z.string().min(1).nullish(),
  sleepEndUtc: z.string().min(1).nullish(),
  activeKcal: z.number().min(0).max(30_000).nullish(),
  updatedAt: Stamp,
});

const SessionRow = z.object({
  recordId: z.string().min(1).max(200),
  day: Day,
  origin: Origin,
  /** Health Connect's own activity type, verbatim — "Running", not "Run — Easy". */
  activity: z.string().min(1).max(120),
  startedAtUtc: z.string().min(1),
  durationMin: z.number().min(1).max(24 * 60),
  activeMin: z.number().min(0).max(24 * 60).nullish(),
  energyKcal: z.number().min(0).max(30_000).nullish(),
  distanceM: z.number().min(0).max(1_000_000).nullish(),
  avgHr: z.number().min(20).max(250).nullish(),
  maxHr: z.number().min(20).max(300).nullish(),
  updatedAt: Stamp,
});

const Body = z.object({
  daily: z.array(DailyRow).max(MAX_DAILY).optional(),
  sessions: z.array(SessionRow).max(MAX_SESSIONS).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    /* Which field failed is not returned. It would name the columns, and a
       caller that sent something wrong gets the same 400 either way. */
    return Response.json({ error: "Invalid health payload." }, { status: 400 });
  }

  const { daily, sessions } = parsed.data;
  if (!daily?.length && !sessions?.length) {
    return Response.json({ ok: true, daily: 0, sessions: 0 });
  }

  /* Both tables carry user_id as a foreign key onto profiles.id, and the profile
     is created lazily by /api/me rather than at sign-in. A phone that syncs
     before the web app has ever been opened would otherwise fail on the
     constraint. Same guard as /api/sync, for the same reason. */
  await ensureProfile(userId);

  if (daily?.length) {
    await upsertHealthDaily(
      userId,
      daily.map((r) => ({
        sourceRecordId: r.recordId,
        day: r.day,
        dataOrigin: r.origin,
        steps: r.steps,
        activeMin: r.activeMin,
        restingHr: r.restingHr,
        hrvRmssd: r.hrvRmssd,
        spo2: r.spo2,
        respiratoryRate: r.respiratoryRate,
        sleepTotalMin: r.sleepTotalMin,
        sleepDeepMin: r.sleepDeepMin,
        sleepRemMin: r.sleepRemMin,
        sleepLightMin: r.sleepLightMin,
        sleepStartUtc: r.sleepStartUtc ? new Date(r.sleepStartUtc) : null,
        sleepEndUtc: r.sleepEndUtc ? new Date(r.sleepEndUtc) : null,
        activeKcal: r.activeKcal,
        updatedAt: r.updatedAt,
      })),
    );
  }

  if (sessions?.length) {
    await upsertHealthSessions(
      userId,
      sessions.map((r) => ({
        sourceRecordId: r.recordId,
        day: r.day,
        dataOrigin: r.origin,
        activity: r.activity,
        startedAtUtc: new Date(r.startedAtUtc),
        durationMin: r.durationMin,
        activeMin: r.activeMin,
        energyKcal: r.energyKcal,
        distanceM: r.distanceM,
        avgHr: r.avgHr,
        maxHr: r.maxHr,
        updatedAt: r.updatedAt,
      })),
    );
  }

  /* ok:true is the signal the phone records as "this window is on the server".
     Counts are for the phone's log and for anyone debugging a device that is
     syncing but not showing up. */
  return Response.json({
    ok: true,
    daily: daily?.length ?? 0,
    sessions: sessions?.length ?? 0,
  });
}