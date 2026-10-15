"use client";

import { Agg, fmtInt, fmtPct, fmtUsd, mondayOf, rates, revenueDecomposition } from "@/lib/compute";
import { MIN_ORDERS, MIN_SESSIONS } from "@/server/metrics/definitions";
import { agg, NotEvidenced, Panel, PLATFORM_COLOR, RealBadge } from "../shared";
import type { FunnelRow, PanelProps } from "../types";

type MetricRow = { label: string; get: (a: Agg) => number | null; fmt: (n: number | null) => string; pp?: boolean; orderBased?: boolean };

const METRICS: MetricRow[] = [
  { label: "Total sessions", get: (a) => a.total, fmt: (n) => fmtInt(n) },
  { label: "Bounce rate (web) / app-bounce", get: (a) => rates(a).bounce_rate, fmt: (n) => fmtPct(n, 1), pp: true },
  { label: "Non-bounce sessions", get: (a) => a.nb, fmt: (n) => fmtInt(n) },
  { label: "Non-bounce CR", get: (a) => rates(a).nonbounce_cr, fmt: (n) => fmtPct(n, 3), pp: true, orderBased: true },
  { label: "AOV", get: (a) => rates(a).aov, fmt: (n) => fmtUsd(n, 2), orderBased: true },
  { label: "Revenue / non-bounce session", get: (a) => rates(a).rev_per_nb, fmt: (n) => fmtUsd(n, 3), orderBased: true },
];

function insufficient(a: Agg, orderBased?: boolean) {
  return a.total < MIN_SESSIONS || (orderBased && a.orders < MIN_ORDERS);
}

function funnelFor(rows: FunnelRow[], weeks: Set<string>, platforms: string[]) {
  const m = new Map<string, { stage: string; stage_order: number; sessions: number }>();
  for (const r of rows) {
    if (!weeks.has(r.week) || !platforms.includes(r.platform)) continue;
    const x = m.get(r.stage) ?? { stage: r.stage, stage_order: r.stage_order, sessions: 0 };
    x.sessions += r.sessions;
    x.stage_order = Math.min(x.stage_order, r.stage_order);
    m.set(r.stage, x);
  }
  return [...m.values()].sort((a, b) => a.stage_order - b.stage_order);
}

function Waterfall({ start, parts, end, reduced }: { start: number; parts: { label: string; v: number }[]; end: number; reduced: boolean }) {
  const steps: { label: string; from: number; to: number; kind: "total" | "delta" }[] = [{ label: "Comparison", from: 0, to: start, kind: "total" }];
  let run = start;
  for (const p of parts) {
    steps.push({ label: p.label, from: run, to: run + p.v, kind: "delta" });
    run += p.v;
  }
  steps.push({ label: "Current", from: 0, to: end, kind: "total" });
  const max = Math.max(...steps.map((s) => Math.max(s.from, s.to)), 1);
  const min = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to)));
  const W = 520;
  const H = 190;
  const top = 18;
  const base = 150;
  const y = (v: number) => base - ((v - min) / (max - min || 1)) * (base - top);
  const bw = W / steps.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Web revenue change decomposition waterfall">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line)" />
      {steps.map((s, i) => {
        const y1 = y(Math.max(s.from, s.to));
        const h = Math.max(1, Math.abs(y(s.from) - y(s.to)));
        const fill = s.kind === "total" ? "var(--web)" : s.to >= s.from ? "var(--good)" : "var(--bad)";
        const val = s.kind === "total" ? s.to : s.to - s.from;
        return (
          <g key={s.label}>
            <rect x={i * bw + 10} y={y1} width={bw - 20} height={h} fill={fill} fillOpacity={0.85} rx={2} style={reduced ? undefined : { transition: "all .6s" }}>
              <title>{`${s.label}: ${fmtUsd(val)}`}</title>
            </rect>
            <text x={i * bw + bw / 2} y={y1 - 4} fontSize="10" textAnchor="middle" fill="var(--ink)" fontWeight={600}>
              {s.kind === "delta" && val >= 0 ? "+" : ""}
              {fmtUsd(val)}
            </text>
            <text x={i * bw + bw / 2} y={base + 16} fontSize="10" textAnchor="middle" fill="var(--muted)">
              {s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function D3Gap({ api, f, cur, cmp, reduced }: PanelProps) {
  const web = agg(cur.rows, f, "web");
  const app = agg(cur.rows, f, "app");
  const webCmp = agg(cmp.rows, f, "web");
  const ordersNA = cur.ordersUnavailable || cmp.ordersUnavailable;

  // weekly funnel overlapping the range
  const weeks = new Set<string>();
  for (let d = cur.from; d <= cur.to; ) {
    weeks.add(mondayOf(d));
    const n = new Date(d + "T00:00:00Z");
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
  }
  const wf = funnelFor(api.data.funnel, weeks, ["web"]);
  const af = funnelFor(api.data.funnel, weeks, ["ios", "android"]);
  const afMap = new Map(af.map((s) => [s.stage, s.sessions]));

  const dec = ordersNA ? null : revenueDecomposition(webCmp, web);
  const parts = dec
    ? [
        { label: "Traffic", v: dec.traffic },
        { label: "Conversion", v: dec.conversion },
        { label: "AOV", v: dec.aov },
      ]
    : [];
  const largest = parts.length ? [...parts].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0] : null;

  return (
    <Panel
      id="panel-d3"
      title="D3 · Web vs App gap explainer"
      badge={<RealBadge />}
      sub="Current range, same market filter. Gap = Web − App (iOS + Android). Web bounce and app-bounce follow different session rules (definition pending) — compare with care."
    >
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th style={{ color: PLATFORM_COLOR.web }}>Web</th>
              <th style={{ color: PLATFORM_COLOR.app }}>App (iOS + Android)</th>
              <th>Gap (web − app)</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const na = m.orderBased && ordersNA;
              const w = m.get(web);
              const a = m.get(app);
              const cell = (x: Agg, v: number | null) => (na ? <span className="pending">n/a at hour precision</span> : insufficient(x, m.orderBased) ? <span className="pending">insufficient sample</span> : m.fmt(v));
              const gap = w != null && a != null && !na && !insufficient(web, m.orderBased) && !insufficient(app, m.orderBased) ? w - a : null;
              return (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  <td>{cell(web, w)}</td>
                  <td>{cell(app, a)}</td>
                  <td>
                    {gap == null
                      ? "—"
                      : m.pp
                        ? `${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(2)} pp`
                        : m.label === "Total sessions" || m.label === "Non-bounce sessions"
                          ? `${gap >= 0 ? "+" : ""}${fmtInt(gap)}`
                          : `${gap >= 0 ? "+" : "−"}${m.fmt(Math.abs(gap))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 13, margin: "14px 0 4px" }}>Funnel steps (weekly grain, weeks overlapping the range)</h3>
      {wf.length < 2 || af.length < 2 ? (
        <NotEvidenced what="Funnel by step" needs="RudderStack session-event aggregates (funnel_weekly snapshot)" />
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Step</th>
                <th>Web sessions</th>
                <th>Web step rate</th>
                <th>App sessions</th>
                <th>App step rate</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {wf.map((s, i) => {
                const prev = wf[i - 1];
                const ws = s.sessions;
                const as = afMap.get(s.stage) ?? null;
                const aprev = prev ? afMap.get(prev.stage) ?? null : null;
                const wr = prev && prev.sessions ? ws / prev.sessions : null;
                const ar = prev && as != null && aprev ? as / aprev : null;
                return (
                  <tr key={s.stage}>
                    <td>{s.stage}</td>
                    <td>{fmtInt(ws)}</td>
                    <td>{prev && prev.sessions < MIN_SESSIONS ? <span className="pending">insufficient sample</span> : fmtPct(wr, 1)}</td>
                    <td>{fmtInt(as)}</td>
                    <td>{fmtPct(ar, 1)}</td>
                    <td>{wr != null && ar != null ? `${wr - ar >= 0 ? "+" : ""}${((wr - ar) * 100).toFixed(1)} pp` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ fontSize: 13, margin: "14px 0 4px" }}>Web booked revenue: change vs comparison, decomposed (traffic × conversion × AOV)</h3>
      {ordersNA ? (
        <div className="note">Orders are not available at hour precision for the partial days in this range, so the decomposition is not shown. Choose whole days.</div>
      ) : !dec ? (
        <div className="note">Not enough orders or revenue in one of the two windows to decompose (needs non-zero sessions, orders and revenue in both).</div>
      ) : (
        <>
          <Waterfall start={webCmp.revenue} parts={parts} end={web.revenue} reduced={reduced} />
          <div className="note">
            Total change {dec.total >= 0 ? "+" : "−"}
            {fmtUsd(Math.abs(dec.total))} = traffic {fmtUsd(dec.traffic)} + conversion {fmtUsd(dec.conversion)} + AOV {fmtUsd(dec.aov)} (LMDI; parts sum to the total; traffic = non-bounce sessions).{" "}
            {largest && `Most of the change vs comparison is in the ${largest.label} component.`} Orders: {webCmp.orders} → {web.orders} — small counts make each component noisy.
          </div>
        </>
      )}
    </Panel>
  );
}
