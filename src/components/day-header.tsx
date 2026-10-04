import { formatDayLabel, relativeTime } from "@/lib/format";
import type { TodayView } from "@/lib/types";

/**
 * The date and sync-freshness strip that opens both Home and Vitality. Shared so
 * the stale warning can never exist on one and not the other.
 */
export function DayHeader({
  date,
  timezone,
  freshness,
}: Pick<TodayView, "date" | "timezone" | "freshness">) {
  return (
    <>
      <header className="flex items-center justify-between gap-4 py-4">
        <span className="text-xs text-ink-3">{formatDayLabel(date, timezone)}</span>
        <div
          className="flex items-center gap-1.5 rounded-full border border-hairline bg-white/[0.09] px-2.5 py-1"
          style={
            freshness.isStale
              ? { borderColor: "color-mix(in oklab, var(--color-mid) 40%, transparent)" }
              : undefined
          }
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: freshness.isStale ? "var(--color-mid)" : "var(--color-good)",
              boxShadow: `0 0 8px ${freshness.isStale ? "var(--color-mid)" : "var(--color-good)"}`,
            }}
          />
          <span className="num text-[10px] text-ink-2">
            {freshness.isStale ? "stale · " : ""}
            {relativeTime(freshness.latestAt)}
          </span>
        </div>
      </header>

      {freshness.isStale ? (
        <div className="panel mb-4 border-[color-mix(in_oklab,var(--color-mid)_30%,transparent)] px-4 py-3 text-xs text-[var(--color-mid)]">
          No new data in over 24 hours. Check that the sync app is running.
        </div>
      ) : null}
    </>
  );
}
