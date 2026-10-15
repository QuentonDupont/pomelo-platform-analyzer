"use client";

import { useState } from "react";
import { aggregate, comparable, Contribution, decomposeChange, describeChange, filterRows, fmtInt, fmtPct, METRIC_KEYS, METRICS, metricValue, segmentAgg, segmentsFor } from "@/lib/compute";
import { NotEvidenced, Panel, PLATFORM_LABEL, RealBadge } from "./shared";
import { ChartOrTable, Legend, niceTicks, Tip, tipLeft } from "./viz";
import type { Filters, PanelProps } from "./types";

const TOP = 8;

export default function ChangeBridge(props: PanelProps & { set: (p: Partial<Filters>) => void }) {
  const { f, cur, cmp, set } = props;
  const m = METRICS[f.metric];
  const [hover, setHover] = useState<number | null>(null);
  const segs = segmentsFor(f.platform, f.markets, f.platform === "web" ? f.device : "all").map((s) => ({
    key: s.key,
    label: s.label,
    a: segmentAgg(cmp.rows, s, cmp.from, cmp.to, f.orders),
    b: segmentAgg(cur.rows, s, cur.from, cur.to, f.orders),
  }));
  const scope = { platform: f.platform, markets: f.markets, device: f.platform === "web" ? f.device : ("all" as const) };
  const A = aggregate(filterRows(cmp.rows, { ...scope, from: cmp.from, to: cmp.to }), f.orders);
  const B = aggregate(filterRows(cur.rows, { ...scope, from: cur.from, to: cur.to }), f.orders);
  const va = metricValue(m, A);
  const vb = metricValue(m, B);
  const like = comparable(cur, cmp);
  const coverageNote = like ? null : `Selected range has session data for ${cur.daysWithData} of ${cur.daysInRange} days; comparison for ${cmp.daysWithData} of ${cmp.daysInRange} days.`;
  const unavailable = A.total === 0 || B.total === 0 || va == null || vb == null || (m.needsOrders && cur.ordersUnavailable) || (!like && (m.kind === "count" || m.kind === "money"));
  const d = decomposeChange(m, segs);
  const sorted = [...d.contributions].sort((x, y) => Math.abs(y.total) - Math.abs(x.total));
  const shown = sorted.slice(0, TOP);
  const rest = sorted.slice(TOP);
  const other: Contribution | null = rest.length
    ? {
        key: "other",
        label: `All other segments (${rest.length})`,
        a: { num: 0, den: null, value: null, share: rest.reduce((x, c) => x + (c.a.share ?? 0), 0) },
        b: { num: 0, den: null, value: null, share: rest.reduce((x, c) => x + (c.b.share ?? 0), 0) },
        mix: rest.reduce((x, c) => x + c.mix, 0),
        rate: rest.reduce((x, c) => x + c.rate, 0),
        total: rest.reduce((x, c) => x + c.total, 0),
      }
    : null;
  const steps = other ? [...shown, other] : shown;
  const ratio = m.kind === "rate" || m.kind === "moneyRatio";

  // Waterfall geometry
  const rowsN = steps.length + 2;
  const ROW = 28;
  const W = 860;
  const pad = { l: 190, r: 210, t: 6, b: 24 };
  const H = pad.t + rowsN * ROW + pad.b;
  const cums: number[] = [];
  let c = va ?? 0;
  for (const s of steps) {
    cums.push(c);
    c += s.total;
  }
  const all = [va ?? 0, vb ?? 0, ...cums, ...steps.map((s, i) => cums[i] + s.total)];
  const zeroBase = m.kind === "count" || m.kind === "money";
  const lo = zeroBase ? 0 : Math.min(...all);
  const hi = Math.max(...all);
  const ticks = niceTicks(zeroBase ? 0 : lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08, 5);
  const x0 = ticks[0];
  const x1 = ticks[ticks.length - 1];
  const x = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const better = (delta: number) => (m.good === "up" ? delta > 0 : delta < 0);
  const rowY = (i: number) => pad.t + i * ROW;

  type Row = { label: string; from: number; to: number; color: string; value: string; detail: string; c?: Contribution };
  const rows: Row[] = [
    { label: "Comparison period", from: zeroBase ? 0 : x0, to: va ?? 0, color: "var(--cmp)", value: m.fmt(va), detail: `${cmp.from} → ${cmp.to}` },
    ...steps.map((s, i) => ({
      label: s.label,
      from: cums[i],
      to: cums[i] + s.total,
      color: Math.abs(s.total) < 1e-12 ? "var(--cmp)" : better(s.total) ? "var(--div-pos)" : "var(--div-neg)",
      value: m.fmtDelta(s.total),
      detail: ratio ? `mix ${m.fmtDelta(s.mix)} · rate ${m.fmtDelta(s.rate)}` : "",
      c: s,
    })),
    { label: "Selected period", from: zeroBase ? 0 : x0, to: vb ?? 0, color: "var(--ink)", value: m.fmt(vb), detail: `${cur.from} → ${cur.to}` },
  ];

  const tip = (r: Row) => {
    const s = r.c;
    if (!s) return [{ key: "v", value: r.value, label: r.label, sub: r.detail }];
    const out = [
      { key: "t", value: m.fmtDelta(s.total), label: "contribution to the change", sub: d.total ? `${Math.round((s.total / d.total) * 100)}% of the total change` : undefined },
      { key: "a", value: s.a.value == null ? "—" : m.fmt(s.a.value), label: "comparison period", sub: s.a.den != null ? `${fmtInt(s.a.num)} ${m.numLabel} ÷ ${fmtInt(s.a.den)} ${m.denLabel} · ${fmtPct(s.a.share, 1)} of ${m.denLabel}` : undefined },
      { key: "b", value: s.b.value == null ? "—" : m.fmt(s.b.value), label: "selected period", sub: s.b.den != null ? `${fmtInt(s.b.num)} ${m.numLabel} ÷ ${fmtInt(s.b.den)} ${m.denLabel} · ${fmtPct(s.b.share, 1)} of ${m.denLabel}` : undefined },
    ];
    if (ratio) {
      out.push({ key: "mix", value: m.fmtDelta(s.mix), label: "mix effect", sub: "segment's share of traffic changed" });
      out.push({ key: "rate", value: m.fmtDelta(s.rate), label: "rate effect", sub: "segment's own rate changed" });
    }
    return out;
  };

  const chart = (
    <div className="viz">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label={`${m.label} bridge from comparison to selected period`}>
        <g className="viz-grid">
          {ticks.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} />
          ))}
        </g>
        <g className="viz-axis">
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={H - 6} textAnchor="middle">
              {m.fmt(t)}
            </text>
          ))}
        </g>
        {rows.map((r, i) => {
          const a = Math.min(x(r.from), x(r.to));
          const w = Math.max(2, Math.abs(x(r.to) - x(r.from)));
          const yy = rowY(i);
          const segKey = r.c?.key;
          return (
            <g
              key={r.label}
              className="viz-mark"
              tabIndex={0}
              role="button"
              aria-label={`${r.label}: ${r.value}${r.detail ? `, ${r.detail}` : ""}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => {
                if (!segKey || segKey === "other") return;
                const [mk, platform, device] = segKey.split("|");
                set({ markets: [mk as Filters["markets"][number]], platform: platform as Filters["platform"], device: platform === "web" ? (device as Filters["device"]) : "all" });
              }}
            >
              <rect x={0} y={yy} width={W} height={ROW} fill="transparent" />
              <text x={pad.l - 10} y={yy + ROW / 2 + 4} textAnchor="end" fontSize="12" fill="var(--ink)" fontWeight={i === 0 || i === rows.length - 1 ? 700 : 400}>
                {r.label}
              </text>
              <rect className="bar" x={a} y={yy + 6} width={w} height={ROW - 12} rx={3} fill={r.color} />
              {i > 0 && i < rows.length - 1 && <line x1={x(r.from)} x2={x(r.from)} y1={yy - 6} y2={yy + 6} stroke="var(--muted)" strokeOpacity={0.5} />}
              <text x={W - pad.r + 10} y={yy + ROW / 2 + 4} fontSize="12" fill="var(--ink)">
                <tspan fontWeight={700}>
                  {r.value}
                </tspan>
                {r.detail && <tspan fill="var(--muted)" fontSize="10.5">{`  ${r.detail}`}</tspan>}
              </text>
            </g>
          );
        })}
      </svg>
      {hover != null && rows[hover] && <Tip x={tipLeft(((x(rows[hover].to) + x(rows[hover].from)) / 2 / W) * 100, 300)} y={rowY(hover) + ROW} title={rows[hover].label} rows={tip(rows[hover])} width={300} />}
      <Legend
        kind="rect"
        items={[
          { label: `Moved ${m.label.toLowerCase()} in the better direction`, color: "var(--div-pos)" },
          { label: "Moved it in the worse direction", color: "var(--div-neg)" },
          { label: "Period totals", color: "var(--cmp)" },
        ]}
      />
      <div className="sub">Click a segment to filter the whole dashboard to it. {zeroBase ? "" : "Axis is zoomed to the range of the values (does not start at 0)."}</div>
    </div>
  );

  const table = (
    <table>
      <thead>
        <tr>
          <th>Segment</th>
          <th>Comparison</th>
          <th>Selected</th>
          {ratio && <th>Share of {m.denLabel} (cmp → sel)</th>}
          {ratio && <th>Mix effect</th>}
          {ratio && <th>Rate effect</th>}
          <th>Contribution</th>
          <th>% of change</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => (
          <tr key={s.key}>
            <td>{s.label}</td>
            <td>{s.a.value == null ? "—" : m.fmt(s.a.value)}</td>
            <td>{s.b.value == null ? "—" : m.fmt(s.b.value)}</td>
            {ratio && (
              <td>
                {fmtPct(s.a.share, 1)} → {fmtPct(s.b.share, 1)}
              </td>
            )}
            {ratio && <td>{m.fmtDelta(s.mix)}</td>}
            {ratio && <td>{m.fmtDelta(s.rate)}</td>}
            <td>
              <strong>{m.fmtDelta(s.total)}</strong>
            </td>
            <td>{d.total ? `${Math.round((s.total / d.total) * 100)}%` : "—"}</td>
          </tr>
        ))}
        <tr>
          <td>
            <strong>Total</strong>
          </td>
          <td>{m.fmt(va)}</td>
          <td>{m.fmt(vb)}</td>
          {ratio && <td />}
          {ratio && <td>{m.fmtDelta(d.mix)}</td>}
          {ratio && <td>{m.fmtDelta(d.rate)}</td>}
          <td>
            <strong>{m.fmtDelta(d.total)}</strong>
          </td>
          <td>100%</td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <Panel
      id="panel-bridge"
      title={`What moved ${m.label.toLowerCase()}?`}
      badge={<RealBadge />}
      sub={
        <>
          Bridge from the comparison period to the selected period for {PLATFORM_LABEL[f.platform]}, split by market ×{" "}
          {f.platform === "web" ? "web device" : "app platform"}. Bars sum exactly to the total change.
          {ratio ? " Mix effect = the segment's share of traffic changed; rate effect = the segment's own rate changed." : ""} Describes the change; it does not say why.
        </>
      }
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
      {unavailable ? (
        <NotEvidenced
          what={`${m.label} change for these periods`}
          needs={coverageNote ? `like-for-like periods — ${coverageNote} Totals over unequal coverage are not comparable; pick periods with full data or use a rate metric` : "data for both periods (and orders at this precision for order-based metrics)"}
        />
      ) : (
        <>
          {coverageNote && (
            <div className="field-warn" role="status">
              Partial data: {coverageNote} Rates are still comparable; treat with care.
            </div>
          )}
          <div className="callout">{describeChange(m, d)}</div>
          <ChartOrTable label={`${m.label} bridge`} chart={chart} table={table} />
        </>
      )}
    </Panel>
  );
}
