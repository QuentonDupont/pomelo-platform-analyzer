"use client";

import { Fragment, useState } from "react";
import { fmtDate, fmtInt, fmtPct } from "@/lib/compute";
import { computeStep, FlowDef, FLOWS, FPlatform, METHOD_LABEL, StepDef, StepResult, weeksOverlapping } from "@/lib/dropoffs";
import { NotEvidenced, Panel, RealBadge } from "./shared";
import type { PanelProps } from "./types";

const COLS: { key: string; label: string; plats: FPlatform[] }[] = [
  { key: "web", label: "Web", plats: ["web"] },
  { key: "ios", label: "iOS", plats: ["ios"] },
  { key: "android", label: "Android", plats: ["android"] },
  { key: "app", label: "App (iOS + Android)", plats: ["ios", "android"] },
];

type Cell = { cur: StepResult; cmp: StepResult };

export default function Dropoffs(props: PanelProps) {
  const { api, f, cur, cmp } = props;
  const [showMethod, setShowMethod] = useState(true);
  const d = api.data.dropoffs;
  const allWeeks = [...new Set([...d.transitions.map((r) => r.week), ...d.flags.map((r) => r.week), ...d.users.map((r) => r.week)])];
  const wCur = weeksOverlapping(allWeeks, cur.from, cur.to);
  const wCmp = weeksOverlapping(allWeeks, cmp.from, cmp.to);
  const hasAny = d.transitions.length + d.flags.length + d.users.length > 0;

  const cell = (step: StepDef, flow: FlowDef, plats: FPlatform[]): Cell => ({
    cur: computeStep(step, flow, d, wCur, plats, f.markets),
    cmp: computeStep(step, flow, d, wCmp, plats, f.markets),
  });
  const grid = FLOWS.map((flow) => ({ flow, steps: flow.steps.map((step) => ({ step, cells: COLS.map((c) => cell(step, flow, c.plats)) })) }));
  // largest measured drop-off per column (exact/estimated rows only)
  const worst = COLS.map((_, ci) => {
    let best = -1;
    let key = "";
    for (const g of grid)
      for (const [si, s] of g.steps.entries()) {
        const v = s.cells[ci].cur.dropoff;
        if (v != null && (s.cells[ci].cur.base ?? 0) >= 30 && v > best) [best, key] = [v, `${g.flow.id}:${si}`];
      }
    return key;
  });

  return (
    <Panel
      id="panel-dropoffs"
      title="Funnel drop-offs by step"
      badge={<RealBadge />}
      sub={
        <>
          Drop-off % = share of sessions (or users) at a step that did not reach the next step. Weeks included: {wCur.length ? `${fmtDate(wCur[0])} – ${fmtDate(wCur[wCur.length - 1])}` : "none in range"} (weekly data; full Mon–Sun weeks
          overlapping your range), compared with {wCmp.length ? `${fmtDate(wCmp[0])} – ${fmtDate(wCmp[wCmp.length - 1])}` : "no earlier weeks"}. Darker red = bigger drop-off; the outlined cell is the largest drop-off in each column.
        </>
      }
      right={
        <button type="button" aria-pressed={showMethod} onClick={() => setShowMethod(!showMethod)}>
          {showMethod ? "Hide method notes" : "Show method notes"}
        </button>
      }
    >
      {!hasAny ? (
        <NotEvidenced what="Funnel step data" needs="the funnel snapshots (funnel_transitions / session_flags_weekly / user_funnel_weekly) — a data pull is in progress" />
      ) : (
        <div className="scroll">
          <table className="dropoffs">
            <thead>
              <tr>
                <th scope="col">Flow · step</th>
                {COLS.map((c) => (
                  <th key={c.key} scope="col" style={{ textAlign: "right" }}>
                    {c.label}
                  </th>
                ))}
                <th scope="col">How it is measured</th>
              </tr>
            </thead>
            <tbody>
              {grid.map(({ flow, steps }) => (
                <Fragment key={flow.id}>
                  <tr className="flow-row">
                    <th scope="rowgroup" colSpan={COLS.length + 2}>
                      {flow.label}
                      {flow.mapping && <span className="sub"> · {flow.mapping}</span>}
                    </th>
                  </tr>
                  {steps.map(({ step, cells }, si) => {
                    const m = METHOD_LABEL[step.method];
                    if (step.method === "not_evidenced")
                      return (
                        <tr key={si}>
                          <td className="step">
                            {step.from} → {step.to}
                          </td>
                          <td colSpan={COLS.length} className="muted" style={{ whiteSpace: "normal", textAlign: "left" }}>
                            Not measurable from current data. {step.note}
                          </td>
                          <td>
                            <span className="badge b-Low">{m.label}</span>
                          </td>
                        </tr>
                      );
                    return (
                      <tr key={si}>
                        <td className="step">
                          {step.from} → {step.to}
                        </td>
                        {cells.map((c, ci) => (
                          <DropCell key={COLS[ci].key} c={c} step={step} worst={worst[ci] === `${flow.id}:${si}`} label={`${flow.label}, ${step.from} to ${step.to}, ${COLS[ci].label}`} />
                        ))}
                        <td style={{ whiteSpace: "normal", textAlign: "left", minWidth: 180 }}>
                          <span className={`badge b-${m.tone}`}>{m.label}</span>
                          {showMethod && step.note && <div className="sub">{step.note}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="note">
        <strong>Exact</strong> = session-level flags in the Cube session table (5 markets, bot_flag = false; market filter applies). <strong>User-level</strong> = distinct users per week × platform × market (market filter applies).{" "}
        <strong>Estimate (arrivals)</strong> = event funnel from RudderStack (Sankey datasets): base is sessions that reached the step from an earlier step; all shops, not split by market or web device.{" "}
        <strong>Next-step split</strong> = the event funnel does not record exits, so only the share of sessions that moved on whose next step was the target is known; no drop-off % is shown. Exact numbers for every row need the per-session funnel dataset in{" "}
        <code>docs/FUNNEL_DATASET.sql</code>.
      </div>
    </Panel>
  );
}

function DropCell({ c, step, worst, label }: { c: Cell; step: StepDef; worst: boolean; label: string }) {
  if (step.method === "next_step") {
    const s = c.cur;
    return (
      <td className="dcell" aria-label={`${label}: drop-off not measurable; ${s.nextShare == null ? "no data" : `${fmtPct(s.nextShare, 1)} of ${fmtInt(s.movedOn)} sessions that moved on went here next`}`}>
        <div className="muted">n/a</div>
        <div className="small">{s.nextShare == null ? "no data" : `${fmtPct(s.nextShare, 1)} of ${fmtInt(s.movedOn)} moving on went here next`}</div>
      </td>
    );
  }
  const v = c.cur.dropoff;
  const base = c.cur.base ?? 0;
  if (v == null || base < 30)
    return (
      <td className="dcell">
        <span className="pending small">{v == null ? "no data" : "insufficient sample"}</span>
        {base > 0 && <div className="small muted">n {fmtInt(base)}</div>}
      </td>
    );
  const d = c.cmp.dropoff != null && (c.cmp.base ?? 0) >= 30 ? v - c.cmp.dropoff : null;
  const tint = `color-mix(in srgb, var(--div-neg) ${Math.round(8 + v * 55)}%, var(--panel))`;
  return (
    <td
      className={`dcell${worst ? " worst" : ""}`}
      style={{ background: tint }}
      title={`${fmtInt(c.cur.continued)} of ${fmtInt(base)} reached the next step${c.cur.ci ? ` · 95% CI of drop-off ${fmtPct(c.cur.ci[0], 1)}–${fmtPct(c.cur.ci[1], 1)}` : ""}`}
      aria-label={`${label}: drop-off ${fmtPct(v, 1)}, ${fmtInt(base)} at step, ${fmtInt(c.cur.continued)} continued${d != null ? `, ${d >= 0 ? "up" : "down"} ${(Math.abs(d) * 100).toFixed(1)} points vs comparison` : ""}`}
    >
      <div className="v">{fmtPct(v, 1)}</div>
      <div className="bar" aria-hidden>
        <span style={{ width: `${Math.max(2, v * 100)}%` }} />
      </div>
      <div className="small muted">
        {fmtInt(c.cur.continued)} / {fmtInt(base)} continued
      </div>
      {d != null && <div className={`small ${d > 0 ? "down arrow-up" : d < 0 ? "up arrow-down" : "flat"}`}>{`${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pp vs comparison`}</div>}
    </td>
  );
}
