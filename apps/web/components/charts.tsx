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

export interface ProgressPoint {
  day: string;
  done: number;
  total: number;
  cut: number;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** Checklist completion over time (done ÷ countable), one point per day that had a sync. */
export function ProgressHistoryChart({ points }: { points: ProgressPoint[] }) {
  const width = 300;
  const height = 90;
  const pad = { top: 6, right: 6, bottom: 16, left: 26 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const first = dayNumber(points[0]!.day);
  const span = Math.max(1, dayNumber(points.at(-1)!.day) - first);
  const coords = points.map((p) => {
    const countable = p.total - p.cut;
    const ratio = countable > 0 ? p.done / countable : 0;
    return {
      x: pad.left + (points.length === 1 ? innerW : ((dayNumber(p.day) - first) / span) * innerW),
      y: pad.top + (1 - ratio) * innerH,
      ratio,
      point: p,
    };
  });
  const line = coords.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords.at(-1)!.x.toFixed(1)},${pad.top + innerH} L${coords[0]!.x.toFixed(1)},${pad.top + innerH} Z`;
  const label = (key: string) => `${Number(key.slice(8))}/${Number(key.slice(5, 7))}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Checklist completion over time">
      {[0, 0.5, 1].map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={pad.top + (1 - tick) * innerH} y2={pad.top + (1 - tick) * innerH} className="stroke-border" strokeWidth={0.5} />
          <text x={pad.left - 4} y={pad.top + (1 - tick) * innerH + 3} textAnchor="end" fontSize={7} className="fill-muted">
            {tick * 100}%
          </text>
        </g>
      ))}
      <path d={area} className="fill-accent-soft" />
      <path d={line} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" />
      {coords.map((c) => (
        <circle key={c.point.day} cx={c.x} cy={c.y} r={points.length > 40 ? 0.8 : 1.8} className="fill-accent">
          <title>{`${c.point.day}: ${c.point.done}/${c.point.total - c.point.cut} (${Math.round(c.ratio * 100)}%)`}</title>
        </circle>
      ))}
      <text x={pad.left} y={height - 3} fontSize={7} className="fill-muted">
        {label(points[0]!.day)}
      </text>
      <text x={width - pad.right} y={height - 3} textAnchor="end" fontSize={7} className="fill-muted">
        {label(points.at(-1)!.day)}
      </text>
    </svg>
  );
}
