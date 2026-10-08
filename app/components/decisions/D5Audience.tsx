"use client";

import { useState } from "react";
import { addDays, fmtDate, fmtInt, fmtPct } from "@/lib/compute";
import { MIN_ORDERS, MIN_SESSIONS } from "@/server/metrics/definitions";
import { NotEvidenced, Panel, PLATFORM_COLOR, RealBadge } from "../shared";
import type { MixRow, PanelProps } from "../types";

const PALETTE = ["var(--web)", "var(--app)", "var(--ios)", "var(--android)", "var(--amber)", "var(--good)", "var(--bad)", "var(--unknown)"];
const isUnknown = (v: string) => !v || /^(unknown|null|none|\(none\)|undefined)$/i.test(v);

type Cohort = { key: string; total: number; bounces: number; nb: number; orders: number; ordersKnown: boolean };

function cohorts(rows: MixRow[], dim: "channel" | "customer_type"): Cohort[] {
  const m = new Map<string, Cohort>();
  for (const r of rows) {
    const k = String(r[dim] ?? "unknown") || "unknown";
    const c = m.get(k) ?? { key: k, total: 0, bounces: 0, nb: 0, orders: 0, ordersKnown: false };
    c.total += r.total_sessions;
    c.bounces += r.bounces;
    c.nb += r.non_bounces;
    if (r.orders != null) {
      c.orders += r.orders;
      c.ordersKnown = true;
    }
    m.set(k, c);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

function CohortTable({ title, list, total }: { title: string; list: Cohort[]; total: number }) {
  const known = list.filter((c) => !isUnknown(c.key)).reduce((a, c) => a + c.total, 0);
  return (
    <div>
      <div className="sub">
        {title} · coverage <strong>{fmtPct(total ? known / total : null, 1)}</strong> of sessions have a known value
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>{title}</th>
              <th>Sessions</th>
              <th>Share</th>
              <th>Bounce rate</th>
              <th>Non-bounce CR</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.key}>
                <td>{isUnknown(c.key) ? <span className="muted">unknown (own bucket)</span> : c.key}</td>
                <td>{fmtInt(c.total)}</td>
                <td>{fmtPct(total ? c.total / total : null, 1)}</td>
                <td>{c.total < MIN_SESSIONS ? <span className="pending">insufficient sample</span> : fmtPct(c.bounces / c.total, 1)}</td>
                <td>{!c.ordersKnown ? "—" : c.orders < MIN_ORDERS ? <span className="pending">insufficient sample</span> : fmtPct(c.nb ? c.orders / c.nb : null, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stacked({ rows, dim, reduced }: { rows: MixRow[]; dim: "channel" | "customer_type"; reduced: boolean }) {
  const weeks = [...new Set(rows.map((r) => r.week))].sort().slice(-8);
  const top = cohorts(rows, dim).slice(0, 7).map((c) => c.key);
  const keyOf = (k: string) => (top.includes(k) ? k : "other");
  const keys = [...top, ...(cohorts(rows, dim).length > 7 ? ["other"] : [])];
  const W = 520;
  const rowH = 18;
  return (
    <figure style={{ margin: "6px 0 0" }}>
      <svg viewBox={`0 0 ${W} ${weeks.length * (rowH + 6) + 4}`} width="100%" role="img" aria-label={`${dim} share of sessions by week`}>
        {weeks.map((w, i) => {
          const wr = rows.filter((r) => r.week === w);
          const tot = wr.reduce((a, r) => a + r.total_sessions, 0) || 1;
          let x = 70;
          return (
            <g key={w}>
              <text x={0} y={i * (rowH + 6) + 13} fontSize="10" fill="var(--muted)">
                wk {fmtDate(w)}
              </text>
              {keys.map((k, ki) => {
                const v = wr.filter((r) => keyOf(String(r[dim] ?? "unknown") || "unknown") === k).reduce((a, r) => a + r.total_sessions, 0);
                const width = (v / tot) * (W - 74);
                const el = (
                  <rect key={k} x={x} y={i * (rowH + 6)} width={width} height={rowH} fill={isUnknown(k) ? "var(--unknown)" : PALETTE[ki % PALETTE.length]} fillOpacity={0.85} style={reduced ? undefined : { transition: "width .6s, x .6s" }}>
                    <title>{`${k}: ${fmtPct(v / tot, 1)} (${fmtInt(v)} sessions)`}</title>
                  </rect>
                );
                x += width;
                return el;
              })}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        {keys.map((k, ki) => (
          <span key={k}>
            <span className="sw" style={{ background: isUnknown(k) ? "var(--unknown)" : PALETTE[ki % PALETTE.length] }} />
            {k}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export default function D5Audience({ api, f, cur, reduced }: PanelProps) {
  const [plat, setPlat] = useState<"web" | "app">("web");
  const mix = api.data.mix ?? [];
  if (!mix.length)
    return (
      <Panel id="panel-d5" title="D5 · Audience & acquisition mix">
        <NotEvidenced what="Channel and new-vs-returning mix" needs="the traffic_mix_weekly snapshot (Superset dataset 63 by channel_group × existing_customer)" />
      </Panel>
    );

  const pf = (r: MixRow) => (plat === "web" ? r.platform === "web" && (f.device === "all" || r.device === f.device) : r.platform === "ios" || r.platform === "android");
  const scoped = mix.filter((r) => f.markets.includes(r.market) && pf(r));
  let weeks = [...new Set(scoped.filter((r) => r.week <= cur.to && addDays(r.week, 6) >= cur.from).map((r) => r.week))].sort();
  let fallback = false;
  if (!weeks.length) {
    const prior = [...new Set(scoped.map((r) => r.week))].filter((w) => w <= cur.to).sort();
    if (prior.length) {
      weeks = [prior[prior.length - 1]];
      fallback = true;
    }
  }
  const inRange = scoped.filter((r) => weeks.includes(r.week));
  const total = inRange.reduce((a, r) => a + r.total_sessions, 0);
  const ch = cohorts(inRange, "channel");
  const ct = cohorts(inRange, "customer_type");

  // brief-context checks
  const knownCt = ct.filter((c) => !isUnknown(c.key));
  const ctKnownTotal = knownCt.reduce((a, c) => a + c.total, 0);
  const newC = knownCt.find((c) => /^new/i.test(c.key));
  const meta = ch.filter((c) => /meta|facebook|instagram|\bfb\b/i.test(c.key));
  const google = ch.filter((c) => /google|adwords|gads|sem|cpc/i.test(c.key));
  const rest = ch.filter((c) => !google.includes(c));
  const sumC = (xs: Cohort[]) => xs.reduce((a, c) => ({ total: a.total + c.total, nb: a.nb + c.nb, orders: a.orders + c.orders }), { total: 0, nb: 0, orders: 0 });
  const g = sumC(google);
  const o = sumC(rest);
  const chKnown = ch.filter((c) => !isUnknown(c.key)).reduce((a, c) => a + c.total, 0);

  return (
    <Panel
      id="panel-d5"
      title="D5 · Audience & acquisition mix"
      badge={<RealBadge />}
      sub={`Weekly grain (Superset dataset 63): weeks ${weeks.map(fmtDate).join(", ") || "—"}${fallback ? " — no mix week overlaps the range, showing the latest earlier week" : " overlapping the range"}. Markets: ${f.markets.join(", ")}.`}
      right={
        <span className="seg" role="group" aria-label="Platform for mix">
          <button aria-pressed={plat === "web"} onClick={() => setPlat("web")}>
            Web
          </button>
          <button aria-pressed={plat === "app"} onClick={() => setPlat("app")}>
            App
          </button>
        </span>
      }
    >
      <table>
        <thead>
          <tr>
            <th>Brief context check</th>
            <th style={{ textAlign: "left" }}>Evidence in this range</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{plat === "web" ? "Web" : "App"} mostly serves new customers?</td>
            <td style={{ textAlign: "left", whiteSpace: "normal" }}>
              {!ctKnownTotal || !newC ? (
                <span className="pending">not evidenced (customer type unknown for these sessions)</span>
              ) : (
                <>
                  New = {fmtPct(newC.total / ctKnownTotal, 1)} of sessions with a known customer type (coverage {fmtPct(ctKnownTotal / (total || 1), 1)}) —{" "}
                  {newC.total / ctKnownTotal > 0.5 ? "consistent with the brief" : "not consistent with the brief"}
                </>
              )}
            </td>
          </tr>
          <tr>
            <td>Meta acquisition present?</td>
            <td style={{ textAlign: "left", whiteSpace: "normal" }}>
              {!chKnown ? (
                <span className="pending">not evidenced (channel unknown)</span>
              ) : meta.length ? (
                <>
                  {meta.map((m) => m.key).join(", ")}: {fmtPct(sumC(meta).total / (total || 1), 2)} of sessions
                </>
              ) : (
                <>No channel matching Meta/Facebook/Instagram in this range (channel coverage {fmtPct(chKnown / (total || 1), 1)})</>
              )}
            </td>
          </tr>
          <tr>
            <td>Google mainly bottom-of-funnel?</td>
            <td style={{ textAlign: "left", whiteSpace: "normal" }}>
              {!google.length ? (
                <span className="pending">not evidenced (no channel value matching Google)</span>
              ) : (
                <>
                  Google ({google.map((x) => x.key).join(", ")}): {fmtPct(g.total / (total || 1), 1)} of sessions, non-bounce CR{" "}
                  {g.orders < MIN_ORDERS ? "insufficient sample" : fmtPct(g.nb ? g.orders / g.nb : null, 3)} vs other channels{" "}
                  {o.orders < MIN_ORDERS ? "insufficient sample" : fmtPct(o.nb ? o.orders / o.nb : null, 3)}. A higher CR is consistent with, not proof of, bottom-of-funnel intent.
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="grid two" style={{ marginTop: 12 }}>
        <div>
          <CohortTable title="Channel" list={ch} total={total} />
          <Stacked rows={scoped} dim="channel" reduced={reduced} />
        </div>
        <div>
          <CohortTable title="New vs returning" list={ct} total={total} />
          <Stacked rows={scoped} dim="customer_type" reduced={reduced} />
        </div>
      </div>
      <div className="note">
        Device split (web desktop vs mobile) is in D4. Orders here are session-attributed (dataset 63), the only order measure available by channel. Colour of the platform toggle:{" "}
        <span style={{ color: PLATFORM_COLOR[plat] }}>{plat === "web" ? "Web" : "App (iOS + Android)"}</span>.
      </div>
    </Panel>
  );
}
