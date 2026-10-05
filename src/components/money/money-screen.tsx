"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CATEGORIES } from "@/lib/finance/seed";
import { buildMoneyView } from "@/lib/finance/view";
import { addMonths, monthLabel, monthKey, shortDayLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { Sparkline } from "@/components/sparkline";
import type { MoneyData } from "@/lib/finance/money-data";
import type { MoneyView } from "@/lib/finance/types";
import type { Transaction } from "@/lib/finance/types";

type SyncResponse = {
  ok: boolean;
  skipped?: "too_soon" | "not_connected";
  nextAllowedAt?: string;
  error?: string;
};

export function MoneyScreen({ now, initial }: { now: string; initial: MoneyData }) {
  /* Used only to invalidate the mentor page, which reads this ledger on the server. */
  const router = useRouter();
  const ref = new Date(now);

  /* The month being looked at, seeded from whatever the server rendered. Kept as
     state rather than derived from `now` so the month survives a refetch: reload()
     happens after a sync or an account change, and deriving the month would throw
     the reader back to the present without them having asked. */
  const [month, setMonth] = useState(initial.month);
  const currentMonth = monthKey(ref);

  /* Seeded from the server render rather than fetched in an effect. No loading
     state, because there is nothing to wait for. */
  const [data, setData] = useState<MoneyData>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [moving, setMoving] = useState(false);

  const [claimUrl, setClaimUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectProblem, setConnectProblem] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [syncProblem, setSyncProblem] = useState<string | null>(null);

  const [switching, setSwitching] = useState<string | null>(null);
  const [switchProblem, setSwitchProblem] = useState<string | null>(null);

  /** Pulls the current ledger. Only used after something changes on the server. */
  async function reload(at = month) {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/money?month=${at}`, { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()) as MoneyData);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Moves to an adjacent month.
   *
   * Forward is capped at the current month. There is no spend to record in a month
   * that has not happened yet, and letting someone browse into the future produces
   * empty screens that read as missing data rather than as "not yet".
   */
  async function goMonth(next: string) {
    if (next > currentMonth || next === month || moving) return;
    setMoving(true);
    try {
      const ok = await reload(next);
      /* Only committed once the fetch succeeded, so a failure leaves the reader
         on the month they were already reading rather than on an empty one. */
      if (ok) setMonth(next);
    } finally {
      setMoving(false);
    }
  }

  async function connect() {
    const claim = claimUrl.trim();
    if (!claim || connecting) return;

    setConnecting(true);
    setConnectProblem(null);
    try {
      const res = await fetch("/api/finance/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimUrl: claim }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        /* The server's message is the specific one and is passed through. This
           used to append a guess about single-use tokens, which is only right for
           the status SimpleFIN reserves for it — and being wrong there sent the
           user off to mint a second token for a problem that was never the token. */
        setConnectProblem(body.error ?? "Could not connect.");
        return;
      }

      /* Cleared rather than kept: it is a spent credential and there is no reason
         to hold it in component state once the server has taken it. */
      setClaimUrl("");
      await reload();
    } catch {
      setConnectProblem("Could not reach the server.");
    } finally {
      setConnecting(false);
    }
  }

  async function runSync() {
    if (syncing) return;

    setSyncing(true);
    setSyncProblem(null);
    setSyncNote(null);
    try {
      const res = await fetch("/api/finance/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as SyncResponse;

      if (!res.ok) {
        setSyncProblem(body.error ?? "Sync failed.");
        return;
      }

      if (body.skipped === "too_soon") {
        /* Says what the limit is rather than just "skipped", because the honest
           answer to a button that appeared to do nothing is that it was rate
           limited, and that is the rate limit. */
        setSyncNote(
          body.nextAllowedAt
            ? `Already synced. Next available ${new Date(body.nextAllowedAt).toLocaleTimeString()}.`
            : "Already synced recently.",
        );
      } else if (body.skipped === "not_connected") {
        setSyncProblem("No bank is linked.");
      } else {
        setSyncNote("Synced.");
      }

      await reload();
      /* The mentor's brief is built from this ledger on the server, so the mentor page
         needs re-rendering after a sync or it goes on discussing the figures it read
         when it was last loaded. The brief is only rebuilt when that tab is next
         opened, so this makes the new numbers available without costing a model call. */
      router.refresh();
    } catch {
      setSyncProblem("Could not reach the server.");
    } finally {
      setSyncing(false);
    }
  }

  /**
   * Nominates the account the month is computed from.
   *
   * Costs no SimpleFIN request: it only filters rows already cached, so switching
   * is instant and does not eat into the daily quota the way a sync would.
   */
  async function chooseMainAccount(accountId: string) {
    setSwitching(accountId);
    setSwitchProblem(null);
    try {
      const res = await fetch("/api/finance/main-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSwitchProblem(body.error ?? "Could not change the account.");
        return;
      }
      await reload();
    } catch {
      setSwitchProblem("Could not reach the server.");
    } finally {
      setSwitching(null);
    }
  }

  /* The seed stands in only when no bank is linked. It is never blended with real
     rows: a ledger where some numbers are invented is worse than an obviously
     fake one. */
  /* No linked bank means no ledger. This used to fall back to a generated month
     so the layout had something to show, which read as the user's own spending. */
  const shown = data.linked && data.view ? data.view : EMPTY_VIEW(month);

  const mainName = data.accounts.find((a) => a.isMain)?.name ?? null;

  const isCurrent = month === currentMonth;
  /* Used for every "this month" caption below. Reads "in September" when looking
     back, and stays "this month" when looking at the present, so none of the
     figures are ever described as current when they are not. */
  const inMonth = isCurrent ? "this month" : `in ${monthLabel(month)}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
      <MonthPicker
        month={month}
        currentMonth={currentMonth}
        moving={moving}
        onPrev={() => void goMonth(addMonths(month, -1))}
        onNext={() => void goMonth(addMonths(month, 1))}
        onToday={() => void goMonth(currentMonth)}
      />

      <main className="grid grid-cols-1 gap-4 pt-5 lg:grid-cols-12">
        <Stat
          label="Balance"
          value={formatMoney(shown.balanceCents, {
            showSign: shown.balanceCents > 0,
            /* Cents, because this is the number a person checks against their
               banking app. Rounding it to whole dollars made an exact $680.02 read
               as $680 and looked like a mismatch that no data fix would resolve. */
            dp: 2,
          })}
          sub={
            !data.linked
              ? "last 120 days"
              : mainName
                ? mainName
                : data.accounts.length > 1
                  ? "across accounts"
                  : "available to spend"
          }
        />
        <Stat label="In" value={formatMoney(shown.incomeCents, { dp: 2 })} sub={inMonth} tone="var(--color-good)" />
        <Stat label="Out" value={formatMoney(shown.spentCents, { dp: 2 })} sub={inMonth} />
        <Stat
          label="Net"
          value={formatMoney(shown.netCents, { showSign: shown.netCents > 0, dp: 2 })}
          sub={inMonth}
          tone={shown.netCents >= 0 ? "var(--color-good)" : "var(--color-low)"}
        />

        {/* Only when there is a choice to make. With one account there is nothing to
            pick, and a selector offering a single option is just noise. */}
        {data.linked && data.accounts.length > 1 && (
          <section className="panel p-5 lg:col-span-12">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="label-xs">Accounts</span>
              <span className="text-[10px] text-ink-3">
                the one marked main sets the numbers
              </span>
            </div>

            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {data.accounts.map((a) => (
                <li key={a.accountId}>
                  <button
                    type="button"
                    onClick={() => chooseMainAccount(a.accountId)}
                    disabled={switching !== null}
                    aria-pressed={a.isMain}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-hairline bg-inset px-3 py-2.5 text-left transition-colors hover:bg-raised disabled:opacity-60"
                    style={
                      a.isMain
                        ? { borderColor: "var(--color-good)", background: "var(--color-raised)" }
                        : undefined
                    }
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background: a.isMain
                            ? "var(--color-good)"
                            : "var(--color-hairline-strong)",
                        }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-ink-2">
                          {a.name}
                        </span>
                        <span className="block truncate text-[10px] text-ink-3">
                          {a.org}
                          {a.isMain ? " · sets the numbers" : " · balance only"}
                        </span>
                      </span>
                    </span>
                    <span className="num shrink-0 text-xs text-ink-2">
                      {formatMoney(a.balanceCents, { dp: 2 })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Shown only where it differs, so the common case stays quiet. Where the
                bank reports a held amount the ledger figure is what a total would
                otherwise add up to, and explaining the gap is better than letting
                someone assume the app is wrong. */}
            {data.accounts.some((a) => a.ledgerCents !== a.balanceCents) && (
              <p className="mt-3 text-[10px] text-ink-3">
                Balances are what you can spend. Some of it is held against pending
                card authorisations.
              </p>
            )}

            {switchProblem && (
              <p className="mt-3 text-[11px] text-ink-2" role="alert">
                {switchProblem}
              </p>
            )}
          </section>
        )}

        <section className="panel p-5 lg:col-span-7">
          <div className="mb-4 flex items-center justify-between">
            <span className="label-xs">By category</span>
            <span className="text-[10px] text-ink-3">of what you spent</span>
          </div>

          {shown.byCategory.length === 0 ? (
            <p className="text-[11px] text-ink-3" role="status">
              {/* Names the month rather than saying "this month", because on a past
                  month "this month" is simply wrong. */}
              Nothing spent {inMonth}.
            </p>
          ) : (
            <div className="space-y-3.5">
              {shown.byCategory.map((c) => (
                <div key={c.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2 text-xs text-ink-2">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: c.color, boxShadow: `0 0 7px ${c.color}` }}
                      />
                      {c.label}
                    </span>
                    <span className="num text-xs font-medium">
                      {formatMoney(c.cents, { dp: 2 })}
                      <span className="text-ink-3"> · {Math.round(c.pct * 100)}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-inset">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${Math.min(100, (c.cents / Math.max(1, shown.topCents)) * 100)}%`,
                        background: c.color,
                        boxShadow: `0 0 10px -3px ${c.color}`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel p-5 lg:col-span-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="label-xs">Net through month</span>
            <span
              className="num text-xs font-medium"
              style={{ color: shown.netCents >= 0 ? "var(--color-good)" : "var(--color-low)" }}
            >
              {formatMoney(shown.netCents, { showSign: true, dp: 2 })}
            </span>
          </div>
          <Sparkline
            points={shown.cumulative.map((p) => ({ value: p.cents / 100 }))}
            mean={0}
            height={92}
            color={shown.netCents >= 0 ? "var(--color-good)" : "var(--color-low)"}
            ariaLabel="Cumulative net for the month"
          />

          {shown.subscriptions.length > 0 ? (
            <>
              <div className="hairline-t mt-5 pt-4">
                <span className="label-xs">Subscriptions</span>
              </div>
              <div className="mt-3 space-y-2">
                {shown.subscriptions.map((s) => (
                  <div key={s.label} className="flex items-center justify-between text-xs">
                    <span className="text-ink-2">{s.label}</span>
                    <span className="num text-ink-3">
                      {formatMoney(s.cents)}/{s.cadence === "monthly" ? "mo" : "yr"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-ink-3">
                {formatMoney(shown.subscriptions.reduce((a, s) => a + s.cents, 0))} a month
                going out before you spend anything.
              </p>
            </>
          ) : null}
        </section>

        <TransactionList items={shown.transactions} month={month} />

        <section className="panel flex flex-col p-5 lg:col-span-4">
          <div>
            <span className="label-xs">Bank linking</span>
            {data.linked ? (
              <p className="mt-3 text-sm text-ink-2">
                Linked. Syncing pulls the last 90 days. SimpleFIN disables a token that is
                used too often, so this is rate limited to twice an hour.
              </p>
            ) : (
              <p className="mt-3 text-sm text-ink-2">
                No bank linked, so there is nothing to show. Paste a SimpleFIN token
                and the real transactions appear — it is exchanged once on the server
                and never stored in this browser.
              </p>
            )}
          </div>

          {data.linked ? (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={syncing}
                className="w-full rounded-lg border border-hairline py-2.5 text-sm font-medium text-ink-2 transition-colors enabled:hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
              >
                {syncing ? "Syncing…" : refreshing ? "Refreshing…" : "Sync now"}
              </button>
              {syncNote ? (
                <p className="mt-2 text-[11px] text-ink-3" role="status">
                  {syncNote}
                </p>
              ) : null}
              {syncProblem ? (
                <p className="mt-2 text-[11px] text-ink-3" role="status">
                  {syncProblem}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-4">
              <textarea
                value={claimUrl}
                onChange={(e) => {
                  setClaimUrl(e.target.value);
                  setConnectProblem(null);
                }}
                rows={2}
                maxLength={2000}
                spellCheck={false}
                autoComplete="off"
                aria-label="SimpleFIN token"
                placeholder="Paste the token SimpleFIN gave you"
                className="w-full resize-none rounded-lg border border-hairline bg-inset px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1"
              />
              <button
                type="button"
                onClick={() => void connect()}
                disabled={connecting || claimUrl.trim().length === 0}
                className="mt-3 w-full rounded-lg border border-hairline py-2.5 text-sm font-medium text-ink-2 transition-colors enabled:hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
              >
                {connecting ? "Connecting…" : "Connect a bank"}
              </button>
              {connectProblem ? (
                <p className="mt-2 text-[11px] text-ink-3" role="status">
                  {connectProblem}
                </p>
              ) : null}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

/**
 * A real month with nothing in it.
 *
 * Distinct from a null view on purpose. buildMoneyView over an empty array is the
 * honest way to express "this month has no transactions" — every figure is zero and
 * the panels render their empty states, rather than the screen inventing numbers or
 * bailing out.
 */
function EMPTY_VIEW(month: string): MoneyView {
  return buildMoneyView([], month);
}

/**
 * Which month is on screen.
 *
 * Arrows rather than a dropdown of months, because the useful range is "now and
 * back" — a list of every month anyone has ever had an app would be mostly months
 * with nothing in them.
 *
 * The month name is the state, and the badge next to it says which of the three
 * situations it is: now, a month behind, or further back. Without that, a wall of
 * past transactions reads as the current state of the account, which is the exact
 * mistake the rest of this screen was fixed for.
 */
function MonthPicker({
  month,
  currentMonth,
  moving,
  onPrev,
  onNext,
  onToday,
}: {
  month: string;
  currentMonth: string;
  moving: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const isCurrent = month === currentMonth;
  /* Years back, but not forever. The sync only pulls 90 days and the app has been
     connected far less than that, so a year of back-navigation already reaches
     past anything worth reading. */
  const [cy, cm] = currentMonth.split("-").map(Number);
  const [y, m] = month.split("-").map(Number);
  const monthsBack = (cy - y) * 12 + (cm - m);

  const badge = isCurrent
    ? { text: "current", tone: "var(--color-good)" }
    : { text: "past", tone: "var(--color-ink-3)" };

  const navBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-ink-2 transition-colors enabled:hover:bg-raised disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="flex items-center gap-2 pt-5">
      <button
        type="button"
        onClick={onPrev}
        disabled={moving}
        aria-label="Previous month"
        className={navBtn}
      >
        <span aria-hidden>&lsaquo;</span>
      </button>

      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="truncate text-[17px] font-semibold tracking-tight">
          {monthLabel(month)}
        </h1>
        <span className="shrink-0 text-[10px]" style={{ color: badge.tone }}>
          {badge.text}
        </span>
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={moving || month >= currentMonth}
        aria-label="Next month"
        className={navBtn}
      >
        <span aria-hidden>&rsaquo;</span>
      </button>

      {/* Only when there is somewhere to go back to. A "today" button on the current
          month is a control that does nothing. */}
      {!isCurrent && (
        <button
          type="button"
          onClick={onToday}
          disabled={moving}
          className="ml-auto shrink-0 rounded-lg border border-hairline px-2.5 py-1.5 text-[11px] text-ink-2 transition-colors enabled:hover:bg-raised disabled:opacity-40"
        >
          Today
        </button>
      )}

      {/* Announced rather than shown, so screen-reader users get the same "you are
          looking backwards" signal the badge gives everyone else. */}
      <span className="sr-only" role="status">
        {isCurrent
          ? "Showing the current month."
          : `Showing ${monthLabel(month)}, ${monthsBack} month${monthsBack === 1 ? "" : "s"} ago.`}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="panel p-4 lg:col-span-3">
      <div className="label-xs">{label}</div>
      <div
        className="num mt-2 text-2xl font-semibold tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>
    </div>
  );
}

function TransactionList({ items, month }: { items: Transaction[]; month: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 20);
  const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

  return (
    <section className="panel p-5 lg:col-span-8">
      <div className="mb-4 flex items-center justify-between">
        <span className="label-xs">{monthLabel(month)}</span>
        <span className="num text-[10px] text-ink-3">{items.length} entries</span>
      </div>

      <div className="space-y-1.5">
        {/* An empty month is a normal result, not an error: nobody has spent money
            in a month they were not alive for, and a sync only pulls back 90 days, so
            anything older can legitimately be empty. Saying so is better than a bare
            "0 entries", which reads as a failed load. */}
        {items.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-ink-3" role="status">
            No transactions in {monthLabel(month)}.
          </p>
        )}

        {shown.map((t) => {
          const c = byId.get(t.categoryId);
          return (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-raised/60"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: c?.color ?? "var(--color-ink-3)" }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{t.note}</div>
                <div className="num text-[11px] text-ink-3">
                  {shortDayLabel(t.date)} · {c?.label ?? t.categoryId}
                </div>
              </div>
              <span
                className="num shrink-0 text-sm font-medium"
                style={{ color: t.amountCents > 0 ? "var(--color-good)" : "var(--color-ink)" }}
              >
                {formatMoney(t.amountCents, { showSign: t.amountCents > 0, dp: 2 })}
              </span>
            </div>
          );
        })}
      </div>

      {items.length > 20 ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-4 w-full rounded-lg border border-hairline py-2 text-xs text-ink-2 transition-colors hover:bg-raised"
        >
          {all ? "Show less" : `Show all ${items.length}`}
        </button>
      ) : null}
    </section>
  );
}