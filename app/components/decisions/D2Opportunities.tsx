"use client";

import { useState } from "react";
import { aggregate, Benchmark, filterRows, fmtInt, fmtPct, fmtUsd, funnelOpportunities, mondayOf, Opportunity, rankOpportunities, rates, webOpportunities } from "@/lib/compute";
import { Market, MARKETS } from "@/server/metrics/definitions";
import { Panel, RealBadge } from "../shared";
import type { PanelProps } from "../types";

const ALL = MARKETS.map((m) => m.id) as Market[];

export default function D2Opportunities(props: PanelProps) {
  const [scope, setScope] = useState<"th" | "all">("th");
  const [bench, setBench] = useState<Benchmark>("app");
  const { cur, f } = props;
  const markets: Market[] = scope === "th" ? ["TH"] : ALL;
  const flt = { from: cur.from, to: cur.to, platform: "web" as const, markets, device: "all" as const };
  const web = aggregate(filterRows(cur.rows, flt), f.orders);
  const aov = rates(web).aov ?? 0;
  const segs = webOpportunities(cur.rows, flt, bench, f.orders);

  // Funnel steps (weekly grain) for weeks overlapping the range, web vs app.
  const first = mondayOf(cur.from);
  const weeks = [...new Set(props.api.data.funnel.map((r) => r.week))].filter((w) => w >= first && w <= cur.to);
  const stages = (plats: string[]) => {
    const m = new Map<string, { stage: string; stage_order: number; sessions: number }>();
    for (const r of props.api.data.funnel) {
      if (!weeks.includes(r.week) || !plats.includes(r.platform)) continue;
      const x = m.get(r.stage) ?? { stage: r.stage, stage_order: r.stage_order, sessions: 0 };
      x.sessions += r.sessions;
      m.set(r.stage, x);
    }
    return [...m.values()];
  };
  const webStages = stages(["web"]);
  const lastStage = [...webStages].sort((a, b) => b.stage_order - a.stage_order)[0];
  const funnel = webStages.length > 1 && !cur.ordersUnavailable ? funnelOpportunities(webStages, stages(["ios", "android"]), Math.min(web.orders, lastStage?.sessions ?? 0), aov, weeks.length) : [];
  const section: Opportunity = {
    key: "section",
    label: "Site section bounce (home, listing, PDP, …)",
    kind: "section",
    sessions: 0,
    current: null,
    benchmark: null,
    benchLabel: "—",
    recoverable: 0,
    ras: 0,
    conf: "Low",
    hypothesis: "Not evidenced: dataset 63 has no page/section column",
    metric: "Needs RudderStack pages",
    evidenced: false,
  };
  const rows = rankOpportunities([...segs, ...funnel, section]);
  const top = rows.find((r) => r.evidenced && r.conf !== "Low");

  return (
    <Panel
      id="panel-d2"
      title="D2 · Web opportunity board — where to optimise next"
      badge={<RealBadge />}
      sub={
        <>
          Weekly revenue at stake = recoverable sessions × segment non-bounce CR × AOV ({fmtUsd(aov, 2)}), scaled to 7 days. Ranked by revenue at stake; low-confidence and unevidenced rows are greyed and never ranked first.
          Hypotheses need a test.
        </>
      }
      right={
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="seg" role="group" aria-label="Scope">
            <button type="button" aria-pressed={scope === "th"} onClick={() => setScope("th")}>
              Thailand web
            </button>
            <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              Web 5 markets
            </button>
          </span>
          <select value={bench} onChange={(e) => setBench(e.target.value as Benchmark)} aria-label="Benchmark">
            <option value="app">Benchmark: App, same market</option>
            <option value="peer">Benchmark: other web device, same market</option>
            <option value="trailing">Benchmark: own best of trailing 4 periods</option>
          </select>
        </div>
      }
    >
      {top && (
        <div className="callout">
          Largest evidenced item: <strong>{top.label}</strong> — {fmtUsd(top.ras)} / week at stake ({top.conf} confidence). Next test (hypothesis): {top.hypothesis}. Success measure: {top.metric}.
        </div>
      )}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th style={{ textAlign: "left" }}>Opportunity</th>
              <th>Sessions</th>
              <th>Current</th>
              <th>Benchmark</th>
              <th>Recoverable / wk</th>
              <th>Revenue at stake / wk</th>
              <th>Confidence</th>
              <th style={{ textAlign: "left" }}>Hypothesis — needs test · success metric</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => (
              <tr key={o.key} className={o.conf === "Low" || !o.evidenced ? "low" : ""}>
                <td>{i + 1}</td>
                <td style={{ textAlign: "left" }}>
                  {o.label} <span className="sub">{o.kind}</span>
                </td>
                <td>{o.sessions ? fmtInt(o.sessions) : "—"}</td>
                <td>{fmtPct(o.current, 1)}</td>
                <td>
                  {fmtPct(o.benchmark, 1)}
                  <div className="sub">{o.benchLabel}</div>
                </td>
                <td>{o.evidenced ? fmtInt(o.recoverable) : "—"}</td>
                <td>
                  <strong>{o.evidenced ? fmtUsd(o.ras) : "not evidenced"}</strong>
                </td>
                <td>
                  <span className={`badge b-${o.conf}`}>{o.evidenced ? o.conf : "n/a"}</span>
                </td>
                <td className="hyp">
                  {o.hypothesis} {o.evidenced && <em>(hypothesis — needs test)</em>} · <strong>{o.metric}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!funnel.length && <div className="note">Funnel-step rows appear when weekly RudderStack funnel aggregates exist for the selected weeks.</div>}
    </Panel>
  );
}
