import { TONE_COLOR, TONE_TEXT } from "@/lib/tones";
import type { Driver } from "@/lib/types";

/**
 * Delta only. The absolute value lives in the panel below — printing it here
 * too meant "93% eff" and "6h 46m" each appeared twice on the same screen.
 */
export function DriverChip({ driver }: { driver: Driver }) {
  const color = TONE_COLOR[driver.tone];
  return (
    <div className="tile flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="label-xs min-w-0 flex-1 truncate">{driver.label}</span>
      <span className={`num shrink-0 text-sm font-medium ${TONE_TEXT[driver.tone]}`}>
        {driver.delta}
      </span>
    </div>
  );
}
