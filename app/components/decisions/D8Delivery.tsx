"use client";

import { fmtDate, fmtInt, fmtPct } from "@/lib/compute";
import { Panel, PLATFORM_COLOR, RealBadge } from "../shared";
import type { HealthRow, PanelProps } from "../types";

const LABEL: Record<HealthRow["platform"], string> = { web: "Web (www)", ios: "iOS", android: "Android", backend: "Backend (api)" };

function Bars({ h, max, reduced }: { h: HealthRow; max: number; reduced: boolean }) {
  const W = 240;
  const H = 56;
  const n = Math.max(1, h.per_week.length);
  const bw = (W - 4) / n;
  return (
    <svg viewBox={`0 0 ${W} ${H + 12}`} width="100%" role="img" aria-label={`${LABEL[h.platform]} production deploys per week`}>
      {h.per_week.map((w, i) => {
        const bh = max ? (w.deploys / max) * H : 0;
        return (
          <g key={w.week}>
            <rect
              x={2 + i * bw + 1}
              y={H - bh}
              width={Math.max(1, bw - 2)}
              height={bh}
              fill={PLATFORM_COLOR[h.platform]}
              rx={1.5}
              style={reduced ? undefined : { transition: "height .5s, y .5s" }}
            >
              <title>{`Week of ${w.week}: ${w.deploys} production deploy(s)`}</title>
            </rect>
            {w.deploys > 0 && bw > 12 && (
              <text x={2 + i * bw + bw / 2} y={H - bh - 2} fontSize="8" textAnchor="middle" fill="var(--muted)">
                {w.deploys}
              </text>
            )}
          </g>
        );
      })}
      <line x1={0} x2={W} y1={H} y2={H} stroke="var(--line)" />
      {h.per_week.length > 0 && (
        <>
          <text x={2} y={H + 10} fontSize="8" fill="var(--muted)">
            {fmtDate(h.per_week[0].week)}
          </text>
          <text x={W - 2} y={H + 10} fontSize="8" textAnchor="end" fill="var(--muted)">
            {fmtDate(h.per_week[h.per_week.length - 1].week)}
          </text>
        </>
      )}
    </svg>
  );
}

export default function D8Delivery(props: PanelProps) {
  const health = props.api.data.health;
  const max = Math.max(1, ...health.flatMap((h) => h.per_week.map((w) => w.deploys)));
  return (
    <Panel
      id="panel-releases-health"
      title="D8 · Release & delivery health"
      badge={<RealBadge text="REAL — GitHub production deploys" />}
      sub="Is engineering effort translating into measurable outcomes? Go-live = successful production deploy run (not merge time). Movement is change vs baseline, not causal."
    >
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {health.map((h) => (
          <div key={h.platform}>
            <div style={{ fontWeight: 600, color: PLATFORM_COLOR[h.platform] }}>
              {LABEL[h.platform]} <span className="sub">· {fmtInt(h.releases)} releases · {fmtInt(h.prs)} PRs</span>
            </div>
            <Bars h={h} max={max} reduced={props.reduced} />
          </div>
        ))}
      </div>
      <div className="scroll">
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Releases</th>
              <th>Declared success metric</th>
              <th>Moved as expected (not causal)</th>
              <th>Hotfix / rollback ≤ 7 days</th>
              <th>Bundled (confounded)</th>
            </tr>
          </thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.platform}>
                <td>{LABEL[h.platform]}</td>
                <td>{fmtInt(h.releases)}</td>
                <td className={h.declared_share === 0 ? "down" : undefined}>{fmtPct(h.declared_share, 0)}</td>
                <td>
                  {h.judged ? (
                    <>
                      {fmtPct(h.moved_expected_share, 0)} <span className="sub">of {h.judged} judged</span>
                    </>
                  ) : (
                    <span className="muted">none judged yet</span>
                  )}
                </td>
                <td>{fmtInt(h.hotfix_within_7d)}</td>
                <td>{fmtPct(h.confounded_share, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        No PR currently declares a success metric, so every release metric is <em>inferred</em> from changed paths (config/path-map.yml). Adding a
        &ldquo;Success metric: … | Surface: … | Platform: … | Expected direction: up/down&rdquo; line to PR bodies fixes this — see docs/PR_TEMPLATE_SNIPPET.md.
        &ldquo;Judged&rdquo; = releases whose metric was computable with ≥ 7 post-release days; hotfix = release with hotfix/revert/rollback PR or a patch-level
        version within 7 days of a prior release.
      </p>
    </Panel>
  );
}
