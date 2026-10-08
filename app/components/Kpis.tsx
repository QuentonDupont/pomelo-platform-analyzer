"use client";

import { useState } from "react";
import { addDays, aggregate, Agg, decomposeChange, filterRows, fmtInt, fmtPct, METRIC_KEYS, MetricDef, MetricKey, METRICS, metricCi, metricValue, segmentAgg, segmentsFor } from "@/lib/compute";
import { bootstrapRatioDiff, MIN_ORDERS, MIN_SESSIONS, newcombeDiff } from "@/server/metrics/definitions";
import { PLATFORM_LABEL, scopeFilter, useCountUp } from "./shared";
import type { Filters, PanelProps } from "./types";

const DEFINITION: Record<MetricKey, string> = {
  total: "Sessions in Superset dataset 63 (Cube segment_session), bot_flag = false, 5 in-scope shops.",
  bounce_rate: "Cube measure `bounces` ÷ `total_sessions`. Exact bounce rule lives in the Cube model — definition pending. App rows are app-bounce (own rule).",
  nb: "Cube measure `non_bounces` (= total − bounces). The CEO brief’s “sessions” denominator.",
  nonbounce_cr: "Eligible orders ÷ known-bot-excluded non-bounce tracked sessions. Operational ratio, not matched session conversion.",
  orders: "Backend eligible orders by order date (dataset 33, candidate filters) or session-attributed gross_orders (dataset 63) — per the Orders selector.",
  aov: "Booked revenue ÷ orders. Booked = after-discount merchandise value in USD, before returns.",
  revenue: "After-discount booked merchandise value in USD, before returns. Not net revenue.",
  rev_per_nb: "Booked revenue ÷ non-bounce sessions.",
};

function dailyAggs(rows: PanelProps["cur"]["rows"], f: Filters, from: string, to: string): Agg[] {
  const out: Agg[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(aggregate(filterRows(rows, scopeFilter(f, d, d, f.platform)), f.orders));
  return out.filter((a) => a.days);
}

export default function Kpis(props: PanelProps & { set?: (p: Partial<Filters>) => void }) {
  const { f, cur, cmp } = props;
  const [open, setOpen] = useState<MetricKey | null>(null);
  const a = aggregate(filterRows(cur.rows, scopeFilter(f, cur.from, cur.to, f.platform)), f.orders);
  const b = aggregate(filterRows(cmp.rows, scopeFilter(f, cmp.from, cmp.to, f.platform)), f.orders);
  const curDays = dailyAggs(cur.rows, f, cur.from, cur.to);
  const ordersNa = cur.ordersUnavailable || !a.orders_known;
  const na = (m: MetricDef) =>
    m.needsOrders && ordersNa ? "orders not available at this precision" : m.key === "bounce_rate" && a.total < MIN_SESSIONS ? "insufficient sample" : m.needsOrders && m.kind !== "count" && m.kind !== "money" && a.orders < MIN_ORDERS ? "insufficient sample" : null;
  return (
    <>
      <div className="grid kpis" aria-label="Key metrics — select a tile to see how it is calculated">
        {METRIC_KEYS.map((k) => {
          const m = METRICS[k];
          return (
            <KpiTile
              key={k}
              m={m}
              label={k === "bounce_rate" && f.platform !== "web" ? "App-bounce rate" : m.label}
              value={metricValue(m, a)}
              prev={metricValue(m, b)}
              na={na(m)}
              spark={curDays.map((d) => metricValue(m, d))}
              n={m.denLabel ? `${fmtInt(m.den(a))} ${m.denLabel}` : m.key === "revenue" ? "USD, before returns" : ""}
              reduced={props.reduced}
              open={open === k}
              onToggle={() => setOpen(open === k ? null : k)}
            />
          );
        })}
      </div>
      {open && <MathPanel {...props} m={METRICS[open]} a={a} b={b} curDays={curDays} na={na(METRICS[open])} onClose={() => setOpen(null)} />}
    </>
  );
}

function KpiTile({ m, label, value, prev, na, spark, n, reduced, open, onToggle }: { m: MetricDef; label: string; value: number | null; prev: number | null; na: string | null; spark: (number | null)[]; n: string; reduced: boolean; open: boolean; onToggle: () => void }) {
  const v = useCountUp(value ?? 0, reduced);
  let delta = "no comparison";
  let cls = "flat";
  if (!na && value != null && prev != null) {
    const d = value - prev;
    const rel = prev !== 0 && m.kind !== "rate" ? ` (${d >= 0 ? "+" : ""}${((d / prev) * 100).toFixed(1)}%)` : "";
    delta = `${m.fmtDelta(d)}${rel}`;
    // arrow = direction of the number; colour = better (green) / worse (red)
    cls = Math.abs(d) < 1e-12 ? "flat" : `${(m.good === "up" ? d > 0 : d < 0) ? "up" : "down"} ${d > 0 ? "arrow-up" : "arrow-down"}`;
  }
  const pts = spark.filter((x): x is number => x != null);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const path = pts.map((p, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${20 - (hi === lo ? 10 : ((p - lo) / (hi - lo)) * 18 + 1)}`).join(" ");
  return (
    <button type="button" className="panel kpi" aria-expanded={open} onClick={onToggle} aria-label={`${label}: ${na ?? (value == null ? "no data" : m.fmt(value))}. ${delta} versus comparison. Show calculation.`}>
      <div className="sub">{label} ⓘ</div>
      {na ? <div className="v pending small">{na}</div> : <div className="v">{value == null ? "—" : m.fmt(v)}</div>}
      {pts.length > 1 && (
        <svg viewBox="0 0 100 22" width="100%" height="22" aria-hidden>
          <polyline points={path} fill="none" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" />
        </svg>
      )}
      <div className={`d ${cls}`}>{delta}</div>
      {n && <div className="sub">{n}</div>}
    </button>
  );
}

function MathPanel(props: PanelProps & { set?: (p: Partial<Filters>) => void; m: MetricDef; a: Agg; b: Agg; curDays: Agg[]; na: string | null; onClose: () => void }) {
  const { m, a, b, f, cur, cmp, curDays, na, set } = props;
  const va = metricValue(m, a);
  const vb = metricValue(m, b);
  const ci = metricCi(m, a, curDays);
  const cmpDays = dailyAggs(cmp.rows, f, cmp.from, cmp.to);
  const delta = va != null && vb != null ? va - vb : null;
  let dCi: [number, number] | null = null;
  let dMethod = "";
  if (m.kind === "rate") {
    dCi = newcombeDiff(m.num(b), m.den(b) ?? 0, m.num(a), m.den(a) ?? 0);
    dMethod = "Newcombe (Wilson) 95% interval";
  } else if (m.kind === "moneyRatio") {
    dCi = bootstrapRatioDiff(
      cmpDays.map((d) => ({ num: m.num(d), den: m.den(d) ?? 0 })),
      curDays.map((d) => ({ num: m.num(d), den: m.den(d) ?? 0 })),
    );
    dMethod = "bootstrap over days, 95% interval";
  }
  const clear = dCi ? dCi[0] > 0 || dCi[1] < 0 : null;
  const segs = segmentsFor(f.platform, f.markets, f.platform === "web" ? f.device : "all").map((s) => ({ key: s.key, label: s.label, a: segmentAgg(cmp.rows, s, cmp.from, cmp.to, f.orders), b: segmentAgg(cur.rows, s, cur.from, cur.to, f.orders) }));
  const dec = decomposeChange(m, segs);
  const top = [...dec.contributions].sort((x, y) => Math.abs(y.total) - Math.abs(x.total)).slice(0, 3);
  const formula = (x: Agg, v: number | null) =>
    m.denLabel ? (
      <>
        {fmtInt(m.num(x))} {m.numLabel} ÷ {fmtInt(m.den(x))} {m.denLabel} = <strong>{m.fmt(v)}</strong>
      </>
    ) : (
      <strong>{m.fmt(v)}</strong>
    );
  return (
    <section className="math" aria-label={`How ${m.label} is calculated`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h2>
          {m.label} — the numbers behind it · {PLATFORM_LABEL[f.platform]} · {f.markets.join(", ")}
        </h2>
        <div className="chart-controls">
          {set && (
            <button type="button" onClick={() => set({ metric: m.key, tab: "numbers" })}>
              See trend &amp; drivers
            </button>
          )}
          <button type="button" onClick={props.onClose} aria-label="Close calculation">
            ×
          </button>
        </div>
      </div>
      {na && <p className="pending">{na}</p>}
      <div className="formula">
        Selected ({cur.from} → {cur.to}): {formula(a, va)}
        {ci && (
          <span className="muted">
            {" "}
            · 95% CI {m.fmt(ci[0])}–{m.fmt(ci[1])}
          </span>
        )}
      </div>
      <div className="formula" style={{ fontSize: 13.5 }}>
        Comparison ({cmp.from} → {cmp.to}): {formula(b, vb)}
      </div>
      <dl>
        <dt>Change</dt>
        <dd>
          <strong>{m.fmtDelta(delta)}</strong>
          {delta != null && vb ? ` (${delta >= 0 ? "+" : ""}${((delta / vb) * 100).toFixed(1)}% relative)` : ""}
          {dCi && ` · ${dMethod}: ${m.fmtDelta(dCi[0])} to ${m.fmtDelta(dCi[1])} → ${clear ? "a clear change" : "within normal variation"}`}
          {(m.kind === "count" || m.kind === "money") && " · totals, not a sample estimate (no interval)"}
        </dd>
        <dt>Biggest contributors</dt>
        <dd>
          {top.length
            ? top.map((c, i) => (
                <span key={c.key}>
                  {i ? " · " : ""}
                  {c.label} <strong>{m.fmtDelta(c.total)}</strong>
                  {dec.total ? ` (${Math.round((c.total / dec.total) * 100)}%)` : ""}
                </span>
              ))
            : "—"}
          {(m.kind === "rate" || m.kind === "moneyRatio") && dec.total !== 0 && (
            <div className="sub">
              Mix (traffic shifting between segments) {m.fmtDelta(dec.mix)} · rate (within segments) {m.fmtDelta(dec.rate)}
            </div>
          )}
        </dd>
        <dt>Sample</dt>
        <dd>
          {fmtInt(a.total)} sessions · {fmtInt(a.nb)} non-bounce · {a.orders_known ? `${fmtInt(a.orders)} orders` : "orders n/a"} · {a.days} day(s){" "}
          {a.total < MIN_SESSIONS || (m.needsOrders && a.orders < MIN_ORDERS) ? <span className="pending">— below the {MIN_SESSIONS}-session / {MIN_ORDERS}-order threshold</span> : null}
        </dd>
        <dt>Definition</dt>
        <dd>{DEFINITION[m.key]}</dd>
        <dt>Share of traffic</dt>
        <dd>{f.platform !== "web" && f.platform !== "app" ? "—" : `${fmtPct(a.total / Math.max(1, aggregate(filterRows(cur.rows, { from: cur.from, to: cur.to, platform: "all", markets: f.markets, device: "all" }), f.orders).total), 1)} of all sessions in the selected markets`}</dd>
      </dl>
    </section>
  );
}
