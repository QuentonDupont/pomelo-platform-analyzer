"use client";

import { useState } from "react";
import { aggregate, Agg, filterRows, fmtInt, METRIC_KEYS, METRICS, metricValue } from "@/lib/compute";
import { Market, MARKETS, MIN_ORDERS, MIN_SESSIONS, newcombeDiff } from "@/server/metrics/definitions";
import { Panel, RealBadge } from "./shared";
import { ChartOrTable, Tip } from "./viz";
import type { Filters, PanelProps } from "./types";

type Col = { key: string; label: string; platform: "web" | "app" | "ios" | "android" | "all"; device: "all" | "mobile" | "desktop"; total?: boolean };
const COLS: Col[] = [
  { key: "wm", label: "Web mobile", platform: "web", device: "mobile" },
  { key: "wd", label: "Web desktop", platform: "web", device: "desktop" },
  { key: "w", label: "Web", platform: "web", device: "all", total: true },
  { key: "i", label: "iOS", platform: "ios", device: "all" },
  { key: "a", label: "Android", platform: "android", device: "all" },
  { key: "app", label: "App (iOS + Android)", platform: "app", device: "all", total: true },
  { key: "all", label: "All platforms", platform: "all", device: "all", total: true },
];

export default function SegmentMatrix(props: PanelProps & { set: (p: Partial<Filters>) => void }) {
  const { f, cur, cmp, set } = props;
  const m = METRICS[f.metric];
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const markets = MARKETS.filter((x) => f.markets.includes(x.id));
  const rowsDef: { key: string; label: string; markets: Market[]; total?: boolean }[] = [
    ...markets.map((x) => ({ key: x.id, label: x.id === "GL" ? "Global USD" : x.id === "AU" ? "Australia*" : x.label, markets: [x.id] as Market[] })),
    { key: "all", label: "All selected markets", markets: f.markets, total: true },
  ];
  const at = (rows: typeof cur.rows, from: string, to: string, ms: Market[], col: Col): Agg => aggregate(filterRows(rows, { from, to, platform: col.platform, markets: ms, device: col.device }), f.orders);

  const cells = rowsDef.map((r) =>
    COLS.map((col) => {
      const a = at(cmp.rows, cmp.from, cmp.to, r.markets, col);
      const b = at(cur.rows, cur.from, cur.to, r.markets, col);
      const va = metricValue(m, a);
      const vb = metricValue(m, b);
      const delta = va != null && vb != null ? vb - va : null;
      const insufficient = b.total < MIN_SESSIONS || (m.needsOrders && b.orders < MIN_ORDERS) || (m.needsOrders && cur.ordersUnavailable);
      let clear = false;
      let ci: [number, number] | null = null;
      if (delta != null && !insufficient) {
        if (m.kind === "rate") {
          ci = newcombeDiff(m.num(a), m.den(a) ?? 0, m.num(b), m.den(b) ?? 0);
          clear = Boolean(ci && (ci[0] > 0 || ci[1] < 0));
        } else {
          clear = va !== 0 && Math.abs(delta / (va as number)) >= 0.05;
        }
      }
      const better = delta != null && (m.good === "up" ? delta > 0 : delta < 0);
      return { a, b, va, vb, delta, insufficient, clear, better, ci };
    }),
  );
  const maxAbs = Math.max(1e-12, ...cells.flat().filter((c) => c.clear && c.delta != null).map((c) => Math.abs(c.delta as number)));
  const tint = (c: (typeof cells)[number][number]) => {
    if (!c.clear || c.delta == null) return "var(--div-mid)";
    const pct = Math.round(18 + 52 * Math.min(1, Math.abs(c.delta) / maxAbs));
    return `color-mix(in srgb, ${c.better ? "var(--div-pos)" : "var(--div-neg)"} ${pct}%, var(--panel))`;
  };
  const rel = (c: (typeof cells)[number][number]) => (c.delta != null && c.va ? ` (${c.delta >= 0 ? "+" : ""}${((c.delta / c.va) * 100).toFixed(1)}%)` : "");

  const grid = (
    <div className="viz">
      <div className="scroll">
        <table className="mtx">
          <thead>
            <tr>
              <th>Market</th>
              {COLS.map((c) => (
                <th key={c.key} style={{ textAlign: "right" }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsDef.map((r, ri) => (
              <tr key={r.key}>
                <th scope="row" className="rowh">
                  {r.total ? <strong>{r.label}</strong> : r.label}
                </th>
                {COLS.map((col, ci) => {
                  const c = cells[ri][ci];
                  const label = `${r.label}, ${col.label}: ${c.insufficient ? "insufficient sample" : m.fmt(c.vb)}${c.delta != null ? `, change ${m.fmtDelta(c.delta)}` : ""}`;
                  return (
                    <td
                      key={col.key}
                      className="cell"
                      tabIndex={0}
                      aria-label={label}
                      style={{ background: tint(c), fontWeight: r.total || col.total ? 600 : 400 }}
                      onPointerEnter={() => setHover({ r: ri, c: ci })}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover({ r: ri, c: ci })}
                      onBlur={() => setHover(null)}
                      onClick={() => set({ markets: r.markets, platform: col.platform === "all" ? f.platform : col.platform, device: col.platform === "web" ? col.device : "all" })}
                      onKeyDown={(e) => e.key === "Enter" && set({ markets: r.markets, platform: col.platform === "all" ? f.platform : col.platform, device: col.platform === "web" ? col.device : "all" })}
                    >
                      {c.insufficient ? (
                        <span className="pending small">insufficient sample</span>
                      ) : (
                        <>
                          <div className="v">{m.fmt(c.vb)}</div>
                          <div className={`small ${c.delta == null ? "muted" : c.delta > 0 ? "arrow-up" : c.delta < 0 ? "arrow-down" : ""}`}>{c.delta == null ? "no comparison" : m.fmtDelta(c.delta)}</div>
                          <div className="small muted">n {fmtInt(m.den(c.b) ?? c.b.total)}</div>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hover &&
        (() => {
          const c = cells[hover.r][hover.c];
          const col = COLS[hover.c];
          const r = rowsDef[hover.r];
          return (
            <Tip
              x={`calc(${Math.min(60, 12 + hover.c * 12)}%)`}
              y={46 + hover.r * 58}
              width={300}
              title={`${r.label} · ${col.label}`}
              rows={[
                { key: "b", value: m.fmt(c.vb), label: "selected period", sub: m.denLabel ? `${fmtInt(m.num(c.b))} ${m.numLabel} ÷ ${fmtInt(m.den(c.b))} ${m.denLabel}` : `${fmtInt(c.b.total)} sessions` },
                { key: "a", value: m.fmt(c.va), label: "comparison period", sub: m.denLabel ? `${fmtInt(m.num(c.a))} ${m.numLabel} ÷ ${fmtInt(m.den(c.a))} ${m.denLabel}` : `${fmtInt(c.a.total)} sessions` },
                { key: "d", value: `${m.fmtDelta(c.delta)}${rel(c)}`, label: "change", sub: c.ci ? `95% CI ${m.fmtDelta(c.ci[0])} to ${m.fmtDelta(c.ci[1])} — ${c.clear ? "clear change" : "within noise"}` : c.clear ? "≥ 5% change" : "small change (< 5%) — not highlighted" },
              ]}
              foot="Click to filter the dashboard to this cell."
            />
          );
        })()}
      <div className="legend">
        <span>
          <span className="sw" style={{ background: "color-mix(in srgb, var(--div-pos) 60%, var(--panel))" }} /> clearly better
        </span>
        <span>
          <span className="sw" style={{ background: "color-mix(in srgb, var(--div-neg) 60%, var(--panel))" }} /> clearly worse
        </span>
        <span>
          <span className="sw" style={{ background: "var(--div-mid)" }} /> within noise / small
        </span>
        <span>{m.kind === "rate" ? "“Clear” = 95% interval of the change excludes 0." : "“Clear” = change of 5% or more."} *AU = shop 10 (assumed).</span>
      </div>
    </div>
  );

  const table = (
    <table>
      <thead>
        <tr>
          <th>Market</th>
          <th>Platform</th>
          <th>Selected</th>
          <th>Comparison</th>
          <th>Change</th>
          <th>n (selected)</th>
          <th>Clear change?</th>
        </tr>
      </thead>
      <tbody>
        {rowsDef.flatMap((r, ri) =>
          COLS.map((col, ci) => {
            const c = cells[ri][ci];
            return (
              <tr key={`${r.key}-${col.key}`}>
                <td>{r.label}</td>
                <td>{col.label}</td>
                <td>{c.insufficient ? "insufficient sample" : m.fmt(c.vb)}</td>
                <td>{m.fmt(c.va)}</td>
                <td>
                  {m.fmtDelta(c.delta)}
                  {rel(c)}
                </td>
                <td>{fmtInt(m.den(c.b) ?? c.b.total)}</td>
                <td>{c.clear ? (c.better ? "yes — better" : "yes — worse") : "no"}</td>
              </tr>
            );
          }),
        )}
      </tbody>
    </table>
  );

  return (
    <Panel
      id="panel-matrix"
      title={`${m.label} by market × platform`}
      badge={<RealBadge />}
      sub={`Every cell: selected-period value, change vs comparison (▲ up / ▼ down) and sample size. Colour = better (blue) or worse (red) for ${m.label.toLowerCase()}, only when the change is clear — noise stays grey.`}
      right={
        <label className="inline">
          Metric{" "}
          <select value={f.metric} onChange={(e) => set({ metric: e.target.value as Filters["metric"] })}>
            {METRIC_KEYS.map((k) => (
              <option key={k} value={k}>
                {METRICS[k].label}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <ChartOrTable label={`${m.label} matrix`} chart={grid} table={table} />
    </Panel>
  );
}
