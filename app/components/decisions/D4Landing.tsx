"use client";

import { aggregate, Agg, fmtInt, fmtPct, rates } from "@/lib/compute";
import { MARKETS, MIN_SESSIONS } from "@/server/metrics/definitions";
import { NotEvidenced, Panel, PLATFORM_COLOR, RealBadge } from "../shared";
import type { DailyRow, PanelProps } from "../types";

type Seg = { key: string; market: string; label: string; color: string; pick: (r: DailyRow) => boolean };

export default function D4Landing({ f, cur, cmp, reduced }: PanelProps) {
  const segs: Seg[] = [];
  for (const m of MARKETS.filter((x) => f.markets.includes(x.id))) {
    for (const dev of ["mobile", "desktop"] as const) {
      if (f.device !== "all" && f.device !== dev) continue;
      segs.push({ key: `${m.id}-web-${dev}`, market: m.id, label: `Web ${dev}`, color: PLATFORM_COLOR.web, pick: (r) => r.market === m.id && r.platform === "web" && r.device === dev });
    }
    segs.push({ key: `${m.id}-app`, market: m.id, label: "App (iOS + Android)", color: PLATFORM_COLOR.app, pick: (r) => r.market === m.id && (r.platform === "ios" || r.platform === "android") });
  }
  const rows = segs.map((s) => {
    const a: Agg = aggregate(cur.rows.filter(s.pick), f.orders);
    const b: Agg = aggregate(cmp.rows.filter(s.pick), f.orders);
    const br = rates(a).bounce_rate;
    const bb = rates(b).bounce_rate;
    const delta = br != null && bb != null && b.total >= MIN_SESSIONS ? br - bb : null;
    return { s, a, br, delta, flag: a.total >= 1000 && delta != null && delta >= 0.02 };
  });
  const maxTotal = Math.max(1, ...rows.map((r) => r.a.total));

  return (
    <Panel
      id="panel-d4"
      title="D4 · Landing-page loss view"
      badge={<RealBadge />}
      sub="Total sessions, bounced share and the non-bounce denominator side by side, so non-bounce CR never hides what is lost at landing. Change vs comparison period."
    >
      <NotEvidenced what="Landing page breakdown" needs="RudderStack pages/screens tables (Superset 'PostgreSQL' DB, schemas rudderstack_*) — not exposed as datasets" />
      <div className="note">Shown instead: the same view by market × platform/device, which the data does evidence.</div>
      <div className="scroll">
        <table style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Segment</th>
              <th>Total sessions</th>
              <th>Bounced</th>
              <th>Bounce share</th>
              <th>Δ vs comparison</th>
              <th>Non-bounce (denominator)</th>
              <th style={{ minWidth: 150 }}>Bounced | non-bounce</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, a, br, delta, flag }) => {
              const low = a.total < MIN_SESSIONS;
              const w = (a.total / maxTotal) * 140;
              const bw = br != null ? w * br : 0;
              return (
                <tr key={s.key}>
                  <td>
                    <strong>{s.market}</strong> · <span style={{ color: s.color }}>{s.label}</span>{" "}
                    {flag && <span className="badge b-Medium">high traffic, rising bounce</span>}
                  </td>
                  <td>{fmtInt(a.total)}</td>
                  <td>{low ? "—" : fmtInt(a.bounces)}</td>
                  <td>{low ? <span className="pending">insufficient sample</span> : fmtPct(br, 1)}</td>
                  <td className={delta == null ? "flat" : delta > 0 ? "down" : delta < 0 ? "up" : "flat"}>
                    {delta == null || low ? "—" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pp`}
                  </td>
                  <td>{low ? "—" : fmtInt(a.nb)}</td>
                  <td>
                    {!low && (
                      <svg width="150" height="12" role="img" aria-label={`${fmtInt(a.bounces)} bounced, ${fmtInt(a.nb)} non-bounce`}>
                        <rect x={0} y={1} width={bw} height={10} fill="var(--bad)" fillOpacity={0.55} style={reduced ? undefined : { transition: "width .6s" }} />
                        <rect x={bw} y={1} width={Math.max(0, w - bw)} height={10} fill={s.color} style={reduced ? undefined : { transition: "width .6s" }} />
                      </svg>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="note">Badge rule: ≥ 1,000 sessions in range and bounce share up ≥ 2 pp vs comparison. Channel is shown in D5 (weekly grain).</div>
    </Panel>
  );
}
