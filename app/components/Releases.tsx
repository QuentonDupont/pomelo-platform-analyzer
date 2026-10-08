"use client";

import { useState } from "react";
import { addDays, fmtDate, fmtInt, fmtPct, fmtUsd } from "@/lib/compute";
import { Panel, PendingBadge, PLATFORM_COLOR, RealBadge } from "./shared";
import type { PanelProps, ReleaseView } from "./types";

const LANES = ["web", "ios", "android", "backend"] as const;
const VERDICT_COLOR: Record<string, string> = {
  "moved as expected": "var(--good)",
  "moved opposite": "var(--bad)",
  "no clear change": "var(--muted)",
  immature: "var(--amber)",
  "not computable": "var(--unknown)",
};
const fmtMetric = (id: string, v: number | null) => (v == null ? "—" : id === "aov" || id === "rev_per_nb_session" ? fmtUsd(v, id === "aov" ? 2 : 3) : fmtPct(v, id === "nonbounce_cr" ? 3 : 1));
const fmtDiff = (id: string, v: number | null) =>
  v == null ? "—" : id === "aov" || id === "rev_per_nb_session" ? `${v >= 0 ? "+" : "−"}${fmtUsd(Math.abs(v), 3)}` : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(id === "nonbounce_cr" ? 3 : 2)} pp`;

export default function Releases(props: PanelProps) {
  const rels = props.api.data.releases;
  const [open, setOpen] = useState<ReleaseView | null>(null);
  const from = addDays(props.cur.from, -14);
  const to = addDays(props.cur.to, 14);
  const inView = rels.filter((r) => r.bangkok_date >= from && r.bangkok_date <= to);
  const t = (d: string) => new Date(d + "T00:00:00Z").getTime();
  const W = 900;
  const x = (d: string) => 70 + ((t(d) - t(from)) / Math.max(1, t(to) - t(from))) * (W - 90);
  const ticks: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) ticks.push(d);
  const inRange = rels.filter((r) => r.bangkok_date >= props.cur.from && r.bangkok_date <= props.cur.to);
  return (
    <>
      <Panel
        id="panel-releases"
        title="Release timeline"
        badge={<RealBadge text="REAL — GitHub production deploys" />}
        sub="Flag = production go-live (successful prod deploy run; Android = tag, weak). Dot colour = success-metric verdict vs 14-day baseline (not causal). Shaded = selected range. Click a flag."
      >
        <svg viewBox={`0 0 ${W} 150`} width="100%" role="group" aria-label="Release timeline">
          <rect x={x(props.cur.from)} y={6} width={Math.max(2, x(props.cur.to) - x(props.cur.from))} height={116} fill="var(--line)" opacity=".5" />
          {ticks.map((d) => (
            <text key={d} x={x(d)} y={140} fontSize="10" fill="var(--muted)">
              {fmtDate(d)}
            </text>
          ))}
          {LANES.map((l, li) => (
            <text key={l} x={0} y={30 + li * 28} fontSize="11" fill={PLATFORM_COLOR[l]} fontWeight={600}>
              {l}
            </text>
          ))}
          {inView.map((r) => {
            const y = 34 + LANES.indexOf(r.platform) * 28;
            const v = r.impacts[0]?.verdict ?? "not computable";
            return (
              <g key={r.id} className="flag" tabIndex={0} role="button" aria-label={`${r.repo} ${r.release_id} on ${r.bangkok_date}, ${r.prs.length} PRs, ${v}`} onClick={() => setOpen(r)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(r)}>
                <title>{`${r.repo} ${r.release_id} · ${r.bangkok_date} · ${r.prs.length} PR(s) · ${r.metric.label}: ${v}`}</title>
                <line x1={x(r.bangkok_date)} x2={x(r.bangkok_date)} y1={y - 18} y2={y + 2} stroke={PLATFORM_COLOR[r.platform]} strokeWidth="1.5" />
                <path d={`M${x(r.bangkok_date)},${y - 18} l10,4 l-10,4 z`} fill={PLATFORM_COLOR[r.platform]} />
                <circle cx={x(r.bangkok_date)} cy={y + 5} r={3} fill={VERDICT_COLOR[v]} />
              </g>
            );
          })}
        </svg>
        <div className="legend">
          {Object.entries(VERDICT_COLOR).map(([k, c]) => (
            <span key={k}>
              <span className="sw" style={{ background: c }} />
              {k}
            </span>
          ))}
        </div>
        {open && <ReleaseCard r={open} onClose={() => setOpen(null)} props={props} />}
      </Panel>
      <Panel id="panel-release-table" title={`Releases in range (${inRange.length})`} sub="Baseline = 14 days before go-live; post = go-live day 0–13 (days 0–6 immature). Bundled PRs are confounded: attribution is to the deploy only.">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Go-live (ICT)</th>
                <th>Release</th>
                <th>PRs</th>
                <th>Success metric</th>
                <th>Baseline → post</th>
                <th>Change [95% CI]</th>
                <th>n (base / post)</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {inRange.map((r) =>
                r.impacts.map((i, k) => (
                  <tr key={`${r.id}-${k}`}>
                    <td>{k === 0 ? r.bangkok_date : ""}</td>
                    <td style={{ textAlign: "left" }}>
                      {k === 0 && (
                        <button type="button" className="linklike" onClick={() => setOpen(r)}>
                          {r.repo} {r.release_id}
                        </button>
                      )}{" "}
                      <span className="sub">{i.scope}</span>
                    </td>
                    <td>{k === 0 ? `${r.prs.length}${r.confounded ? " (confounded)" : ""}` : ""}</td>
                    <td style={{ textAlign: "left" }}>
                      {r.metric.label} {r.metric.direction === "up" ? "↑" : "↓"} <span className={`badge ${r.metric.source === "declared" ? "b-High" : "b-Low"}`}>{r.metric.source}</span>
                    </td>
                    <td>{i.computable ? `${fmtMetric(i.metric, i.baseline.value)} → ${fmtMetric(i.metric, i.post.value)}` : <span className="muted">{i.reason}</span>}</td>
                    <td>{i.computable ? `${fmtDiff(i.metric, i.diff)} [${i.ci ? `${fmtDiff(i.metric, i.ci[0])}, ${fmtDiff(i.metric, i.ci[1])}` : "—"}]` : "—"}</td>
                    <td>
                      {fmtInt(i.baseline.n)} / {fmtInt(i.post.n)}
                    </td>
                    <td style={{ color: VERDICT_COLOR[i.verdict] }}>{i.verdict}</td>
                  </tr>
                )),
              )}
              {!inRange.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No production releases in the selected range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function ReleaseCard({ r, onClose, props }: { r: ReleaseView; onClose: () => void; props: PanelProps }) {
  // App adoption: Android tags map to app versions directly ("v4.88.13" → "4.88.13"); iOS releases are SHAs (mapping pending).
  const version = r.platform === "android" || r.platform === "ios" ? (r.release_id ?? "").replace(/^v/, "") : null;
  const adoption =
    version && /^\d+\.\d+/.test(version)
      ? [...new Set(props.api.data.app_versions.map((v) => v.week))].sort().map((w) => {
          const rows = props.api.data.app_versions.filter((v) => v.week === w && v.platform === r.platform);
          const all = rows.reduce((a, v) => a + v.total_sessions, 0);
          const mine = rows.filter((v) => v.version === version).reduce((a, v) => a + v.total_sessions, 0);
          return { w, share: all ? mine / all : null, n: all };
        })
      : null;
  return (
    <div className="card" style={{ borderColor: PLATFORM_COLOR[r.platform] }} role="dialog" aria-label={`Release ${r.repo} ${r.release_id}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong>
          {r.repo} {r.release_id}
        </strong>
        <button type="button" onClick={onClose} aria-label="Close release card">
          ×
        </button>
      </div>
      <div className="sub">
        {r.platform} · go-live {r.bangkok_date} ICT ({r.go_live_at ?? "—"} UTC) · signal: {r.signal} · {r.prs.length} PR(s){" "}
        {r.confounded ? <PendingBadge text="confounded — bundled PRs, deploy-level attribution only" /> : null}
      </div>
      {r.note && <div className="note">{r.note}</div>}
      <div style={{ marginTop: 6 }}>
        Success metric: <strong>{r.metric.label}</strong> expected {r.metric.direction} · surface {r.metric.surface}{" "}
        <span className={`badge ${r.metric.source === "declared" ? "b-High" : "b-Low"}`}>{r.metric.source}</span>
      </div>
      {r.impacts.map((i) => (
        <div key={i.scope} style={{ marginTop: 6 }}>
          <strong>{i.scope === "web" ? "Web" : r.platform === "ios" ? "iOS" : r.platform === "android" ? "Android" : "App"}:</strong>{" "}
          {i.computable ? (
            <>
              baseline {fmtMetric(i.metric, i.baseline.value)} (n={fmtInt(i.baseline.n)}, {i.baseline.from}…{i.baseline.to}) → post {fmtMetric(i.metric, i.post.value)} (n={fmtInt(i.post.n)}, {i.post.days} days) · change{" "}
              {fmtDiff(i.metric, i.diff)} [{i.ci ? `${fmtDiff(i.metric, i.ci[0])}, ${fmtDiff(i.metric, i.ci[1])}` : "—"}] {i.ci_method} · <span style={{ color: VERDICT_COLOR[i.verdict] }}>{i.verdict}</span>
              {i.maturity !== "complete" && <span className="pending"> ({i.maturity})</span>}
            </>
          ) : (
            <span className="muted">not computable — {i.reason}</span>
          )}
        </div>
      ))}
      <div className="note">Change vs baseline only — not a causal effect. Overlapping releases below may explain part of any change.</div>
      {r.confounders.length > 0 && (
        <div style={{ marginTop: 4 }}>
          Confounders ({r.confounders.length}): <span className="muted">{r.confounders.map((c) => `${c.repo} ${c.date}`).join(" · ")}</span> · promotions: <span className="pending">source not connected</span>
        </div>
      )}
      {adoption && (
        <div style={{ marginTop: 6 }}>
          Adoption of {version} (share of {r.platform} sessions with a known version):{" "}
          {adoption.map((a) => `${fmtDate(a.w)} ${a.share == null ? "—" : fmtPct(a.share, 0)}`).join(" · ")}
        </div>
      )}
      {(r.platform === "ios" || r.platform === "android") && !adoption && <div className="note">Version cohort comparison: <span className="pending">mapping build SHA → app version pending</span>.</div>}
      {r.prs.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary>PRs in this release</summary>
          <ul style={{ margin: "6px 0", paddingLeft: 18, maxHeight: 180, overflow: "auto" }}>
            {r.prs.map((p) => (
              <li key={p.number}>
                #{p.number} {p.title} <span className="sub">· {p.surface} → {p.success_metric} ({p.metric_source})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
