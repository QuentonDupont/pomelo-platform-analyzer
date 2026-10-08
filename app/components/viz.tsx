"use client";

import { ReactNode, useState } from "react";

/** One tooltip, values first (strong), series names secondary, line keys (not boxes). Text is React-escaped. */
/** Left position (CSS) for a tooltip anchored at `pct` % of the chart width; flips left past the midpoint. */
export function tipLeft(pct: number, width: number) {
  return pct < 55 ? `calc(${pct}% + 12px)` : `calc(${pct}% - ${width + 12}px)`;
}

export function Tip({ x, y, title, rows, foot, width = 260 }: { x: number | string; y: number; title: string; rows: { key: string; color?: string; value: string; label: string; sub?: string }[]; foot?: string; width?: number }) {
  return (
    <div className="viz-tip" role="status" style={{ left: x, top: y, width }}>
      <div className="viz-tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="viz-tip-row">
          {r.color ? <span className="viz-key" style={{ background: r.color }} aria-hidden /> : <span className="viz-key blank" aria-hidden />}
          <strong>{r.value}</strong>
          <span className="muted">{r.label}</span>
          {r.sub && <span className="viz-tip-sub">{r.sub}</span>}
        </div>
      ))}
      {foot && <div className="viz-tip-foot">{foot}</div>}
    </div>
  );
}

/** Every chart has a table-view twin (the WCAG-clean equivalent). */
export function ChartOrTable({ chart, table, label }: { chart: ReactNode; table: ReactNode; label: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div>
      <div className="viz-toolbar">
        <button type="button" aria-pressed={asTable} onClick={() => setAsTable(!asTable)} aria-label={`${asTable ? "Show chart" : "Show table"} for ${label}`}>
          {asTable ? "Chart view" : "Table view"}
        </button>
      </div>
      {asTable ? <div className="scroll">{table}</div> : chart}
    </div>
  );
}

/** Legend: line key for line charts, rect key for bars/areas. */
export function Legend({ items, kind = "line" }: { items: { label: string; color: string; dashed?: boolean }[]; kind?: "line" | "rect" }) {
  return (
    <div className="legend" aria-label="Legend">
      {items.map((i) => (
        <span key={i.label}>
          {kind === "line" ? (
            <svg width="18" height="8" aria-hidden>
              <line x1="1" x2="17" y1="4" y2="4" stroke={i.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={i.dashed ? "4 3" : undefined} />
            </svg>
          ) : (
            <span className="sw" style={{ background: i.color, borderRadius: 2 }} />
          )}{" "}
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** "Nice" axis ticks for a [min, max] domain. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}
