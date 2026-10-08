"use client";

import { aggregate, Agg, DailyRow, filterRows, fmtInt, fmtPct, fmtUsd, rates } from "@/lib/compute";
import { MIN_ORDERS } from "@/server/metrics/definitions";
import { scopeFilter, useCountUp } from "./shared";
import type { PanelProps } from "./types";

type Tile = {
  label: string;
  value: number | null;
  prev: number | null;
  fmt: (n: number) => string;
  pick: (a: Agg) => number | null;
  n?: string;
  good: "up" | "down";
  pp?: boolean;
  na?: string | null;
};

/** Daily series of the current range for sparklines. */
function series(rows: DailyRow[], props: PanelProps, pick: (a: Agg) => number | null) {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  return days.map((d) => pick(aggregate(filterRows(rows, scopeFilter(props.f, d, d, props.f.platform)), props.f.orders)));
}

export default function Kpis(props: PanelProps) {
  const { f, cur, cmp } = props;
  const a = aggregate(filterRows(cur.rows, scopeFilter(f, cur.from, cur.to, f.platform)), f.orders);
  const b = aggregate(filterRows(cmp.rows, scopeFilter(f, cmp.from, cmp.to, f.platform)), f.orders);
  const ra = rates(a);
  const rb = rates(b);
  const isApp = f.platform !== "web";
  const ordersNa = cur.ordersUnavailable || !a.orders_known ? "orders not available at hour precision" : null;
  const lowOrders = a.orders < MIN_ORDERS ? "insufficient sample" : null;
  const tiles: Tile[] = [
    { label: "Total sessions", value: a.total, prev: b.total, fmt: fmtInt, pick: (x) => x.total, good: "up" },
    { label: isApp ? "App-bounce rate" : "Bounce rate", value: ra.bounce_rate, prev: rb.bounce_rate, fmt: (n) => fmtPct(n, 1), pick: (x) => rates(x).bounce_rate, n: `n=${fmtInt(a.total)} sessions`, good: "down", pp: true, na: a.total < 30 ? "insufficient sample" : null },
    { label: "Non-bounce sessions", value: a.nb, prev: b.nb, fmt: fmtInt, pick: (x) => x.nb, good: "up" },
    { label: "Non-bounce CR", value: ra.nonbounce_cr, prev: rb.nonbounce_cr, fmt: (n) => fmtPct(n, 3), pick: (x) => rates(x).nonbounce_cr, n: `${fmtInt(a.orders)} orders`, good: "up", pp: true, na: ordersNa ?? lowOrders },
    { label: "Orders", value: a.orders_known ? a.orders : null, prev: b.orders_known ? b.orders : null, fmt: fmtInt, pick: (x) => x.orders, good: "up", na: ordersNa },
    { label: "AOV", value: ra.aov, prev: rb.aov, fmt: (n) => fmtUsd(n, 2), pick: (x) => rates(x).aov, n: "USD", good: "up", na: ordersNa ?? lowOrders },
    { label: "Booked revenue", value: a.orders_known ? a.revenue : null, prev: b.orders_known ? b.revenue : null, fmt: (n) => fmtUsd(n), pick: (x) => x.revenue, n: "USD, before returns", good: "up", na: ordersNa },
    { label: "Rev / non-bounce session", value: ra.rev_per_nb, prev: rb.rev_per_nb, fmt: (n) => fmtUsd(n, 3), pick: (x) => rates(x).rev_per_nb, good: "up", na: ordersNa ?? lowOrders },
  ];
  return (
    <div className="grid kpis" aria-label="Key metrics">
      {tiles.map((t) => (
        <KpiTile key={t.label} t={t} spark={series(cur.rows, props, t.pick)} reduced={props.reduced} />
      ))}
    </div>
  );
}

function KpiTile({ t, spark, reduced }: { t: Tile; spark: (number | null)[]; reduced: boolean }) {
  const v = useCountUp(t.value ?? 0, reduced);
  let delta = "no comparison";
  let cls = "flat";
  if (!t.na && t.value != null && t.prev != null && (t.pp || t.prev !== 0)) {
    const d = t.value - t.prev;
    delta = t.pp ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)} pp` : `${d >= 0 ? "+" : ""}${((d / t.prev) * 100).toFixed(1)}%`;
    cls = Math.abs(d) < 1e-12 ? "flat" : (t.good === "up" ? d > 0 : d < 0) ? "up" : "down";
  }
  const pts = spark.filter((x): x is number => x != null);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const path = pts.map((p, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${20 - (hi === lo ? 10 : ((p - lo) / (hi - lo)) * 18 + 1)}`).join(" ");
  return (
    <div className="panel kpi">
      <div className="sub">{t.label}</div>
      {t.na ? <div className="v pending small">{t.na}</div> : <div className="v">{t.value == null ? "—" : t.fmt(v)}</div>}
      {pts.length > 1 && (
        <svg viewBox="0 0 100 22" width="100%" height="22" role="img" aria-label={`${t.label} daily trend`}>
          <polyline points={path} fill="none" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" />
        </svg>
      )}
      <div className={`d ${cls}`}>{delta} vs comparison</div>
      {t.n && <div className="sub">{t.n}</div>}
    </div>
  );
}
