"use client";

import { fmtDate, fmtInt, fmtPct, mondayOf } from "@/lib/compute";
import { MIN_ORDERS, MIN_SESSIONS } from "@/lib/metrics";
import { NotEvidenced, Panel, PLATFORM_COLOR, PLATFORM_LABEL, RealBadge } from "../shared";
import type { AppVersionRow, PanelProps } from "../types";

const vparts = (v: string) => v.replace(/^v/i, "").split(/[.\-+ ]/).map((x) => parseInt(x, 10) || 0);
export function cmpVersion(a: string, b: string) {
  const x = vparts(a);
  const y = vparts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function Adoption({ rows, latest, color }: { rows: AppVersionRow[]; latest: string; color: string }) {
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  const pts = weeks.map((w) => {
    const known = rows.filter((r) => r.week === w && r.version !== "unknown");
    const tot = known.reduce((a, r) => a + r.total_sessions, 0);
    const lat = known.filter((r) => r.version === latest).reduce((a, r) => a + r.total_sessions, 0);
    return { w, share: tot ? lat / tot : null, n: tot };
  });
  const W = 300;
  const H = 80;
  const x = (i: number) => 24 + (i / Math.max(1, pts.length - 1)) * (W - 48);
  const y = (s: number) => 8 + (1 - s) * (H - 28);
  const line = pts
    .map((p, i) => (p.share == null ? null : `${x(i)},${y(p.share)}`))
    .filter(Boolean)
    .join(" ");
  const last = [...pts].reverse().find((p) => p.share != null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Adoption of version ${latest} by week; latest ${last ? fmtPct(last.share, 0) : "no data"}`}>
      <line x1={24} x2={W - 24} y1={y(0)} y2={y(0)} stroke="var(--line)" />
      <line x1={24} x2={W - 24} y1={y(1)} y2={y(1)} stroke="var(--line)" strokeDasharray="2 4" />
      <text x={2} y={y(1) + 3} fontSize="8" fill="var(--muted)">100%</text>
      <text x={2} y={y(0) + 3} fontSize="8" fill="var(--muted)">0%</text>
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" />
      {pts.map((p, i) =>
        p.share == null ? null : (
          <g key={p.w}>
            <circle cx={x(i)} cy={y(p.share)} r={3} fill={color}>
              <title>{`Week of ${p.w}: ${fmtPct(p.share, 1)} of ${fmtInt(p.n)} known-version sessions`}</title>
            </circle>
            <text x={x(i)} y={H - 4} fontSize="8" textAnchor="middle" fill="var(--muted)">
              {fmtDate(p.w)}
            </text>
          </g>
        ),
      )}
      {last && (
        <text x={W - 22} y={y(last.share!) - 6} fontSize="10" textAnchor="end" fill="var(--ink)" fontWeight={600}>
          {fmtPct(last.share, 0)}
        </text>
      )}
    </svg>
  );
}

function PlatformBlock({ p, props }: { p: "ios" | "android"; props: PanelProps }) {
  const { api, cur } = props;
  const all = api.data.app_versions.filter((r) => r.platform === p);
  const inRange = all.filter((r) => r.week >= mondayOf(cur.from) && r.week <= cur.to);
  const versions = [...new Set(all.map((r) => r.version).filter((v) => v !== "unknown"))].sort(cmpVersion);
  const latest = versions[versions.length - 1];
  const appSessions = cur.rows.filter((r) => r.platform === p).reduce((a, r) => a + r.total, 0);
  const known = inRange.filter((r) => r.version !== "unknown").reduce((a, r) => a + r.total_sessions, 0);
  const byVersion = new Map<string, { s: number; b: number; nb: number; o: number | null }>();
  for (const r of inRange) {
    const x = byVersion.get(r.version) ?? { s: 0, b: 0, nb: 0, o: null };
    x.s += r.total_sessions;
    x.b += r.bounces;
    x.nb += r.non_bounces;
    if (r.orders != null) x.o = (x.o ?? 0) + r.orders;
    byVersion.set(r.version, x);
  }
  const table = [...byVersion.entries()].sort((a, b) => (a[0] === "unknown" ? 1 : b[0] === "unknown" ? -1 : cmpVersion(b[0], a[0])));
  const shown = table.filter(([v]) => v !== "unknown").slice(0, 8);
  const other = table.filter(([v]) => v !== "unknown").slice(8);
  const unknown = byVersion.get("unknown");
  const otherAgg = other.reduce((a, [, x]) => ({ s: a.s + x.s, b: a.b + x.b, nb: a.nb + x.nb, o: x.o == null ? a.o : (a.o ?? 0) + x.o }), { s: 0, b: 0, nb: 0, o: null as number | null });
  const weeks = [...new Set(all.map((r) => r.week))].sort();
  const androidRel = api.data.releases.filter((r) => r.platform === "android");
  const lastAndroid = androidRel[androidRel.length - 1];

  const row = (label: string, x: { s: number; b: number; nb: number; o: number | null }, key: string) => (
    <tr key={key}>
      <td>{label}</td>
      <td>{fmtInt(x.s)}</td>
      <td>{x.s < MIN_SESSIONS ? <span className="pending">insufficient sample</span> : fmtPct(x.b / x.s, 1)}</td>
      <td>{x.o == null ? "—" : x.o < MIN_ORDERS ? <span className="pending">insufficient sample</span> : fmtPct(x.o / x.nb, 2)}</td>
    </tr>
  );

  return (
    <div>
      <h3 style={{ margin: "0 0 4px", fontSize: 14, color: PLATFORM_COLOR[p] }}>{PLATFORM_LABEL[p]}</h3>
      {!all.length ? (
        <NotEvidenced what={`${PLATFORM_LABEL[p]} version data`} needs="product_list_viewed_app_version in the Superset snapshot" />
      ) : (
        <>
          <div className="sub">
            Adoption of latest seen version <strong>{latest ?? "—"}</strong> (share of known-version sessions per week)
          </div>
          {latest && <Adoption rows={all} latest={latest} color={PLATFORM_COLOR[p]} />}
          <div className="sub">
            Version coverage in range: {fmtInt(known)} known-version sessions of {fmtInt(appSessions)} {PLATFORM_LABEL[p]} sessions (
            {appSessions ? fmtPct(Math.min(1, known / appSessions), 1) : "—"}; approximate — version data is weekly and only exists for sessions with a product list view).
          </div>
          {inRange.length ? (
            <div className="scroll">
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Sessions</th>
                    <th>App-bounce rate</th>
                    <th>Non-bounce CR</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(([v, x]) => row(v === latest ? `${v} (latest)` : v, x, v))}
                  {other.length > 0 && row(`${other.length} older versions`, otherAgg, "other")}
                  {unknown && row("version unknown (own bucket)", unknown, "unknown")}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="note">
              No weekly version rows overlap the selected range (version data covers {weeks.length ? `${fmtDate(weeks[0])} – ${fmtDate(weeks[weeks.length - 1])}` : "no weeks"}).
            </p>
          )}
        </>
      )}
      <div style={{ marginTop: 8 }}>
        <NotEvidenced what="Crash-free sessions" needs="Crashlytics / Sentry export" />
      </div>
      {p === "android" && (
        <p className="note">
          Android production deploy runs have failed since 5 Sep 2026; releases are known from git tags only (weak signal)
          {lastAndroid ? `; latest tag ${lastAndroid.release_id ?? "?"} on ${fmtDate(lastAndroid.bangkok_date)}` : ""}. Play Console release history is needed for true go-live dates.
        </p>
      )}
    </div>
  );
}

export default function D7AppHealth(props: PanelProps) {
  return (
    <Panel
      id="panel-app-health"
      title="D7 · App health by version"
      badge={props.api.data.app_versions.length ? <RealBadge text="REAL — Superset dataset 63" /> : undefined}
      sub="iOS and Android shown separately because they ship separate builds. App-bounce uses the app definition (pending Cube model confirmation)."
    >
      <div className="grid two">
        <PlatformBlock p="ios" props={props} />
        <PlatformBlock p="android" props={props} />
      </div>
    </Panel>
  );
}
