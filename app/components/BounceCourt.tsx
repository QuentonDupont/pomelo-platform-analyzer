"use client";

import { aggregate, DailyRow, filterRows, fmtInt, fmtPct, rates } from "@/lib/compute";
import { Market, MIN_SESSIONS } from "@/server/metrics/definitions";
import { Delta, NotEvidenced, Panel, PLATFORM_COLOR, PLATFORM_LABEL, RealBadge } from "./shared";
import type { Filters, PanelProps } from "./types";

type Lane = { key: string; label: string; cur: { total: number; br: number | null }; cmp: number | null; onPick?: () => void };

function lanesFor(platform: "web" | "app" | "ios" | "android", props: PanelProps, set: (p: Partial<Filters>) => void): Lane[] {
  const { f, cur, cmp } = props;
  const pick = (rows: DailyRow[], from: string, to: string, markets: Market[], device: "all" | "desktop" | "mobile", p = platform) =>
    aggregate(filterRows(rows, { from, to, platform: p, markets, device }), f.orders);
  if (f.lanes === "device") {
    const devs: { key: string; label: string; p: "web" | "app" | "ios" | "android"; d: "all" | "desktop" | "mobile" }[] =
      platform === "web"
        ? [
            { key: "mobile", label: "Mobile web", p: "web", d: "mobile" },
            { key: "desktop", label: "Desktop web", p: "web", d: "desktop" },
          ]
        : platform === "app"
          ? [
              { key: "ios", label: "iOS", p: "ios", d: "all" },
              { key: "android", label: "Android", p: "android", d: "all" },
            ]
          : [{ key: platform, label: PLATFORM_LABEL[platform], p: platform, d: "all" }];
    return devs.map((d) => {
      const a = pick(cur.rows, cur.from, cur.to, f.markets, d.d, d.p);
      const b = pick(cmp.rows, cmp.from, cmp.to, f.markets, d.d, d.p);
      return { key: d.key, label: d.label, cur: { total: a.total, br: rates(a).bounce_rate }, cmp: rates(b).bounce_rate };
    });
  }
  return f.markets.map((m) => {
    const dev = platform === "web" ? f.device : "all";
    const a = pick(cur.rows, cur.from, cur.to, [m], dev);
    const b = pick(cmp.rows, cmp.from, cmp.to, [m], dev);
    return { key: m, label: m, cur: { total: a.total, br: rates(a).bounce_rate }, cmp: rates(b).bounce_rate, onPick: () => set({ markets: [m] }) };
  });
}

export default function BounceCourt(props: PanelProps & { set: (p: Partial<Filters>) => void }) {
  const { f, set } = props;
  const courts: ("web" | "app" | "ios" | "android")[] = f.split ? ["web", "ios", "android"] : ["web", "app"];
  return (
    <Panel
      id="panel-court"
      title="Bounce court"
      badge={<RealBadge />}
      sub={
        <>
          One lane per {f.lanes === "market" ? "market (click to focus)" : "device / app platform"} · ball height and speed = bounce rate · ball size = sessions · dashed tick = comparison period. Web
          bounce and app-bounce are Cube measures whose rule is <span className="pending">pending</span> — read each court on its own scale.
        </>
      }
      right={
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "start" }}>
          <span className="seg" role="group" aria-label="Lanes">
            <button type="button" aria-pressed={f.lanes === "market"} onClick={() => set({ lanes: "market" })}>
              Markets
            </button>
            <button type="button" aria-pressed={f.lanes === "device"} onClick={() => set({ lanes: "device" })}>
              Devices
            </button>
            <button type="button" disabled title="Site section is not in the data (no page/path column) — needs RudderStack pages">
              Sections
            </button>
          </span>
          <button type="button" aria-pressed={f.split} onClick={() => set({ split: !f.split })}>
            {f.split ? "Combine app" : "Split app → iOS / Android"}
          </button>
        </div>
      }
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${f.split ? 280 : 380}px, 1fr))` }}>
        {courts.map((p) => (
          <Court key={p} platform={p} lanes={lanesFor(p, props, set)} reduced={props.reduced} />
        ))}
      </div>
      <NotEvidenced what="Bounce by site section (home, listing, PDP, …)" needs="RudderStack page/screen events by session (pages tables are not exposed in Superset)" />
    </Panel>
  );
}

function Court({ platform, lanes, reduced }: { platform: "web" | "app" | "ios" | "android"; lanes: Lane[]; reduced: boolean }) {
  const W = 520;
  const H = 230;
  const floor = 165;
  const lane = W / Math.max(1, lanes.length);
  const maxSess = Math.max(1, ...lanes.map((l) => l.cur.total));
  const color = PLATFORM_COLOR[platform];
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 600, color }}>
        {PLATFORM_LABEL[platform]} {platform !== "web" && <span className="badge muted">app-bounce</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${PLATFORM_LABEL[platform]} bounce rate by lane`}>
        <line x1="0" x2={W} y1={floor} y2={floor} stroke="var(--line)" strokeWidth="2" />
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1="0" x2={W} y1={floor - g * 140} y2={floor - g * 140} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={W - 2} y={floor - g * 140 - 3} fontSize="9" textAnchor="end" fill="var(--muted)">
              {g * 100}%
            </text>
          </g>
        ))}
        {lanes.map((l, i) => {
          const cx = lane * i + lane / 2;
          const insufficient = l.cur.total < MIN_SESSIONS || l.cur.br == null;
          const br = l.cur.br ?? 0;
          const h = br * 140;
          const rad = 4 + 13 * Math.sqrt(l.cur.total / maxSess);
          const label = `${l.label}: ${insufficient ? "insufficient sample" : `${fmtPct(br, 1)} bounce`}, ${fmtInt(l.cur.total)} sessions${l.cmp != null ? `, comparison ${fmtPct(l.cmp, 1)}` : ""}`;
          return (
            <g
              key={l.key}
              className={l.onPick ? "flag" : undefined}
              tabIndex={l.onPick ? 0 : -1}
              role={l.onPick ? "button" : "img"}
              aria-label={label}
              onClick={l.onPick}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && l.onPick?.()}
            >
              <title>{label}</title>
              <rect x={lane * i + 2} y={8} width={lane - 4} height={floor - 8} fill="transparent" />
              {insufficient ? (
                <text x={cx} y={floor - 10} fontSize="9" textAnchor="middle" fill="var(--muted)">
                  insufficient
                </text>
              ) : reduced ? (
                <rect x={cx - 10} y={floor - h} width={20} height={h} rx={3} fill={color} />
              ) : (
                <>
                  <line x1={cx} x2={cx} y1={floor} y2={floor - h} stroke={color} strokeOpacity=".25" strokeDasharray="1 3" />
                  <g className="ball" style={{ ["--h" as string]: `${-h}px`, animationDuration: `${(1.7 - br).toFixed(2)}s` }}>
                    <circle cx={cx} cy={floor - rad} r={rad} fill={color} fillOpacity=".9" />
                  </g>
                </>
              )}
              {l.cmp != null && !insufficient && <line x1={cx - 14} x2={cx + 14} y1={floor - l.cmp * 140} y2={floor - l.cmp * 140} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 2" />}
              <text x={cx} y={floor + 17} fontSize="11" textAnchor="middle" fill="var(--ink)" fontWeight={600}>
                {insufficient ? "—" : fmtPct(br, 1)}
              </text>
              <text x={cx} y={floor + 31} fontSize="10" textAnchor="middle" fill="var(--muted)">
                {l.label}
              </text>
              <text x={cx} y={floor + 44} fontSize="9" textAnchor="middle" fill="var(--muted)">
                {fmtInt(l.cur.total)}
              </text>
              {l.cmp != null && !insufficient && (
                <text x={cx} y={floor + 57} fontSize="9" textAnchor="middle">
                  <tspan>
                    <DeltaText cur={l.cur.br} prev={l.cmp} />
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function DeltaText({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return null;
  const d = (cur - prev) * 100;
  return <tspan fill={d > 0 ? "var(--bad)" : d < 0 ? "var(--good)" : "var(--muted)"}>{`${d >= 0 ? "+" : ""}${d.toFixed(1)} pp`}</tspan>;
}

export { Delta };
