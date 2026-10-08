"use client";

import { useState } from "react";
import { addDays, aggregate, Agg, DailyRow, filterRows, fmtDate, fmtInt, fmtPct, fmtUsd, rates, windowImmature } from "@/lib/compute";
import { bangkokToday, Market, MARKETS, MIN_ORDERS } from "@/server/metrics/definitions";
import { Delta, Panel, PendingBadge, RealBadge } from "../shared";
import type { PanelProps } from "../types";

const ALL = MARKETS.map((m) => m.id) as Market[];
const SCOPES: { label: string; platform: "app" | "ios" | "android" | "web"; markets: Market[] }[] = [
  { label: "App (iOS + Android)", platform: "app", markets: ALL },
  { label: "iOS", platform: "ios", markets: ALL },
  { label: "Android", platform: "android", markets: ALL },
  { label: "Web (5 markets)", platform: "web", markets: ALL },
  { label: "Thailand web", platform: "web", markets: ["TH"] },
];
const COLS: { label: string; get: (a: Agg) => number | null; fmt: (n: number | null) => string; pp?: boolean; good: "up" | "down"; orders?: boolean }[] = [
  { label: "Non-bounce sessions", get: (a) => a.nb, fmt: fmtInt, good: "up" },
  { label: "Bounce rate", get: (a) => rates(a).bounce_rate, fmt: (n) => fmtPct(n, 1), pp: true, good: "down" },
  { label: "Non-bounce CR", get: (a) => rates(a).nonbounce_cr, fmt: (n) => fmtPct(n, 3), pp: true, good: "up", orders: true },
  { label: "Orders", get: (a) => (a.orders_known ? a.orders : null), fmt: fmtInt, good: "up" },
  { label: "AOV", get: (a) => rates(a).aov, fmt: (n) => fmtUsd(n, 2), good: "up", orders: true },
  { label: "Rev / NB session", get: (a) => rates(a).rev_per_nb, fmt: (n) => fmtUsd(n, 3), good: "up", orders: true },
  { label: "Booked revenue", get: (a) => (a.orders_known ? a.revenue : null), fmt: (n) => fmtUsd(n), good: "up" },
];

export default function D1Scorecard(props: PanelProps) {
  const weeks = props.api.data.calendar.weeks;
  const [week, setWeek] = useState<string>(weeks[weeks.length - 1] ?? "");
  if (!weeks.length) return <Panel id="panel-d1" title="D1 · Weekly CEO scorecard" sub="No complete Mon–Sun week in the cache yet.">{null}</Panel>;
  const wi = weeks.indexOf(week);
  const prior = weeks[wi - 1] ?? null;
  const twoAgo = weeks[wi - 2] ?? null;
  const daily: DailyRow[] = props.api.data.daily;
  const at = (w: string | null, s: (typeof SCOPES)[number]) => (w ? aggregate(filterRows(daily, { from: w, to: addDays(w, 6), platform: s.platform, markets: s.markets, device: "all" }), props.f.orders) : null);
  const immature = windowImmature(addDays(week, 6), bangkokToday());
  const appNb = at(week, SCOPES[0])?.nb ?? 0;
  const appOrders = at(week, SCOPES[0])?.orders ?? 0;
  return (
    <Panel
      id="panel-d1"
      title="D1 · Weekly CEO scorecard"
      badge={
        <>
          <RealBadge /> {immature && <PendingBadge text="immature — ended < 7 days ago" />}
        </>
      }
      sub={
        <>
          Complete Mon–Sun weeks, fixed CEO scope (all 5 markets, filters don’t apply). Small line: change vs prior week · vs 2 weeks earlier. Orders:{" "}
          {props.f.orders === "backend" ? "backend eligible orders by order date" : "session-attributed gross_orders (dataset 63)"}.
        </>
      }
      right={
        <label className="inline">
          Week{" "}
          <select value={week} onChange={(e) => setWeek(e.target.value)}>
            {[...weeks].reverse().map((w) => (
              <option key={w} value={w}>
                {fmtDate(w)} – {fmtDate(addDays(w, 6))}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Scope</th>
              {COLS.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCOPES.map((s) => {
              const cur = at(week, s)!;
              const p1 = at(prior, s);
              const p2 = at(twoAgo, s);
              const share = s.platform === "ios" || s.platform === "android";
              return (
                <tr key={s.label}>
                  <td>
                    <strong>{s.label}</strong>
                    {share && appNb > 0 && (
                      <div className="sub">
                        {fmtPct(cur.nb / appNb, 0)} of App NB sessions{appOrders ? ` · ${fmtPct(cur.orders / appOrders, 0)} of App orders` : ""}
                      </div>
                    )}
                  </td>
                  {COLS.map((c) => {
                    if (c.orders && cur.orders < MIN_ORDERS)
                      return (
                        <td key={c.label} className="pending">
                          insufficient sample
                        </td>
                      );
                    return (
                      <td key={c.label}>
                        <div>{c.fmt(c.get(cur))}</div>
                        <div className="small">
                          <Delta cur={c.get(cur)} prev={p1 ? c.get(p1) : null} pp={c.pp} good={c.good} /> · <Delta cur={c.get(cur)} prev={p2 ? c.get(p2) : null} pp={c.pp} good={c.good} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="note">
        Weeks compared: {fmtDate(week)} vs {prior ? fmtDate(prior) : "—"} vs {twoAgo ? fmtDate(twoAgo) : "—"}. Sample sizes are the non-bounce sessions and orders columns.
      </div>
    </Panel>
  );
}
