import { formatClock, formatZoned, zonedInstant, type PeriodTime } from "@hub/core";
import Link from "next/link";
import { cn } from "@/lib/utils";

// A thời khóa biểu: the week as a time grid, the way a UIT timetable is read. Drawn in SVG because the
// CSP forbids inline styles, so positions and sizes are attributes rather than style="top:…".

export interface GridItem {
  id: string;
  title: string;
  detail: string | null;
  start: Date;
  end: Date;
  color: string;
  busy: boolean;
  conflict: boolean;
  href?: string;
}

export interface GridDay {
  key: string;
  label: string;
  isToday: boolean;
  free: number;
  items: GridItem[];
  allDay: { id: string; title: string }[];
  due: { id: string; title: string; at: Date; done: boolean }[];
}

const GUTTER = 60;
const COLUMN = 130;
const HOUR = 46;
const WIDTH = GUTTER + COLUMN * 7;

/** Side-by-side lanes for overlapping items (greedy interval partitioning). */
function lanes(items: GridItem[]): { item: GridItem; lane: number; of: number }[] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const out: { item: GridItem; lane: number; group: number }[] = [];
  let laneEnds: number[] = [];
  let group = 0;
  let groupEnd = -Infinity;
  const groupSize = new Map<number, number>();
  for (const item of sorted) {
    if (item.start.getTime() >= groupEnd) {
      group++;
      laneEnds = [];
    }
    let lane = laneEnds.findIndex((end) => end <= item.start.getTime());
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = item.end.getTime();
    groupEnd = Math.max(groupEnd, item.end.getTime());
    groupSize.set(group, Math.max(groupSize.get(group) ?? 0, lane + 1));
    out.push({ item, lane, group });
  }
  return out.map(({ item, lane, group: g }) => ({ item, lane, of: groupSize.get(g)! }));
}

export function WeekGrid({ days, fromMin, toMin, tz, now, periods }: { days: GridDay[]; fromMin: number; toMin: number; tz: string; now: Date; periods: PeriodTime[] }) {
  const hours = Math.ceil((toMin - fromMin) / 60);
  const height = hours * HOUR;
  const y = (minutes: number) => ((minutes - fromMin) / 60) * HOUR;
  const minutesOf = (date: Date, key: string) => (date.getTime() - zonedInstant(key, 0, tz).getTime()) / 60_000;
  const todayIndex = days.findIndex((d) => d.isToday);
  const nowMin = todayIndex >= 0 ? minutesOf(now, days[todayIndex]!.key) : null;

  return (
    <div className="overflow-x-auto">
      <div className="w-fit">
        <div className="grid grid-cols-[60px_repeat(7,130px)] border-b border-border">
          <div />
          {days.map((day) => (
            <div key={day.key} className={cn("flex flex-col gap-1 px-2 pt-1 pb-2", day.isToday && "rounded-t-lg bg-accent-soft/60")}>
              <p className="flex items-baseline justify-between gap-1">
                <span className={cn("text-[14px] font-semibold", day.isToday && "text-accent")}>{day.label}</span>
                <span className="text-[11.5px] text-muted tabular-nums">{Math.round(day.free * 10) / 10}h free</span>
              </p>
              {day.allDay.map((e) => (
                <span key={e.id} className="truncate rounded bg-surface-2 px-1.5 text-[12px]" title={e.title}>
                  {e.title}
                </span>
              ))}
              {day.due.map((t) => (
                <span key={t.id} className={cn("truncate text-[12px]", t.done ? "text-muted line-through" : "text-danger")} title={t.title}>
                  <span className="font-semibold tabular-nums">{formatZoned(t.at, "HH:mm", tz)}</span> {t.title}
                </span>
              ))}
            </div>
          ))}
        </div>
        <svg width={WIDTH} height={height + 8} viewBox={`0 -4 ${WIDTH} ${height + 8}`} role="img" aria-label="Week timetable">
          {todayIndex >= 0 ? <rect x={GUTTER + todayIndex * COLUMN} y={0} width={COLUMN} height={height} className="fill-accent-soft" opacity={0.6} /> : null}
          {Array.from({ length: hours + 1 }, (_, h) => (
            <g key={h}>
              <line x1={GUTTER} x2={WIDTH} y1={h * HOUR} y2={h * HOUR} className="stroke-border" strokeWidth={1} />
              {h < hours ? <line x1={GUTTER} x2={WIDTH} y1={h * HOUR + HOUR / 2} y2={h * HOUR + HOUR / 2} className="stroke-border" strokeWidth={0.5} opacity={0.5} /> : null}
              {h < hours ? (
                <text x={2} y={h * HOUR + 12} fontSize={11} className="fill-muted">
                  {formatClock(fromMin + h * 60)}
                </text>
              ) : null}
            </g>
          ))}
          {/* UIT class periods (tiết) as small ticks in the gutter. */}
          {periods.map((p) => {
            const start = Number(p.start.slice(0, 2)) * 60 + Number(p.start.slice(3));
            if (start < fromMin || start >= toMin) return null;
            return (
              <g key={p.period}>
                <line x1={GUTTER - 5} x2={GUTTER} y1={y(start)} y2={y(start)} className="stroke-accent" strokeWidth={1.5} />
                <text x={GUTTER - 6} y={y(start) + 10} fontSize={9} textAnchor="end" className="fill-accent" opacity={0.8}>
                  {`t${p.period}`}
                </text>
              </g>
            );
          })}
          {days.map((day, index) =>
            lanes(day.items).map(({ item, lane, of }) => {
              const top = Math.max(fromMin, minutesOf(item.start, day.key));
              const bottom = Math.min(toMin, minutesOf(item.end, day.key));
              if (bottom <= top) return null;
              const laneWidth = (COLUMN - 6) / of;
              const x = GUTTER + index * COLUMN + 3 + lane * laneWidth;
              const h = Math.max(y(bottom) - y(top) - 2, 14);
              const block = (
                <g>
                  <title>{`${formatZoned(item.start, "HH:mm", tz)}–${formatZoned(item.end, "HH:mm", tz)} ${item.title}${item.detail ? ` (${item.detail})` : ""}`}</title>
                  <rect x={x} y={y(top) + 1} width={laneWidth - 2} height={h} rx={5} fill={item.color} opacity={item.busy ? 0.16 : 0.06} />
                  <rect x={x} y={y(top) + 1} width={3} height={h} rx={1.5} fill={item.color} />
                  {item.conflict ? (
                    <rect x={x} y={y(top) + 1} width={laneWidth - 2} height={h} rx={5} fill="none" className="stroke-danger" strokeWidth={1.25} strokeDasharray="4 3" />
                  ) : null}
                  {!item.busy ? <rect x={x} y={y(top) + 1} width={laneWidth - 2} height={h} rx={5} fill="none" className="stroke-muted" strokeWidth={0.75} strokeDasharray="3 3" /> : null}
                  <foreignObject x={x + 6} y={y(top) + 2} width={laneWidth - 10} height={h - 2}>
                    <div className="flex h-full flex-col overflow-hidden text-[11.5px] leading-[1.3]">
                      <span className="truncate font-medium text-text">{item.title}</span>
                      {h > 30 && item.detail ? <span className="truncate text-muted">{item.detail}</span> : null}
                      {h > 44 ? <span className="text-muted tabular-nums">{formatZoned(item.start, "HH:mm", tz)}</span> : null}
                    </div>
                  </foreignObject>
                </g>
              );
              return item.href ? (
                <Link key={item.id} href={item.href} className="hover:opacity-80">
                  {block}
                </Link>
              ) : (
                <g key={item.id}>{block}</g>
              );
            }),
          )}
          {nowMin !== null && nowMin >= fromMin && nowMin <= toMin ? (
            <g>
              <line x1={GUTTER + todayIndex * COLUMN} x2={GUTTER + (todayIndex + 1) * COLUMN} y1={y(nowMin)} y2={y(nowMin)} className="stroke-danger" strokeWidth={1.5} />
              <circle cx={GUTTER + todayIndex * COLUMN} cy={y(nowMin)} r={3} className="fill-danger" />
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
