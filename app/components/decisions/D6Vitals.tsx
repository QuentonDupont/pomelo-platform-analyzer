"use client";

import { useEffect, useState } from "react";
import { getClient } from "../client";
import { aggregate, fmtInt, fmtPct, rates } from "@/lib/compute";
import { MIN_SESSIONS } from "@/server/metrics/definitions";
import { NotEvidenced, Panel, RealBadge } from "../shared";
import type { PanelProps } from "../types";

type Vital = { key: string; label: string; formFactor: "PHONE" | "DESKTOP"; lcp: number | null; inp: number | null; cls: number | null; status: string };
type Envelope = { data?: Vital[]; source?: string; error?: { message: string } };

const TH = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25] } as const;
function grade(v: number | null, t: readonly [number, number]) {
  if (v == null) return { txt: "no data", cls: "flat" };
  if (v <= t[0]) return { txt: "good", cls: "up" };
  if (v <= t[1]) return { txt: "needs improvement", cls: "pending" };
  return { txt: "poor", cls: "down" };
}

export default function D6Vitals({ f, cur }: PanelProps) {
  const [env, setEnv] = useState<Envelope | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getClient()
      .vitals()
      .then((j) => alive && setEnv(j as Envelope))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "request failed"));
    return () => {
      alive = false;
    };
  }, []);

  const data = env?.data ?? [];
  const webBounce = (device: "mobile" | "desktop") => {
    const a = aggregate(cur.rows.filter((r) => r.platform === "web" && r.device === device && f.markets.includes(r.market)), f.orders);
    return { br: a.total >= MIN_SESSIONS ? rates(a).bounce_rate : null, n: a.total };
  };
  const origin = data.filter((v) => v.key === "origin");
  const points = origin
    .map((v) => ({ v, b: webBounce(v.formFactor === "PHONE" ? "mobile" : "desktop") }))
    .filter((p) => p.v.lcp != null && p.b.br != null);

  return (
    <Panel id="panel-d6" title="D6 · Site speed & experience (web)" badge={data.length ? <RealBadge text="CrUX field data" /> : undefined} sub={env?.source ?? (err ? `Vitals request failed: ${err}` : "Loading vitals source…")}>
      {!data.length ? (
        <NotEvidenced what="Core Web Vitals" needs="CRUX_API_KEY (CrUX) or a RUM source — www#4036 web-vitals not live" />
      ) : (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Page / section</th>
                  <th>Form factor</th>
                  <th>LCP p75</th>
                  <th>INP p75</th>
                  <th>CLS p75</th>
                </tr>
              </thead>
              <tbody>
                {data.map((v) => {
                  const l = grade(v.lcp, TH.lcp);
                  const i = grade(v.inp, TH.inp);
                  const c = grade(v.cls, TH.cls);
                  return (
                    <tr key={`${v.key}-${v.formFactor}`}>
                      <td>{v.label}</td>
                      <td>{v.formFactor === "PHONE" ? "Phone" : "Desktop"}</td>
                      <td>
                        {v.lcp == null ? "—" : `${fmtInt(v.lcp)} ms`} <span className={l.cls}>({l.txt})</span>
                      </td>
                      <td>
                        {v.inp == null ? "—" : `${fmtInt(v.inp)} ms`} <span className={i.cls}>({i.txt})</span>
                      </td>
                      <td>
                        {v.cls == null ? "—" : v.cls.toFixed(3)} <span className={c.cls}>({c.txt})</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h3 style={{ fontSize: 13, margin: "14px 0 4px" }}>Bounce rate vs LCP (origin, by device)</h3>
          {points.length < 1 ? (
            <div className="note">Not enough overlapping data (needs origin LCP and ≥ {MIN_SESSIONS} web sessions per device in range).</div>
          ) : (
            <svg viewBox="0 0 420 200" width="100%" style={{ maxWidth: 520 }} role="img" aria-label="Web bounce rate versus LCP by device">
              <line x1={40} x2={410} y1={170} y2={170} stroke="var(--line)" />
              <line x1={40} x2={40} y1={10} y2={170} stroke="var(--line)" />
              <text x={225} y={195} fontSize="10" textAnchor="middle" fill="var(--muted)">
                LCP p75 (ms, 0–6000)
              </text>
              <text x={10} y={90} fontSize="10" fill="var(--muted)" transform="rotate(-90 10 90)" textAnchor="middle">
                Bounce rate
              </text>
              {[2500, 4000].map((t) => (
                <line key={t} x1={40 + (t / 6000) * 370} x2={40 + (t / 6000) * 370} y1={10} y2={170} stroke="var(--line)" strokeDasharray="3 3" />
              ))}
              {points.map(({ v, b }) => {
                const x = 40 + (Math.min(6000, v.lcp!) / 6000) * 370;
                const y = 170 - b.br! * 160;
                return (
                  <g key={v.formFactor}>
                    <circle cx={x} cy={y} r={6} fill={v.formFactor === "PHONE" ? "var(--web)" : "var(--app)"} />
                    <text x={x + 9} y={y + 4} fontSize="10" fill="var(--ink)">
                      {v.formFactor === "PHONE" ? "Mobile" : "Desktop"}: {fmtPct(b.br, 1)}, {fmtInt(v.lcp)} ms (n={fmtInt(b.n)})
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
          <div className="note">CrUX is a 28-day rolling p75 and is not aligned to the selected range; read the pairing as context, not as a relationship.</div>
        </>
      )}
      <div style={{ marginTop: 10 }}>
        <NotEvidenced what="JS error rate per section" needs="an error-monitoring source (Sentry or Datadog RUM) connected to the dashboard" />
      </div>
    </Panel>
  );
}
