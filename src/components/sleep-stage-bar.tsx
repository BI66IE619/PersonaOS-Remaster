import { STAGE_COLOR, STAGE_LABEL } from "@/lib/tones";
import { formatDuration } from "@/lib/format";
import type { Stage } from "@/lib/types";

export function SleepStageBar({
  stages,
  totalMin,
  efficiency,
  fill = false,
}: {
  stages: Stage[];
  totalMin: number;
  efficiency: number;
  fill?: boolean;
}) {
  const order = ["deep", "rem", "light", "awake"] as const;
  const byStage = new Map(stages.map((s) => [s.stage, s.min]));
  const present = order.filter((k) => (byStage.get(k) ?? 0) > 0);

  return (
    <div className={fill ? "flex h-full flex-col" : undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="num text-3xl font-semibold tracking-tight">
          {formatDuration(totalMin)}
        </div>
        <div className="num text-sm text-ink-2">
          <span className={efficiency >= 0.9 ? "text-[var(--color-good)]" : ""}>
            {Math.round(efficiency * 100)}%
          </span>{" "}
          <span className="text-ink-3">eff</span>
        </div>
      </div>

      <div
        className={
          fill
            ? "mt-3 flex min-h-3 flex-1 gap-[3px] overflow-hidden rounded-full"
            : "mt-3 flex h-3 w-full gap-[3px] overflow-hidden rounded-full"
        }
        style={{ boxShadow: "0 0 18px -4px rgba(255,255,255,0.3)" }}
      >
        {present.map((key) => {
          const min = byStage.get(key) ?? 0;
          return (
            <div
              key={key}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${(min / totalMin) * 100}%`,
                background: STAGE_COLOR[key],
                boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.22)`,
              }}
            />
          );
        })}
      </div>

      <div className="mt-3 shrink-0 grid grid-cols-4 gap-2">
        {present.map((key) => (
          <div key={key}>
            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: STAGE_COLOR[key] }}
              />
              <span className="label-xs">{STAGE_LABEL[key]}</span>
            </div>
            <div className="num mt-1 text-sm font-medium text-ink-2">
              {formatDuration(byStage.get(key) ?? 0)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
