"use client";

import { useState } from "react";
import { aggregate, filterRows, fmtInt, fmtPct, mondayOf, addDays } from "@/lib/compute";
import { NotEvidenced, Panel, PLATFORM_COLOR, PLATFORM_LABEL, RealBadge } from "./shared";
import type { PanelProps } from "./types";

type Step = { name: string; n: number };
type Who = "web" | "app" | "ios" | "android";

/** Weekly RudderStack-derived funnel stages for weeks overlapping the range; App = iOS + Android summed. */
function eventFunnel(props: PanelProps, who: Who): { steps: Step[]; weeks: string[] } {
  const first = mondayOf(props.cur.from);
  const weeks = [...new Set(props.api.data.funnel.map((r) => r.week))].filter((w) => w >= first && w <= props.cur.to);
  const plats = who === "app" ? ["ios", "android"] : [who];
  const m = new Map<string, { n: number; o: number }>();
  for (const r of props.api.data.funnel) {
    if (!weeks.includes(r.week) || !plats.includes(r.platform)) continue;
    const x = m.get(r.stage) ?? { n: 0, o: r.stage_order };
    x.n += r.sessions;
    m.set(r.stage, x);
  }
  return { steps: [...m.entries()].sort((a, b) => a[1].o - b[1].o).map(([name, v]) => ({ name, n: v.n })), weeks };
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
          <div className="sub" style={{ marginTop: 10 }}>
            Event funnel (weekly grain, weeks of {ev.weeks.join(", ")} – {addDays(ev.weeks[ev.weeks.length - 1], 6)}), sessions reaching each stage
          </div>
          <FlowSvg steps={ev.steps} color={PLATFORM_COLOR[who]} reduced={props.reduced} label="Event funnel" />
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
