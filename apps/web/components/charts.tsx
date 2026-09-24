import { isoWeekdayOfKey, type DayLoad } from "@hub/core";

const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Busy vs. free productive hours per day with deadline markers. Pure SVG (attributes, no inline
 * styles) so it renders under the strict CSP and scales with its container.
 */
export function LoadChart({ days, windowHours }: { days: DayLoad[]; windowHours: number }) {
  const barWidth = 14;
  const gap = 8;
  const chartHeight = 72;
  const width = days.length * (barWidth + gap) - gap;
  const scale = chartHeight / Math.max(windowHours, 1);

  return (
    <svg viewBox={`0 0 ${width} ${chartHeight + 34}`} className="h-auto w-full" role="img" aria-label="Busy and free hours for the next two weeks">
      {days.map((day, index) => {
        const x = index * (barWidth + gap);
        const busy = Math.min(day.busyHours, windowHours) * scale;
        const free = Math.min(day.freeHours, windowHours) * scale;
        const weekday = isoWeekdayOfKey(day.date);
        return (
          <g key={day.date}>
            <title>{`${day.date}: ${day.busyHours.toFixed(1)}h busy, ${day.freeHours.toFixed(1)}h free, ${day.deadlines} deadline(s)`}</title>
            <rect x={x} y={10} width={barWidth} height={chartHeight} rx={3} className="fill-surface-2" />
            <rect x={x} y={10 + chartHeight - free - busy} width={barWidth} height={free} rx={3} className="fill-accent-soft" />
            <rect x={x} y={10 + chartHeight - busy} width={barWidth} height={busy} rx={3} className="fill-muted" opacity={0.55} />
            {day.deadlines > 0 ? (
              <>
                <circle cx={x + barWidth / 2} cy={5} r={4} className={day.deadlines >= 3 ? "fill-danger" : "fill-warn"} />
                {day.deadlines > 1 ? (
                  <text x={x + barWidth / 2} y={7} textAnchor="middle" fontSize={6} className="fill-surface font-semibold">
                    {day.deadlines}
                  </text>
                ) : null}
              </>
            ) : null}
            <text
              x={x + barWidth / 2}
              y={chartHeight + 24}
              textAnchor="middle"
              fontSize={9}
              className={weekday >= 6 ? "fill-muted" : "fill-text"}
            >
              {DAY_INITIALS[weekday - 1]}
            </text>
            <text x={x + barWidth / 2} y={chartHeight + 33} textAnchor="middle" fontSize={7} className="fill-muted">
              {Number(day.date.slice(8))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
