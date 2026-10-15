"use client";

import { useState } from "react";
import { aggregate, filterRows, fmtDate, fmtInt, fmtPct, mondayOf, addDays } from "@/lib/compute";
import { NotEvidenced, Panel, PLATFORM_COLOR, PLATFORM_LABEL, RealBadge } from "./shared";
import type { PanelProps } from "./types";

type Step = { name: string; n: number };
type Who = "web" | "app" | "ios" | "android";

// Purchase-path stages of the event funnel (sign-in, login and wishlist are side paths and left out).
// Each session is counted once per stage, so summing the events inside a stage is exact.
const STAGES: { order: number[]; label: string; note?: string }[] = [
  { order: [3], label: "Product list (any source)" },
  { order: [4], label: "PDP" },
  { order: [5], label: "Quick add to cart", note: "web & iOS only" },
  { order: [6], label: "Add to cart (from PDP)" },
  { order: [7], label: "Cart view" },
  { order: [9], label: "Add address" },
  { order: [10], label: "Payment methods viewed", note: "apps only" },
  { order: [11], label: "Add payment" },
  { order: [12], label: "Order complete" },
];

/** Weekly event-funnel stages for weeks overlapping the range; App = iOS + Android summed. */
function eventFunnel(props: PanelProps, who: Who): { steps: (Step & { note?: string })[]; weeks: string[] } {
  const first = mondayOf(props.cur.from);
  const weeks = [...new Set(props.api.data.funnel.map((r) => r.week))].filter((w) => w >= first && w <= props.cur.to).sort();
  const plats = who === "app" ? ["ios", "android"] : [who];
  const byOrder = new Map<number, number>();
  for (const r of props.api.data.funnel) {
    if (!weeks.includes(r.week) || !plats.includes(r.platform)) continue;
    byOrder.set(r.stage_order, (byOrder.get(r.stage_order) ?? 0) + r.sessions);
  }
  const steps = STAGES.map((s) => ({ name: s.label, note: s.note, n: s.order.reduce((a, o) => a + (byOrder.get(o) ?? 0), 0) })).filter((s) => s.n > 0);
  return { steps, weeks };
}

export default function Funnel(props: PanelProps) {
  const [who, setWho] = useState<Who>(props.f.platform === "web" ? "web" : "app");
  const { cur, f } = props;
  const a = aggregate(filterRows(cur.rows, { from: cur.from, to: cur.to, platform: who, markets: f.markets, device: who === "web" ? f.device : "all" }), f.orders);
  const base: Step[] = [
    { name: "Sessions", n: a.total },
    { name: "Non-bounce", n: a.nb },
    ...(a.orders_known && !cur.ordersUnavailable ? [{ name: "Orders", n: a.orders }] : []),
  ];
  const ev = eventFunnel(props, who);
  return (
    <Panel
      id="panel-funnel"
      title="Flowing funnel"
      badge={<RealBadge />}
      sub="Particles that continue = step conversion; particles that fall = drop-off (each particle ≈ 5% of the previous step). Orders are backend orders — an operational ratio, not matched sessions."
      right={
        <span className="seg" role="group" aria-label="Funnel platform">
          {(["web", "app", "ios", "android"] as Who[]).map((p) => (
            <button key={p} type="button" aria-pressed={who === p} onClick={() => setWho(p)}>
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </span>
      }
    >
      <FlowSvg steps={base} color={PLATFORM_COLOR[who]} reduced={props.reduced} label="Sessions to orders" />
      {ev.steps.length > 1 ? (
        <>
          <h3>
            Purchase path in the event funnel · {ev.weeks.length === 1 ? `week of ${fmtDate(ev.weeks[0])}` : `weeks of ${fmtDate(ev.weeks[0])} – ${fmtDate(addDays(ev.weeks[ev.weeks.length - 1], 6))}`}
          </h3>
          <StageRows steps={ev.steps} color={PLATFORM_COLOR[who]} reduced={props.reduced} />
          <div className="note">
            Sessions that reached each step (RudderStack event funnel; all shops). Quick add and add from PDP are alternatives, not consecutive steps. Step-by-step drop-off % is on the{" "}
            <strong>Funnel drop-offs</strong> tab.
          </div>
        </>
      ) : (
        <NotEvidenced what="PDP → Add to bag → Checkout → Payment steps" needs="RudderStack session-event aggregates for the selected weeks (funnel_weekly snapshot)" />
      )}
    </Panel>
  );
}

function FlowSvg({ steps, color, reduced, label }: { steps: Step[]; color: string; reduced: boolean; label: string }) {
  const W = 640;
  const H = 150;
  const col = W / Math.max(1, steps.length);
  const max = Math.max(1, steps[0]?.n ?? 1);
  const drops = steps.map((s, i) => (i === 0 ? null : steps[i - 1].n ? s.n / steps[i - 1].n : null));
  const worst = drops.reduce<number>((wi, d, i) => (d != null && (drops[wi] == null || d < (drops[wi] as number)) ? i : wi), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${label}: ${steps.map((s) => `${s.name} ${fmtInt(s.n)}`).join(", ")}`}>
      {steps.map((s, i) => {
        const h = Math.max(3, Math.sqrt(s.n / max) * 90);
        const x = i * col + col / 2;
        return (
          <g key={s.name}>
            <rect x={x - 22} y={100 - h} width={44} height={h} rx={4} fill={color} opacity={0.85} />
            <text x={x} y={116} textAnchor="middle" fontSize="11" fill="var(--ink)" fontWeight={600}>
              {s.name}
            </text>
            <text x={x} y={130} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {fmtInt(s.n)}
            </text>
          </g>
        );
      })}
      {steps.slice(1).map((s, k) => {
        const i = k + 1;
        const rate = drops[i] ?? 0;
        const x0 = (i - 1) * col + col / 2 + 24;
        const x1 = i * col + col / 2 - 24;
        const keep = Math.round(rate * 20);
        const isWorst = i === worst && steps.length > 2;
        return (
          <g key={`flow-${s.name}`}>
            {!reduced &&
              Array.from({ length: 20 }, (_, p) => {
                const continues = p < keep;
                return (
                  <circle
                    key={p}
                    className={continues ? "particle flow" : "particle fall"}
                    cx={x0}
                    cy={60 + ((p * 7) % 30) - 15}
                    r={2.2}
                    fill={continues ? color : "var(--bad)"}
                    style={{ ["--dx" as string]: `${x1 - x0}px`, animationDelay: `${(p * 0.13).toFixed(2)}s` }}
                  />
                );
              })}
            <text x={(x0 + x1) / 2} y={22} textAnchor="middle" fontSize="11" fill={isWorst ? "var(--bad)" : "var(--ink)"} fontWeight={isWorst ? 700 : 500}>
              {fmtPct(rate, 1)} continue
            </text>
            <text x={(x0 + x1) / 2} y={36} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {fmtPct(1 - rate, 1)} drop{isWorst ? " · largest" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** One readable row per step: name · bar · sessions · share of product-list sessions. Works for any number of steps. */
function StageRows({ steps, color, reduced }: { steps: (Step & { note?: string })[]; color: string; reduced: boolean }) {
  const top = Math.max(1, steps[0]?.n ?? 1);
  return (
    <table className="stage-rows">
      <thead>
        <tr>
          <th scope="col">Step</th>
          <th scope="col" aria-label="Share of product-list sessions, as a bar" />
          <th scope="col">Sessions</th>
          <th scope="col">% of product-list sessions</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.name}>
            <th scope="row">
              {s.name}
              {s.note && <span className="sub"> · {s.note}</span>}
            </th>
            <td className="bar-cell">
              <span className="bar-track" aria-hidden>
                <span className="bar-fill" style={{ width: `${Math.max(1, (s.n / top) * 100)}%`, background: color, transition: reduced ? "none" : undefined }} />
              </span>
            </td>
            <td>{fmtInt(s.n)}</td>
            <td>{fmtPct(s.n / top, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
