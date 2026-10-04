import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema, ensureProfile, Unauthenticated, requireUserId } from "@/lib/dal";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's own row, and nothing else.
 *
 * GET creates the profile on first call. That is a side effect on a read, which is
 * unusual, and it is here rather than in the Google callback because the callback
 * is a redirect the user can abandon halfway through — a row written there would
 * exist for an account that never finished signing in. Here, a profile is only
 * created for someone who has actually used the app.
 *
 * PATCH accepts displayName, timezone and mentorEnabled and nothing else. The
 * schema is a whitelist rather than a merge of whatever arrived: an object spread
 * straight into the update would let a caller write user_id, and the read side
 * scopes by user_id, so that would be a way to point this row at another account.
 * Every writable column is named, so nothing unlisted can be written at all.
 *
 * 401 rather than a redirect, because this is fetch() and the caller wants JSON.
 */

const Patch = z
  .object({
    displayName: z.string().max(120).nullish(),
    timezone: z.string().max(64).nullish(),
    mentorEnabled: z.boolean().optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    if (e instanceof Unauthenticated) {
      return Response.json({ error: "Not signed in." }, { status: 401 });
    }
    throw e;
  }

  const profile = await ensureProfile(userId);
  if (!profile) {
    return Response.json({ error: "Profile unavailable." }, { status: 500 });
  }

  return Response.json({
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    timezone: profile.timezone,
    mentorEnabled: profile.mentorEnabled,
  });
}

export async function PATCH(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    if (e instanceof Unauthenticated) {
      return Response.json({ error: "Not signed in." }, { status: 401 });
    }
    throw e;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }

  const parsed = Patch.safeParse(body);
  if (!parsed.success) {
    /* The failing field names are not returned. They would tell an attacker which
       columns exist, and a client that sent something wrong gets the same 400
       either way. */
    return Response.json({ error: "Invalid profile update." }, { status: 400 });
  }

  await ensureProfile(userId);

  const { displayName, timezone, mentorEnabled } = parsed.data;

  const [row] = await db
    .update(schema.profiles)
    .set({
      ...(displayName !== undefined ? { displayName: displayName ?? null } : {}),
      ...(timezone !== undefined ? { timezone: timezone ?? "UTC" } : {}),
      ...(mentorEnabled !== undefined ? { mentorEnabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.profiles.id, userId))
    .returning({
      id: schema.profiles.id,
      displayName: schema.profiles.displayName,
      timezone: schema.profiles.timezone,
      mentorEnabled: schema.profiles.mentorEnabled,
    });

  if (!row) {
    return Response.json({ error: "Profile unavailable." }, { status: 500 });
  }

  return Response.json(row);
}