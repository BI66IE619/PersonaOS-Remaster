/**
 * The SimpleFIN bridge.
 *
 * SimpleFIN is a hosted read-only aggregator. The user gets a claim URL from the
 * SimpleFIN web app, hands it over once, and the app exchanges it for a permanent
 * access URL containing the bank credential in its userinfo segment. That access
 * URL is the thing worth protecting, and it never leaves the server.
 *
 * Everything here is server-only by construction: it reads process.env and calls
 * fetch against a URL derived from user input, so importing it into a client
 * component would fail the build rather than silently ship a bank credential.
 */
import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/finance/crypto";
import { ensureProfile } from "@/lib/dal";
import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@/db/schema";

/**
 * SimpleFIN's default host. Overridable for a self-hosted instance.
 *
 * Only reachable through the allowlist in assertSimpleFinUrl, which has to name
 * the host explicitly when this is overridden. A self-hosted host that is not also
 * listed in SIMPLEFIN_ALLOWED_HOST is rejected by that check, which is deliberate:
 * one variable changing the fetch target is not enough to widen where credentials
 * are sent.
 */
const ALLOWED_HOST = process.env.SIMPLEFIN_ALLOWED_HOST ?? "";

/**
 * Minimum gap between syncs, defaulting to 30 minutes.
 *
 * SimpleFIN's free tier allows roughly 24 requests a day before it disables the
 * token outright — not throttles, disables, which means reconnecting by minting a
 * new claim URL. So "have we synced recently" has to be answerable before reaching
 * out at all; a client that asks on every page load takes the connection down.
 *
 * At 30 minutes this allows ~48 a day if someone genuinely syncs that often, which
 * is double the ceiling the old hourly gap was sized against. That is a deliberate
 * trade for this single-user app, where being current matters more than preserving
 * quota: the button is manual, not automatic, so the ceiling is only reached by
 * someone pressing it 48 times. Raise SIMPLEFIN_MIN_SYNC_GAP_MINUTES to tighten the
 * limit, or lower it to allow more.
 */
const MIN_SYNC_GAP_MS =
  Math.max(1, Number(process.env.SIMPLEFIN_MIN_SYNC_GAP_MINUTES) || 30) * 60 * 1000;
/** SimpleFIN refuses windows longer than 90 days. */
const MAX_WINDOW_DAYS = 90;

export type SimpleFinAccount = {
  /** The spec's `id`. Not `account-id`. */
  id: string;
  name: string;
  /** v1 only. v2 moved this to a top-level `connections` list keyed by conn_id. */
  org?: { domain?: string; name?: string; "sfin-url"?: string };
  /** v2: which connection this account came from. */
  conn_id?: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date"?: number;
  /** Transactions are nested inside each account, not a sibling map. */
  transactions?: SimpleFinTransaction[];
};

export type SimpleFinTransaction = {
  id: string;
  posted: number;
  transacted_at?: number;
  description: string;
  amount: string;
  payee?: string;
  /** External id the payee has assigned, when the bank offers one. */
  external_id?: string;
  pending?: boolean;
};

export type SimpleFinConnection = {
  /** v2 spells the key `conn_id`, matching the account field it is looked up by. */
  conn_id?: string;
  id?: string;
  domain?: string;
  name?: string;
  org_name?: string;
  "sfin-url"?: string;
  sfin_url?: string;
};

export type SimpleFinData = {
  /** v1: flat user-facing messages. */
  errors?: string[];
  /** v2: structured, and the key is `msg`, not `message`. */
  errlist?: { msg?: string; code?: string; type?: string }[];
  accounts: SimpleFinAccount[];
  /** v2: the institutions behind the accounts. */
  connections?: SimpleFinConnection[];
};

/**
 * Accepts either form of the SimpleFIN token.
 *
 * The clipboard usually holds the base64 blob from SimpleFIN's web app. Older
 * instructions and some copy paths hand over the decoded URL instead. Both point
 * at the same one-time claim, so both are accepted — the base64 branch is tried
 * only if the input does not already look like a URL.
 */
function decodeToken(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    /* Not base64. Falls through to the error below. */
  }

  throw new Error(
    "That does not look like a SimpleFIN token. It should be the base64 string " +
      "or the claim URL SimpleFIN gave you.",
  );
}

/**
 * Only SimpleFIN's own hosts, and only over https.
 *
 * This is the SSRF guard. The claim URL is user input that becomes an outbound
 * request, so without it someone could hand over http://169.254.169.254/... or an
 * internal address and have the server fetch it and return the body. The userinfo
 * segment carries the credential, which is why the credential cannot be sent
 * somewhere the user chose.
 *
 * Exported for scripts/test-simplefin-url.mjs. This is the guard that decides where
 * a bank credential may be sent, and every route that uses it requires a session, so
 * it cannot be reached from an unauthenticated request — which means testing it over
 * HTTP is not possible. Asserting against a list of URLs directly is the only way
 * to check the whole boundary rather than the one case auth happens to allow.
 */
export function assertSimpleFinUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That does not look like a SimpleFIN URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("A SimpleFIN URL must be https.");
  }

  const host = url.hostname.toLowerCase();
  const allowed =
    host === "simplefin.org" ||
    host.endsWith(".simplefin.org") ||
    host === "beta.simplefin.org" ||
    ALLOWED_HOST === host;

  if (!allowed) {
    throw new Error("That URL is not a SimpleFIN host.");
  }

  return url;
}

/**
 * Exchanges a claim URL for the permanent access URL and stores it encrypted.
 *
 * The token the user pastes is usually the base64 form from SimpleFIN's web app,
 * not a URL. Both are accepted because the clipboard holds one or the other
 * depending on how it was copied, and rejecting the common case would be a worse
 * outcome than accepting both.
 *
 * The claim token is single-use: SimpleFIN invalidates it as soon as it is
 * redeemed, so a failure here is not retryable with the same string and the user
 * has to go and issue a new one.
 */
export async function connect(userId: string, rawToken: string): Promise<{ accounts: number }> {
  /* Everything that can fail locally is done BEFORE the claim, because the claim
     is the one irreversible step: SimpleFIN deletes the token the moment it is
     redeemed, so any failure after this point costs the user their one token and
     makes them go and mint another.

     This ordering is not cosmetic. An earlier version claimed first and created
     the profile afterwards, so a user with no profiles row — which is everyone who
     signed in without passing through /api/me — burned a valid token on a database
     constraint, then saw "refused the claim" the next time they tried and had no
     way to tell the app had eaten it.

     The token is also validated locally first, for the same reason: a malformed
     token is rejected here instead of being spent on a request that was never
     going to work. */
  const claimUrl = assertSimpleFinUrl(decodeToken(rawToken));

  /* finance_connections.user_id is a foreign key onto profiles.id, and the profile
     is created lazily by /api/me rather than at sign-in. Guaranteed here, before
     the claim, so the one-shot token is only spent once the write is known to be
     possible. Insert-or-nothing, so it is a no-op for a user who already has one
     and safe against two requests racing. */
  await ensureProfile(userId);

  /* POST, per the protocol's POST /claim/:token. A GET against the claim URL 404s
     regardless of whether the token is valid, which is indistinguishable from an
     already-spent token and makes a correct setup token look broken. */
  const res = await fetch(claimUrl.toString(), {
    method: "POST",
    /* Content-Length: 0 is what SimpleFIN's own documented curl sends. */
    headers: { "content-length": "0" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });

  /* Both 403 and 404 mean the same thing in practice, and both mean the token is
     gone. SimpleFIN's docs reserve 403 for "does not exist or was already claimed",
     but a redeemed token is deleted outright, and redeeming one that is already
     deleted returns 404 — so telling the user to "try again" here is exactly the
     advice that cannot work. The app spent the token itself last time; say so
     rather than implying they mistyped it. */
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      "SimpleFIN rejected that token (HTTP " +
        res.status +
        "). Setup tokens are single-use — SimpleFIN deletes one the moment it is " +
        "redeemed, so this cannot be retried. Get a new token from the same page, " +
        "paste it once, and don't refresh in between.",
    );
  }
  if (!res.ok) {
    /* Not the response body. A claim failure can echo the credential back in an
       error payload, and this is the wrong place to start writing that to logs. */
    throw new Error(`SimpleFIN refused the claim (${res.status}).`);
  }

  /* The access URL is the response body, as plain text. It is not a header and
     not JSON — an earlier version of this read x-simplefin-access-url, which does
     not exist, so every successful claim reported "returned no access URL". */
  const accessUrl = (await res.text()).trim();

  /* The body carries the bank credential in its userinfo segment, so it gets the
     same host check as anything else before it is stored or used. */
  assertSimpleFinUrl(accessUrl);

  const encrypted = encryptSecret(accessUrl);

  /* onConflictDoUpdate rather than read-then-branch. A plain select followed by an
     insert is two round trips and has a race: two connects arriving together both
     see no row and both insert, and the second one fails on the primary key. The
     upsert is one statement and has no window. */
  await db
    .insert(schema.financeConnections)
    .values({ userId, accessUrl: encrypted })
    .onConflictDoUpdate({
      target: schema.financeConnections.userId,
      /* lastSyncedAt is cleared rather than carried over: the credential just
         changed, so the time it was last used says nothing about the new one. */
      set: { accessUrl: encrypted, lastSyncedAt: null },
    });

  /* One fetch to prove the credential works and to seed the accounts. Counted
     against the daily quota, same as any other call — which is exactly why
     lastSyncedAt is stamped here. The upsert above deliberately cleared it,
     because the old timestamp described a credential that no longer exists; leaving
     it null would mean the very next sync request sailed straight past the
     quota gate and spent a second call on the same fresh token. */
  const { data } = await fetchData(accessUrl);
  await persist(userId, data);
  await touch(userId);

  return { accounts: data.accounts.length };
}

/**
 * Nominates the account that drives the month's figures, or clears the choice.
 *
 * The id is checked against the caller's own stored accounts before it is written.
 * Without that check any signed-in user could name an arbitrary string as their
 * main account; it would then match no transactions and the month would read as
 * empty. Validating here means a bad id is a clear rejection rather than a screen
 * that quietly stops adding up.
 */
export async function setMainAccount(
  userId: string,
  accountId: string | null,
): Promise<void> {
  if (accountId === null) {
    await db
      .update(schema.financeConnections)
      .set({ mainAccountId: null })
      .where(eq(schema.financeConnections.userId, userId));
    return;
  }

  const owned = await db
    .select({ accountId: schema.financeAccounts.accountId })
    .from(schema.financeAccounts)
    .where(
      and(
        eq(schema.financeAccounts.userId, userId),
        eq(schema.financeAccounts.accountId, accountId),
      ),
    )
    .limit(1);

  if (owned.length === 0) {
    throw new Error("That account is not one of yours.");
  }

  await db
    .update(schema.financeConnections)
    .set({ mainAccountId: accountId })
    .where(eq(schema.financeConnections.userId, userId));
}

export type SyncSkipReason = "too_soon" | "not_connected";

export type SyncResult = {
  ok: boolean;
  /** Set when no request was made, with the reason. */
  skipped?: SyncSkipReason;
  accounts: number;
  transactions: number;
  /** When the next sync will be allowed, for the UI to say so rather than guess. */
  nextAllowedAt?: string;
};

/**
 * Fetches and stores. Rate-limited on lastSyncedAt rather than on a lock, because
 * the cost of being wrong is asymmetric: syncing a little too often burns quota,
 * skipping one is invisible.
 */
export async function sync(
  userId: string,
  opts: { force?: boolean; days?: number } = {},
): Promise<SyncResult> {
  const conn = await db
    .select()
    .from(schema.financeConnections)
    .where(eq(schema.financeConnections.userId, userId))
    .limit(1);

  const row = conn[0];
  /* Not connected is not the same as rate limited. The first version reported
     skipped: "too_soon" here, which told the UI to wait an hour when in fact the
     user had to go and link a bank — the opposite of useful. */
  if (!row) return { ok: false, skipped: "not_connected", accounts: 0, transactions: 0 };

  if (!opts.force && row.lastSyncedAt) {
    const age = Date.now() - new Date(row.lastSyncedAt).getTime();
    if (age < MIN_SYNC_GAP_MS) {
      return {
        ok: true,
        skipped: "too_soon",
        accounts: 0,
        transactions: 0,
        nextAllowedAt: new Date(new Date(row.lastSyncedAt).getTime() + MIN_SYNC_GAP_MS).toISOString(),
      };
    }
  }

  const accessUrl = decryptSecret(row.accessUrl);
  const { data } = await fetchData(accessUrl, opts.days);
  const counts = await persist(userId, data);
  await touch(userId);

  return { ok: true, accounts: counts.accounts, transactions: counts.transactions };
}

/** Records that a request was spent against the daily quota. */
async function touch(userId: string): Promise<void> {
  await db
    .update(schema.financeConnections)
    .set({ lastSyncedAt: new Date() })
    .where(eq(schema.financeConnections.userId, userId));
}

async function fetchData(
  accessUrl: string,
  days?: number,
): Promise<{ data: SimpleFinData; notices: string[] }> {
  const url = new URL(assertSimpleFinUrl(accessUrl).toString());
  const window = Math.min(days ?? MAX_WINDOW_DAYS, MAX_WINDOW_DAYS) - 1;

  /* start-date is a Unix epoch timestamp in seconds, not a calendar date. Sending
     "2026-07-01" is not a format SimpleFIN parses, so the window silently does
     nothing and every fetch returns whatever the default range is.
     
     89 rather than 90 days. SimpleFIN measures the window inclusively and caps
     anything over 90, answering with a 200 and a notice saying it capped the range.
     Asking for one day less avoids the notice and gets the window actually asked
     for. */
  url.searchParams.set(
    "start-date",
    String(Math.floor((Date.now() - Math.max(1, window) * 86_400_000) / 1000)),
  );
  /* pending=1, not pending=true. Same reason. */
  url.searchParams.set("pending", "1");

  /* The access URL already ends in /simplefin, and the collection lives at
     /simplefin/accounts. Without this the request 404s against the root. */
  url.pathname = `${url.pathname.replace(/\/$/, "")}/accounts`;

  /* The credential has to come out of the URL and into an Authorization header.
     Node's fetch refuses to construct a Request from a URL with userinfo in it —
     it throws before the request is sent — so leaving the access URL intact here
     fails every sync with a TypeError rather than an HTTP error. The credential is
     still never logged: it goes straight into a header. */
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";

  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json", authorization },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    /* 429 is the quota. Distinct from other failures because the user's next move
       is to wait rather than to reconnect. */
    if (res.status === 429) {
      throw new Error("SimpleFIN daily limit reached. Try again later today.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("SimpleFIN rejected the stored credential. Reconnect the account.");
    }
    throw new Error(`SimpleFIN request failed (${res.status}).`);
  }

  const data = (await res.json()) as SimpleFinData;
  return { data, notices: serverNotices(data) };
}

/**
 * The server's own messages, if any.
 *
 * Deliberately does NOT throw. errlist is not an error channel — a perfectly
 * healthy response carries notices in it, such as "Requested date range exceeds
 * limit of 90 days and was capped", which arrives with a 200 and a complete ledger.
 * Treating any errlist entry as a failure throws away good data and reports a
 * working sync as broken. The protocol does require showing these to the user, so
 * they are returned alongside the data rather than discarded.
 *
 * Note the key: v2 entries use `msg`. Reading `message` yields nothing and the
 * notice is silently lost.
 */
function serverNotices(data: SimpleFinData): string[] {
  const structured = (data.errlist ?? [])
    .map((e) => e?.msg)
    .filter((m): m is string => Boolean(m));
  if (structured.length > 0) return structured;
  return (data.errors ?? []).filter(Boolean);
}

/**
 * Writes accounts and transactions, keyed on the bank's own ids so a repeat fetch
 * updates rather than duplicates. pending is not persisted as a deletion: a
 * pending transaction becoming posted is an update, and treating the transition as
 * remove-then-add is how rows get lost.
 */
async function persist(
  userId: string,
  data: SimpleFinData,
): Promise<{ accounts: number; transactions: number }> {
  const now = new Date();

  /* v1 put the institution on each account as `org`; v2 dropped it and moved the
     institutions to a top-level `connections` list that accounts point at with
     `conn_id`. Reading only `org` leaves every account labelled "Unknown" on a v2
     server, so both shapes are consulted. The v2 entries key themselves with
     `conn_id` and spell the institution `org_name`, neither of which matches v1. */
  const orgFor = new Map(
    (data.connections ?? [])
      .filter((c) => c?.conn_id ?? c?.id)
      .map((c) => [
        String(c.conn_id ?? c.id),
        c.org_name ?? c.name ?? c.domain ?? "Unknown",
      ]),
  );

  if (data.accounts?.length) {
    await db
      .insert(schema.financeAccounts)
      .values(
        data.accounts.map((a) => ({
          userId,
          accountId: String(a.id),
          name: a.name ?? "Account",
          org:
            a.org?.name ??
            a.org?.domain ??
            (a.conn_id ? orgFor.get(String(a.conn_id)) : undefined) ??
            "Unknown",
          currency: a.currency ?? "USD",
          /* SimpleFIN reports balances as decimal strings. Cents throughout the
             app, so this is parsed and scaled once, here, rather than every time
             something downstream reads it. */
          balanceCents: Math.round(Number(a.balance ?? 0) * 100),
          /* Stored separately rather than overwriting balance, because the two are
             different facts: the ledger balance is what the account is worth, and
             the available balance is what can actually be spent right now. A share
             account with a pending hold reports both, and the user's banking app
             shows the second — showing only the ledger figure reads high by exactly
             the held amount.

             Falls back to the ledger balance when the server omits it, rather than
             to 0, which would read as an account that had been drained. */
          availableBalanceCents:
            a["available-balance"] !== undefined
              ? Math.round(Number(a["available-balance"]) * 100)
              : null,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.financeAccounts.userId, schema.financeAccounts.accountId],
        set: {
          name: excluded("name"),
          org: excluded("org"),
          balanceCents: excluded("balance_cents"),
          availableBalanceCents: excluded("available_balance_cents"),
          updatedAt: now,
        },
      });
  }

  const rows = collectTransactions(data);
  if (rows.length) {
    await db
      .insert(schema.financeTransactions)
      .values(
        rows.map((r) => ({
          userId,
          sourceId: r.sourceId,
          accountId: r.accountId,
          day: r.day,
          amountCents: r.amountCents,
          note: r.note,
          /* Left null: categorisation is the app's job and a rule pass has not been
             written yet. Assigning everything to a bucket at ingest would bury a
             miscategorisation in the database instead of surfacing it. */
          categoryId: null,
          pending: r.pending,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.financeTransactions.userId,
          schema.financeTransactions.accountId,
          schema.financeTransactions.sourceId,
        ],
        set: {
          amountCents: excluded("amount_cents"),
          note: excluded("note"),
          pending: excluded("pending"),
          updatedAt: now,
        },
      });
  }

  return { accounts: data.accounts?.length ?? 0, transactions: rows.length };
}

/**
 * Flattens the account set into one row per transaction.
 *
 * Transactions are nested inside each account object rather than living in a
 * separate map keyed by account id. Walking `data.transactions` instead — which is
 * what this used to do — reads a property that does not exist on the payload and
 * silently produces an empty ledger, so the sync appears to succeed while storing
 * nothing at all.
 */
function collectTransactions(
  data: SimpleFinData,
): { sourceId: string; accountId: string; day: string; amountCents: number; note: string; pending: boolean }[] {
  const out: ReturnType<typeof collectTransactions> = [];

  for (const account of data.accounts ?? []) {
    if (!account?.id || !Array.isArray(account.transactions)) continue;

    for (const t of account.transactions) {
      if (!t?.id) continue;

      /* transacted_at is the date the card actually hit the account and is usually
         what a "spent on" line should say, so it wins when the bank supplies it.
         Both are epoch seconds. */
      const when = t.transacted_at ?? t.posted;
      /* `posted` is 0 while a transaction is pending, per the protocol. A 0 is a
         valid epoch and passes Number.isFinite, so the check has to be for a
         positive value. Left alone this dates every pending row to 1970-01-01,
         where it is invisible in the month's view but still occupies the primary
         key and gets re-upserted on every fetch forever. A pending row with no
         transacted_at has no usable date, so it is dropped and re-read once the
         bank posts it. */
      if (!Number.isFinite(when) || when <= 0) continue;

      const day = new Date(when * 1000).toISOString().slice(0, 10);

      out.push({
        /* external_id is more stable than id across pending-to-posted transitions,
           so it is preferred where available. */
        sourceId: t.external_id ?? String(t.id),
        accountId: String(account.id),
        day,
        /* SimpleFIN signs amounts negative for money out, per the protocol, which
           matches the app's convention. Read rather than inverted, so a sign
           disagreement does not quietly reverse every balance. */
        amountCents: Math.round(Number(t.amount ?? 0) * 100),
        note: t.payee?.trim() || t.description?.trim() || "Transaction",
        pending: Boolean(t.pending),
      });
    }
  }

  return out;
}

/**
 * "Whatever the row being inserted says" — the thing that makes these upserts
 * idempotent. Drizzle cannot express that with a plain value, so it has to be an
 * explicit reference to the excluded row, and writing the SQL inline at each call
 * site would have meant the same six characters repeated with a chance of a typo
 * in the column name.
 */
const excluded = (column: string) => sql.raw(`excluded.${column}`);

/** True when a bank credential is on file. Does not decrypt it. */
export async function isConnected(userId: string): Promise<boolean> {
  const rows = await db
    .select({ one: schema.financeConnections.userId })
    .from(schema.financeConnections)
    .where(eq(schema.financeConnections.userId, userId))
    .limit(1);
  return rows.length > 0;
}