"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bangkokToday,
  Cell,
  confidence,
  Confidence,
  derived,
  DEFINITION_VERSION,
  inPlatform,
  isImmature,
  Market,
  MARKETS,
  METRIC_DEFS,
  MIN_ORDERS,
  MIN_SESSIONS,
  PlatformFilter,
  revenueAtStake,
  Section,
  SECTION_LABEL,
  SECTIONS,
  sum,
  Totals,
  wilson,
} from "@/lib/metrics";
import { CEO_BRIEF, Release } from "@/lib/sample";

const REFRESH_MS = 60_000;

type RealRow = {
  week_start: string;
  platform: string;
  market: string;
  total_sessions: number;
  bounce_sessions: number;
  non_bounce_sessions: number;
  orders: number;
  booked_revenue_usd: number;
};

type Api = {
  data: { cells: Cell[]; releases: Release[]; real_weekly: { rows: RealRow[]; source: string } | null };
  as_of: string;
  source: { traffic: string; releases: "github" | "sample" };
  definition_version: string;
  coverage: { unknown_platform_sessions: number; unknown_platform_share: number };
};

const PLATFORM_LABEL: Record<PlatformFilter, string> = {
  web: "Web",
  app: "App (iOS + Android)",
  ios: "iOS",
  android: "Android",
};
const PLATFORM_COLOR: Record<string, string> = {
  web: "var(--web)",
  app: "var(--app)",
  ios: "var(--ios)",
  android: "var(--android)",
  backend: "var(--unknown)",
  unknown: "var(--unknown)",
};

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtPct = (n: number | null, dp = 2) => (n == null ? "—" : `${(n * 100).toFixed(dp)}%`);
const fmtUsd = (n: number | null, dp = 0) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const fmtWeek = (w: string) => {
  const s = new Date(w + "T00:00:00+07:00");
  const e = new Date(s.getTime() + 6 * 86400000);
  const f = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
  return `${f(s)} – ${f(e)}`;
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function useCountUp(target: number, reduced: boolean, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, ms]);
  return v;
}

// ---------- URL state (shareable filters) ----------
type Filters = {
  platform: PlatformFilter;
  week: string;
  compare: "prior" | "2w";
  markets: Market[];
  section: Section | "all";
  tab: "overview" | "decisions";
  split: boolean;
};

function readUrl(weeks: string[]): Filters {
  const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const markets = (q.get("m")?.split(",").filter(Boolean) as Market[]) ?? [];
  const week = q.get("w") ?? "";
  return {
    platform: (["web", "app", "ios", "android"].includes(q.get("p") ?? "") ? q.get("p") : "web") as PlatformFilter,
    week: weeks.includes(week) ? week : weeks[weeks.length - 1],
    compare: q.get("c") === "2w" ? "2w" : "prior",
    markets: markets.length ? markets : MARKETS.map((m) => m.id),
    section: (SECTIONS as readonly string[]).includes(q.get("s") ?? "") ? (q.get("s") as Section) : "all",
    tab: q.get("t") === "overview" ? "overview" : q.get("t") === "decisions" ? "decisions" : "decisions",
    split: q.get("split") === "1",
  };
}

export default function Dashboard() {
  const [api, setApi] = useState<Api | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const [f, setF] = useState<Filters | null>(null);
  const reduced = useReducedMotion();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/metrics", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: Api = await r.json();
      setApi(j);
      setLastOk(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "sync failed");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    const c = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  const weeks = useMemo(() => (api ? [...new Set(api.data.cells.map((c) => c.week))].sort() : []), [api]);
  useEffect(() => {
    if (weeks.length && !f) setF(readUrl(weeks));
  }, [weeks, f]);
  useEffect(() => {
    if (!f) return;
    const q = new URLSearchParams({ p: f.platform, w: f.week, c: f.compare, m: f.markets.join(","), s: f.section, t: f.tab });
    if (f.split) q.set("split", "1");
    window.history.replaceState(null, "", `?${q.toString()}`);
  }, [f]);

  if (!api || !f) {
    return (
      <div className="wrap" style={{ paddingTop: 40 }}>
        {error ? <p className="down">Could not load metrics: {error}</p> : <p className="muted">Loading metrics…</p>}
      </div>
    );
  }

  const set = (p: Partial<Filters>) => setF({ ...f, ...p });
  const wi = weeks.indexOf(f.week);
  const cmpWeek = weeks[wi - (f.compare === "prior" ? 1 : 2)] ?? null;
  const cells = api.data.cells;
  const sel = (week: string | null, platform: PlatformFilter, section: Section | "all" = f.section, markets = f.markets) =>
    week
      ? cells.filter(
          (c) => c.week === week && inPlatform(c.platform, platform) && markets.includes(c.market) && (section === "all" || c.section === section),
        )
      : [];

  const staleness = now - lastOk;
  const pulse = error ? "red" : staleness > 2 * REFRESH_MS ? "amber" : "";
  const asOf = new Date(api.as_of).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

  return (
    <>
      <div className="sample-banner" role="status">
        SAMPLE DATA in all panels except those badged REAL. Section, funnel and opportunity figures are an illustrative fixture built on CEO-brief totals.
        Releases: {api.source.releases === "github" ? "REAL GitHub production deploys" : "sample"}.
      </div>
      <div className="wrap">
        <header className="top">
          <div>
            <h1>Pomelo bounce rate &amp; release impact</h1>
            <div className="sub">
              pomelofashion.com/th/en + iOS + Android · Bangkok business dates · bot_flag = false · definitions {DEFINITION_VERSION}
            </div>
          </div>
          <div className="pulse" aria-live="polite">
            <span className={`dot ${pulse}`} aria-hidden />
            {error ? `Sync failed (${error}) — showing last good data` : `as of ${asOf} ICT`}
            {pulse === "amber" && " · stale"}
          </div>
        </header>

        <div className="filters">
          <label>
            Week (Mon–Sun)
            <select value={f.week} onChange={(e) => set({ week: e.target.value })}>
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {fmtWeek(w)}
                  {isImmature(w, bangkokToday()) ? " (immature)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Compare to
            <select value={f.compare} onChange={(e) => set({ compare: e.target.value as Filters["compare"] })}>
              <option value="prior">Prior week</option>
              <option value="2w">2 weeks earlier</option>
            </select>
          </label>
          <label>
            Platform
            <span className="seg" role="group" aria-label="Platform">
              {(Object.keys(PLATFORM_LABEL) as PlatformFilter[]).map((p) => (
                <button key={p} aria-pressed={f.platform === p} onClick={() => set({ platform: p })}>
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </span>
          </label>
          <label>
            Market
            <span className="seg" role="group" aria-label="Market">
              {MARKETS.map((m) => (
                <button
                  key={m.id}
                  title={m.label}
                  aria-pressed={f.markets.includes(m.id)}
                  onClick={() => {
                    const has = f.markets.includes(m.id);
                    const next = has ? f.markets.filter((x) => x !== m.id) : [...f.markets, m.id];
                    if (next.length) set({ markets: next });
                  }}
                >
                  {m.id}
                </button>
              ))}
            </span>
          </label>
          <label>
            Section
            <select value={f.section} onChange={(e) => set({ section: e.target.value as Filters["section"] })}>
              <option value="all">All sections</option>
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tabs" role="tablist">
          <button role="tab" aria-pressed={f.tab === "decisions"} onClick={() => set({ tab: "decisions" })}>
            Decisions
          </button>
          <button role="tab" aria-pressed={f.tab === "overview"} onClick={() => set({ tab: "overview" })}>
            Bounce &amp; releases
          </button>
        </div>

        <Kpis cur={sum(sel(f.week, f.platform))} cmp={cmpWeek ? sum(sel(cmpWeek, f.platform)) : null} spark={weeks.map((w) => sum(sel(w, f.platform)))} platform={f.platform} reduced={reduced} cmpLabel={cmpWeek ? fmtWeek(cmpWeek) : null} />

        {f.tab === "decisions" ? (
          <div className="grid" style={{ marginTop: 12 }}>
            {api.data.real_weekly && <RealScorecard real={api.data.real_weekly} />}
            <Scorecard cells={cells} weeks={weeks} week={f.week} />
            <Opportunities cells={cells} weeks={weeks} week={f.week} />
          </div>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            <BounceCourts sel={sel} week={f.week} split={f.split} setSplit={(v) => set({ split: v })} focus={f.section} onPick={(s) => set({ section: s === f.section ? "all" : s })} reduced={reduced} />
            <div className="grid two">
              <Timeline releases={api.data.releases} weeks={weeks} cells={cells} source={api.source.releases} />
              <Funnel cur={sum(sel(f.week, f.platform))} other={sum(sel(f.week, f.platform === "web" ? "app" : "web"))} platform={f.platform} />
            </div>
            <DataQuality cells={cells} sel={sel(f.week, f.platform)} api={api} />
          </div>
        )}
        <p className="note">
          Non-bounce CR = {METRIC_DEFS.nonbounce_cr.text} Booked revenue = {METRIC_DEFS.booked_revenue.text} Cells with &lt; {MIN_SESSIONS}{" "}
          sessions or &lt; {MIN_ORDERS} orders show “insufficient sample”. Changes are shown vs baseline; no causal claims.
        </p>
      </div>
    </>
  );
}

// ---------------- KPI tiles ----------------
function Kpis(props: { cur: Totals; cmp: Totals | null; spark: Totals[]; platform: PlatformFilter; reduced: boolean; cmpLabel: string | null }) {
  const d = derived(props.cur);
  const c = props.cmp ? derived(props.cmp) : null;
  const isApp = props.platform !== "web";
  const tiles: { label: string; value: number | null; fmt: (n: number) => string; prev: number | null; pick: (t: Totals) => number | null; n: string; good: "up" | "down"; suppressed?: boolean; pp?: boolean }[] = [
    { label: "Total sessions", value: props.cur.total_sessions, fmt: fmtInt, prev: props.cmp?.total_sessions ?? null, pick: (t) => t.total_sessions, n: "", good: "up" },
    { label: isApp ? "App-bounce rate" : "Bounce rate", value: d.bounce_rate, fmt: (n) => fmtPct(n, 1), prev: c?.bounce_rate ?? null, pick: (t) => derived(t).bounce_rate, n: `n=${fmtInt(props.cur.total_sessions)} sess`, good: "down", suppressed: d.suppressed_sessions, pp: true },
    { label: "Non-bounce sessions", value: props.cur.nonbounce_sessions, fmt: fmtInt, prev: props.cmp?.nonbounce_sessions ?? null, pick: (t) => t.nonbounce_sessions, n: "", good: "up" },
    { label: "Non-bounce CR", value: d.nonbounce_cr, fmt: (n) => fmtPct(n, 3), prev: c?.nonbounce_cr ?? null, pick: (t) => derived(t).nonbounce_cr, n: `${props.cur.orders} orders`, good: "up", suppressed: d.suppressed_orders, pp: true },
    { label: "Orders", value: props.cur.orders, fmt: fmtInt, prev: props.cmp?.orders ?? null, pick: (t) => t.orders, n: "", good: "up" },
    { label: "AOV", value: d.aov, fmt: (n) => fmtUsd(n, 2), prev: c?.aov ?? null, pick: (t) => derived(t).aov, n: `${props.cur.orders} orders`, good: "up", suppressed: d.suppressed_orders },
    { label: "Booked revenue", value: props.cur.booked_revenue_usd, fmt: (n) => fmtUsd(n), prev: props.cmp?.booked_revenue_usd ?? null, pick: (t) => t.booked_revenue_usd, n: "USD, before returns", good: "up" },
    { label: "Rev / non-bounce session", value: d.rev_per_nb_session, fmt: (n) => fmtUsd(n, 3), prev: c?.rev_per_nb_session ?? null, pick: (t) => derived(t).rev_per_nb_session, n: "", good: "up", suppressed: d.suppressed_orders },
  ];
  return (
    <div className="grid kpis" aria-label="Key metrics">
      {tiles.map((t) => (
        <Tile key={t.label} {...t} spark={props.spark.map(t.pick)} reduced={props.reduced} cmpLabel={props.cmpLabel} />
      ))}
    </div>
  );
}

function Tile(t: { label: string; value: number | null; fmt: (n: number) => string; prev: number | null; spark: (number | null)[]; n: string; good: "up" | "down"; suppressed?: boolean; pp?: boolean; reduced: boolean; cmpLabel: string | null }) {
  const v = useCountUp(t.value ?? 0, t.reduced);
  let delta: string | null = null;
  let cls = "flat";
  if (t.value != null && t.prev != null && t.prev !== 0) {
    const diff = t.value - t.prev;
    delta = t.pp ? `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(2)} pp` : `${diff >= 0 ? "+" : ""}${((diff / t.prev) * 100).toFixed(1)}%`;
    const better = t.good === "up" ? diff > 0 : diff < 0;
    cls = Math.abs(diff) < 1e-9 ? "flat" : better ? "up" : "down";
  }
  const pts = t.spark.filter((x): x is number => x != null);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const path = pts.map((p, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${20 - (hi === lo ? 10 : ((p - lo) / (hi - lo)) * 18 + 1)}`).join(" ");
  return (
    <div className="panel kpi">
      <div className="sub">{t.label}</div>
      {t.suppressed ? (
        <div className="v pending" style={{ fontSize: 14 }}>insufficient sample</div>
      ) : (
        <div className="v">{t.value == null ? "—" : t.fmt(v)}</div>
      )}
      <svg viewBox="0 0 100 22" width="100%" height="22" aria-hidden>
        <polyline points={path} fill="none" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" />
      </svg>
      <div className={`d ${cls}`}>{delta ? `${delta} vs ${t.cmpLabel}` : "no comparison"}</div>
      {t.n && <div className="sub">{t.n}</div>}
    </div>
  );
}

// ---------------- Bounce court ----------------
function BounceCourts(props: {
  sel: (w: string | null, p: PlatformFilter, s?: Section | "all") => Cell[];
  week: string;
  split: boolean;
  setSplit: (v: boolean) => void;
  focus: Section | "all";
  onPick: (s: Section) => void;
  reduced: boolean;
}) {
  const courts: PlatformFilter[] = props.split ? ["web", "ios", "android"] : ["web", "app"];
  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2>Bounce court — {fmtWeek(props.week)}</h2>
          <div className="sub">
            Ball height and speed = bounce rate · ball size = sessions · click a lane to filter. Web bounce and app-bounce use different
            definitions (<span className="pending">definition pending</span>) — never read them as one scale.
          </div>
        </div>
        <button aria-pressed={props.split} onClick={() => props.setSplit(!props.split)}>
          {props.split ? "Combine app" : "Split app → iOS / Android"}
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${props.split ? 300 : 420}px, 1fr))`, marginTop: 10 }}>
        {courts.map((p) => (
          <Court key={p} platform={p} cells={props.sel(props.week, p, "all")} focus={props.focus} onPick={props.onPick} reduced={props.reduced} />
        ))}
      </div>
    </div>
  );
}

function Court({ platform, cells, focus, onPick, reduced }: { platform: PlatformFilter; cells: Cell[]; focus: Section | "all"; onPick: (s: Section) => void; reduced: boolean }) {
  const W = 560;
  const H = 230;
  const floor = 170;
  const lane = W / SECTIONS.length;
  const rows = SECTIONS.map((s) => {
    const t = sum(cells.filter((c) => c.section === s));
    return { s, t, br: derived(t).bounce_rate };
  });
  const maxSess = Math.max(1, ...rows.map((r) => r.t.total_sessions));
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 600, color: PLATFORM_COLOR[platform] }}>
        {PLATFORM_LABEL[platform]} {platform !== "web" && <span className="badge" style={{ color: "var(--muted)" }}>app-bounce</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${PLATFORM_LABEL[platform]} bounce rate by section`}>
        <line x1="0" x2={W} y1={floor} y2={floor} stroke="var(--line)" strokeWidth="2" />
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g}>
            <line x1="0" x2={W} y1={floor - g * 150} y2={floor - g * 150} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={W - 2} y={floor - g * 150 - 3} fontSize="9" textAnchor="end" fill="var(--muted)">
              {g * 100}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = lane * i + lane / 2;
          const insufficient = r.t.total_sessions < MIN_SESSIONS || r.br == null;
          const br = r.br ?? 0;
          const h = br * 150;
          const rad = 4 + 12 * Math.sqrt(r.t.total_sessions / maxSess);
          const dim = focus !== "all" && focus !== r.s;
          const dur = (1.6 - br).toFixed(2);
          const label = `${SECTION_LABEL[r.s]}: ${insufficient ? "insufficient sample" : `${fmtPct(br, 1)} bounce`}, ${fmtInt(r.t.total_sessions)} sessions`;
          return (
            <g
              key={r.s}
              className="flag"
              opacity={dim ? 0.3 : 1}
              tabIndex={0}
              role="button"
              aria-label={label}
              onClick={() => onPick(r.s)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(r.s)}
            >
              <title>{label}</title>
              <rect x={lane * i + 2} y={10} width={lane - 4} height={floor - 10} fill="transparent" />
              {insufficient ? (
                <text x={cx} y={floor - 10} fontSize="9" textAnchor="middle" fill="var(--muted)">
                  insufficient
                </text>
              ) : reduced ? (
                <rect x={cx - 9} y={floor - h} width={18} height={h} rx={3} fill={PLATFORM_COLOR[platform]} />
              ) : (
                <>
                  <line x1={cx} x2={cx} y1={floor} y2={floor - h} stroke={PLATFORM_COLOR[platform]} strokeOpacity=".25" strokeDasharray="1 3" />
                  <g className="ball" style={{ ["--h" as string]: `${-h}px`, animationDuration: `${dur}s`, transformBox: "view-box" }}>
                    <circle cx={cx} cy={floor - rad} r={rad} fill={PLATFORM_COLOR[platform]} fillOpacity=".9" />
                  </g>
                </>
              )}
              <text x={cx} y={floor + 18} fontSize="10.5" textAnchor="middle" fill="var(--ink)" fontWeight={600}>
                {insufficient ? "—" : fmtPct(br, 1)}
              </text>
              <text x={cx} y={floor + 32} fontSize="9.5" textAnchor="middle" fill="var(--muted)">
                {SECTION_LABEL[r.s].split(" ")[0]}
              </text>
              <text x={cx} y={floor + 45} fontSize="9" textAnchor="middle" fill="var(--muted)">
                {fmtInt(r.t.total_sessions)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// ---------------- Release timeline ----------------
function Timeline({ releases, weeks, cells, source }: { releases: Release[]; weeks: string[]; cells: Cell[]; source: "github" | "sample" }) {
  const [open, setOpen] = useState<Release | null>(null);
  const t = (d: string) => new Date(d + "T00:00:00+07:00").getTime();
  const dates = [...releases.map((r) => r.go_live), weeks[0], new Date(t(weeks[weeks.length - 1]) + 6 * 86400000).toISOString().slice(0, 10)];
  const min = Math.min(...dates.map(t));
  const max = Math.max(...dates.map(t));
  const W = 560;
  const x = (d: string) => 20 + ((t(d) - min) / Math.max(1, max - min)) * (W - 40);
  const lanes = ["web", "ios", "android", "backend"] as const;
  return (
    <div className="panel">
      <h2>Release timeline</h2>
      <div className="sub">
        Production go-live (not merge time). Source: {source === "github" ? "GitHub production releases (real)" : <span className="pending">sample releases — GitHub discovery not loaded</span>}. Click a flag.
      </div>
      <svg viewBox={`0 0 ${W} 150`} width="100%" role="img" aria-label="Release timeline">
        {weeks.map((w) => (
          <g key={w}>
            <rect x={x(w)} y={8} width={Math.max(0, x(new Date(t(w) + 7 * 86400000).toISOString().slice(0, 10)) - x(w))} height={112} fill="var(--line)" opacity=".35" />
            <text x={x(w) + 2} y={135} fontSize="9" fill="var(--muted)">
              wk {fmtWeek(w).split(" – ")[0]}
            </text>
          </g>
        ))}
        {lanes.map((l, li) => (
          <text key={l} x={0} y={24 + li * 28} fontSize="9" fill={PLATFORM_COLOR[l]}>
            {l}
          </text>
        ))}
        {releases.map((r) => {
          const li = lanes.indexOf(r.platform);
          const y = 30 + li * 28;
          return (
            <g key={r.id} className="flag" tabIndex={0} role="button" aria-label={`${r.title}, ${r.go_live}`} onClick={() => setOpen(r)} onKeyDown={(e) => e.key === "Enter" && setOpen(r)}>
              <title>{`${r.title} · ${r.go_live} · ${r.prs.length} PR(s)`}</title>
              <line x1={x(r.go_live)} x2={x(r.go_live)} y1={y - 16} y2={y + 4} stroke={PLATFORM_COLOR[r.platform]} strokeWidth="1.5" />
              <path d={`M${x(r.go_live)},${y - 16} l9,4 l-9,4 z`} fill={PLATFORM_COLOR[r.platform]} />
            </g>
          );
        })}
      </svg>
      {open && <ReleaseCard r={open} cells={cells} weeks={weeks} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReleaseCard({ r, cells, weeks, onClose }: { r: Release; cells: Cell[]; weeks: string[]; onClose: () => void }) {
  const t = (d: string) => new Date(d + "T00:00:00+07:00").getTime();
  const pf: PlatformFilter = r.platform === "backend" ? "web" : r.platform;
  const before = weeks.filter((w) => t(w) + 7 * 86400000 <= t(r.go_live)).slice(-2);
  const after = weeks.filter((w) => t(w) >= t(r.go_live));
  const agg = (ws: string[]) => sum(cells.filter((c) => ws.includes(c.week) && inPlatform(c.platform, pf)));
  const b = agg(before);
  const a = agg(after);
  const ciB = wilson(b.bounce_sessions, b.total_sessions);
  const ciA = wilson(a.bounce_sessions, a.total_sessions);
  return (
    <div className="card" style={{ borderColor: PLATFORM_COLOR[r.platform] }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{r.title}</strong>
        <button onClick={onClose} aria-label="Close release card">×</button>
      </div>
      <div className="sub">
        {r.platform} · {r.repo} · go-live {r.go_live} (ICT) · {r.prs.length} PR(s){" "}
        {r.confounded && <span className="badge b-Medium">confounded — bundled PRs, deploy-level attribution only</span>}
      </div>
      <div style={{ marginTop: 6 }}>
        Success metric: {r.success_metric ?? <span className="pending">not declared</span>}{" "}
        {r.metric_source === "inferred" && <span className="badge b-Low">inferred</span>}
      </div>
      {r.prs.length > 0 && (
        <ul style={{ margin: "6px 0", paddingLeft: 18, maxHeight: 120, overflow: "auto" }}>
          {r.prs.slice(0, 12).map((p, i) => (
            <li key={i}>
              {p.number ? `#${p.number} ` : ""}
              {p.title}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 6 }}>
        {before.length && after.length && ciA && ciB ? (
          <>
            {pf === "web" ? "Bounce" : "App-bounce"} rate: baseline {fmtPct(derived(b).bounce_rate, 1)} [{fmtPct(ciB[0], 1)}–{fmtPct(ciB[1], 1)}] n=
            {fmtInt(b.total_sessions)} → post {fmtPct(derived(a).bounce_rate, 1)} [{fmtPct(ciA[0], 1)}–{fmtPct(ciA[1], 1)}] n={fmtInt(a.total_sessions)}.
            <div className="note">Change vs baseline only, not a causal effect. Sample data. Post days 0–6 are immature.</div>
          </>
        ) : (
          <span className="muted">Not enough complete weeks before/after go-live in range to compare.</span>
        )}
        {(r.platform === "ios" || r.platform === "android") && (
          <div className="note">Adoption curve and new-vs-previous version cohorts: <span className="pending">needs context_app_version from warehouse</span>.</div>
        )}
      </div>
    </div>
  );
}

// ---------------- Funnel ----------------
function Funnel({ cur, other, platform }: { cur: Totals; other: Totals; platform: PlatformFilter }) {
  const steps = (t: Totals) => [
    ["Non-bounce", t.nonbounce_sessions],
    ["PDP", t.pdp],
    ["Add to bag", t.atb],
    ["Checkout", t.checkout],
    ["Payment", t.payment],
    ["Order", t.orders],
  ] as [string, number][];
  const a = steps(cur);
  const b = steps(other);
  const otherLabel = platform === "web" ? "App (iOS + Android)" : "Web";
  return (
    <div className="panel">
      <h2>Funnel — {PLATFORM_LABEL[platform]} vs {otherLabel}</h2>
      <div className="sub">Step conversion from the previous step. Orders are backend orders (operational ratio).</div>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Step</th>
            <th>{PLATFORM_LABEL[platform]}</th>
            <th>Step rate</th>
            <th>{otherLabel} rate</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {a.map(([name, n], i) => {
            const rA = i ? (a[i - 1][1] ? n / a[i - 1][1] : null) : null;
            const rB = i ? (b[i - 1][1] ? b[i][1] / b[i - 1][1] : null) : null;
            return (
              <tr key={name}>
                <td>{name}</td>
                <td>{fmtInt(n)}</td>
                <td>{fmtPct(rA, 1)}</td>
                <td className="muted">{fmtPct(rB, 1)}</td>
                <td style={{ width: 120 }}>
                  <div style={{ height: 8, background: "var(--line)", borderRadius: 4 }}>
                    <div style={{ height: 8, width: `${Math.max(2, (n / Math.max(1, a[0][1])) * 100)}%`, background: PLATFORM_COLOR[platform], borderRadius: 4, transition: "width .6s" }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Data quality ----------------
function DataQuality({ cells, sel, api }: { cells: Cell[]; sel: Cell[]; api: Api }) {
  const chk = (label: string, got: [number, number], want: readonly [number, number]) => ({ label, ok: got[0] === want[0] && got[1] === want[1], got, want });
  const s = (w: string, pred: (c: Cell) => boolean) => {
    const t = sum(cells.filter((c) => c.week === w && pred(c)));
    return [t.nonbounce_sessions, t.orders] as [number, number];
  };
  const checks = (["2026-09-14", "2026-09-28"] as const).flatMap((w) => [
    chk(`App ${w}`, s(w, (c) => c.platform === "ios" || c.platform === "android"), CEO_BRIEF.app[w]),
    chk(`Web 5 mkts ${w}`, s(w, (c) => c.platform === "web"), CEO_BRIEF.web[w]),
    chk(`TH web ${w}`, s(w, (c) => c.platform === "web" && c.market === "TH"), CEO_BRIEF.th_web[w]),
  ]);
  const suppressed = sel.filter((c) => c.total_sessions < MIN_SESSIONS || c.orders < MIN_ORDERS).length;
  return (
    <div className="panel">
      <h2>Data quality</h2>
      <div className="grid two" style={{ marginTop: 6 }}>
        <div>
          <div className="sub">Fixture vs CEO brief (non-bounce sessions / orders)</div>
          <table>
            <tbody>
              {checks.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td>
                    {fmtInt(c.got[0])} / {c.got[1]}
                  </td>
                  <td className={c.ok ? "up" : "down"}>{c.ok ? "✓ match" : `✗ want ${fmtInt(c.want[0])} / ${c.want[1]}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">Real-data reconciliation (Superset dataset 63/33) lives in docs/RECONCILIATION.md.</div>
        </div>
        <div>
          <table>
            <tbody>
              <tr>
                <td>Traffic source</td>
                <td className="pending">{api.source.traffic}</td>
              </tr>
              <tr>
                <td>Unknown / unmapped platform</td>
                <td>
                  {fmtInt(api.coverage.unknown_platform_sessions)} sessions ({fmtPct(api.coverage.unknown_platform_share, 1)}) — own bucket
                </td>
              </tr>
              <tr>
                <td>Suppressed cells in current view</td>
                <td>
                  {suppressed} of {sel.length} (&lt;{MIN_SESSIONS} sessions or &lt;{MIN_ORDERS} orders)
                </td>
              </tr>
              <tr>
                <td>Bounce definition</td>
                <td className="pending">pending Superset dataset 63</td>
              </tr>
              <tr>
                <td>Section taxonomy</td>
                <td className="pending">pending (URL-path fallback)</td>
              </tr>
              <tr>
                <td>Definition version</td>
                <td>{api.definition_version}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------- D1 Weekly CEO scorecard ----------------
function Scorecard({ cells, weeks, week }: { cells: Cell[]; weeks: string[]; week: string }) {
  const wi = weeks.indexOf(week);
  const prior = weeks[wi - 1] ?? null;
  const twoAgo = weeks[wi - 2] ?? null;
  const rows: { label: string; pred: (c: Cell) => boolean; share?: string }[] = [
    { label: "App (iOS + Android)", pred: (c) => c.platform === "ios" || c.platform === "android" },
    { label: "iOS", pred: (c) => c.platform === "ios" },
    { label: "Android", pred: (c) => c.platform === "android" },
    { label: "Web (5 markets)", pred: (c) => c.platform === "web" },
    { label: "Thailand web", pred: (c) => c.platform === "web" && c.market === "TH" },
  ];
  const tot = (w: string | null, pred: (c: Cell) => boolean) => (w ? sum(cells.filter((c) => c.week === w && pred(c))) : null);
  const appNb = tot(week, rows[0].pred)?.nonbounce_sessions ?? 0;
  const cols: { label: string; get: (t: Totals) => number | null; fmt: (n: number | null) => string; pp?: boolean; good: "up" | "down" }[] = [
    { label: "Non-bounce sessions", get: (t) => t.nonbounce_sessions, fmt: (n) => (n == null ? "—" : fmtInt(n)), good: "up" },
    { label: "Bounce rate", get: (t) => derived(t).bounce_rate, fmt: (n) => fmtPct(n, 1), pp: true, good: "down" },
    { label: "Non-bounce CR", get: (t) => derived(t).nonbounce_cr, fmt: (n) => fmtPct(n, 3), pp: true, good: "up" },
    { label: "Orders", get: (t) => t.orders, fmt: (n) => (n == null ? "—" : fmtInt(n)), good: "up" },
    { label: "AOV", get: (t) => derived(t).aov, fmt: (n) => fmtUsd(n, 2), good: "up" },
    { label: "Rev / NB session", get: (t) => derived(t).rev_per_nb_session, fmt: (n) => fmtUsd(n, 3), good: "up" },
    { label: "Booked revenue", get: (t) => t.booked_revenue_usd, fmt: (n) => fmtUsd(n), good: "up" },
  ];
  const delta = (cur: number | null, prev: number | null, pp?: boolean, good?: "up" | "down") => {
    if (cur == null || prev == null || prev === 0) return <span className="flat">—</span>;
    const d = cur - prev;
    const cls = Math.abs(d) < 1e-12 ? "flat" : (good === "up" ? d > 0 : d < 0) ? "up" : "down";
    return <span className={cls}>{pp ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)}pp` : `${d >= 0 ? "+" : ""}${((d / prev) * 100).toFixed(1)}%`}</span>;
  };
  const immature = isImmature(week, bangkokToday());
  return (
    <div className="panel">
      <h2>
        D1 · Weekly CEO scorecard — {fmtWeek(week)} {immature && <span className="badge b-Medium" title="Ended < 7 days ago; late cancellations can still change orders">immature</span>}
      </h2>
      <div className="sub">
        Complete Mon–Sun weeks. Deltas vs prior week{prior ? ` (${fmtWeek(prior)})` : ""} and vs 2 weeks earlier{twoAgo ? ` (${fmtWeek(twoAgo)})` : ""}. Fixed CEO scope — market/section filters do not apply.
      </div>
      <div className="scroll">
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Scope</th>
              {cols.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cur = tot(week, r.pred)!;
              const p = tot(prior, r.pred);
              const p2 = tot(twoAgo, r.pred);
              const lowOrders = cur.orders < MIN_ORDERS;
              return (
                <tr key={r.label}>
                  <td>
                    <strong>{r.label}</strong>
                    {(r.label === "iOS" || r.label === "Android") && appNb > 0 && <div className="sub">{fmtPct(cur.nonbounce_sessions / appNb, 0)} of App NB sessions</div>}
                  </td>
                  {cols.map((c, ci) => {
                    const orderBased = ci >= 2 && ci !== 3;
                    if (orderBased && lowOrders)
                      return (
                        <td key={c.label} className="pending">
                          insufficient sample
                        </td>
                      );
                    return (
                      <td key={c.label}>
                        <div>{c.fmt(c.get(cur))}</div>
                        <div style={{ fontSize: 11 }}>
                          {delta(c.get(cur), p ? c.get(p) : null, c.pp, c.good)} · {delta(c.get(cur), p2 ? c.get(p2) : null, c.pp, c.good)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="note">Small deltas: “vs prior · vs 2 weeks earlier”. Sample sizes: non-bounce sessions and orders columns.</div>
    </div>
  );
}

// ---------------- D1 REAL: Superset dataset 63 ----------------
function RealScorecard({ real }: { real: { rows: RealRow[]; source: string } }) {
  const weeks = [...new Set(real.rows.map((r) => r.week_start))].sort();
  const isApp = (p: string) => p === "iOS" || p === "Android";
  const isWeb = (p: string) => p.startsWith("Web");
  const scopes: { label: string; pred: (r: RealRow) => boolean }[] = [
    { label: "App (iOS + Android)", pred: (r) => isApp(r.platform) },
    { label: "iOS", pred: (r) => r.platform === "iOS" },
    { label: "Android", pred: (r) => r.platform === "Android" },
    { label: "Web (5 markets)", pred: (r) => isWeb(r.platform) },
    { label: "Thailand web", pred: (r) => isWeb(r.platform) && r.market === "TH" },
    { label: "Unknown platform (own bucket)", pred: (r) => !isApp(r.platform) && !isWeb(r.platform) },
  ];
  const agg = (w: string, pred: (r: RealRow) => boolean) =>
    real.rows
      .filter((r) => r.week_start === w && pred(r))
      .reduce(
        (a, r) => ({ ts: a.ts + r.total_sessions, b: a.b + r.bounce_sessions, nb: a.nb + r.non_bounce_sessions, o: a.o + r.orders, rev: a.rev + r.booked_revenue_usd }),
        { ts: 0, b: 0, nb: 0, o: 0, rev: 0 },
      );
  return (
    <div className="panel" style={{ borderColor: "var(--good)" }}>
      <h2>
        D1 · Weekly scorecard <span className="badge b-High">REAL DATA — Superset dataset 63</span>
      </h2>
      <div className="sub">
        {weeks.map(fmtWeek).join(" vs ")} · bot_flag = false · shops 1 TH, 2 SG, 4 Global USD, 12 HK, 10 (assumed AU — unconfirmed). Non-bounce sessions reproduce the
        CEO brief exactly. <span className="pending">Orders here are session-attributed gross_orders, not the brief’s eligible backend orders — they differ (see RECONCILIATION.md).</span>{" "}
        Bounce rule lives in the Cube model: <span className="pending">definition pending</span>.
      </div>
      <div className="scroll">
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Scope</th>
              {["Total sessions", "Bounce rate", "Non-bounce sessions", "Orders (session-attr.)", "Non-bounce CR", "AOV", "Booked revenue"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scopes.map((s) => {
              const v = weeks.map((w) => agg(w, s.pred));
              const cell = (f: (x: (typeof v)[number]) => string) => (
                <td>
                  {v.map((x, i) => (
                    <div key={i} className={i < v.length - 1 ? "muted" : ""} style={{ fontSize: i < v.length - 1 ? 11 : 13 }}>
                      {f(x)}
                    </div>
                  ))}
                </td>
              );
              return (
                <tr key={s.label}>
                  <td>
                    <strong>{s.label}</strong>
                  </td>
                  {cell((x) => fmtInt(x.ts))}
                  {cell((x) => (x.ts < MIN_SESSIONS ? "insufficient sample" : fmtPct(x.b / x.ts, 1)))}
                  {cell((x) => fmtInt(x.nb))}
                  {cell((x) => fmtInt(x.o))}
                  {cell((x) => (x.o < MIN_ORDERS ? "insufficient sample" : fmtPct(x.o / x.nb, 3)))}
                  {cell((x) => (x.o < MIN_ORDERS ? "insufficient sample" : fmtUsd(x.rev / x.o, 2)))}
                  {cell((x) => fmtUsd(x.rev))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="note">Small grey line = earlier week, bold = later week. Web total sessions rose sharply with bounce 78% → 86% — possible bot traffic not caught by bot_flag (open question).</div>
    </div>
  );
}

// ---------------- D2 Web opportunity board ----------------
const HYPOTHESIS: Record<Section, [string, string]> = {
  home: ["Hero/above-the-fold not matching ad intent", "Home bounce rate ↓"],
  listing: ["Slow LCP / filter UX on category pages", "Listing bounce rate ↓, listing→PDP ↑"],
  search: ["Zero/poor results for common queries", "Search exit rate ↓"],
  pdp: ["Size guide / price trust missing above fold", "PDP bounce ↓, PDP→ATB ↑"],
  bag: ["Voucher / shipping cost surprise in bag", "Bag→checkout ↑"],
  checkout: ["Form friction / payment options", "Checkout→payment ↑"],
  account: ["Login wall / OTP friction", "Account bounce ↓"],
  content: ["Campaign landing pages not shoppable", "Content bounce ↓, content→PDP ↑"],
};
const GROUP: Record<Section, string> = { home: "browse", listing: "browse", search: "browse", content: "browse", pdp: "product", bag: "txn", checkout: "txn", account: "txn" };

type Opp = { key: string; label: string; kind: "section" | "funnel"; sessions: number; current: number; benchmark: number; benchLabel: string; recoverable: number; ras: number; conf: Confidence; hyp: string; metric: string };

function Opportunities({ cells, weeks, week }: { cells: Cell[]; weeks: string[]; week: string }) {
  const [scope, setScope] = useState<"th" | "all">("th");
  const [bench, setBench] = useState<"app" | "best" | "trailing">("app");
  const mk = (c: Cell) => scope === "all" || c.market === "TH";
  const webCells = cells.filter((c) => c.week === week && c.platform === "web" && mk(c));
  const appCells = cells.filter((c) => c.week === week && (c.platform === "ios" || c.platform === "android") && mk(c));
  const scopeT = sum(webCells);
  const sd = derived(scopeT);
  const aov = sd.aov ?? 0;
  const bySec = (cs: Cell[], s: Section) => sum(cs.filter((c) => c.section === s));
  const webBR = Object.fromEntries(SECTIONS.map((s) => [s, derived(bySec(webCells, s)).bounce_rate ?? 0])) as Record<Section, number>;

  const opps: Opp[] = SECTIONS.map((s) => {
    const t = bySec(webCells, s);
    const d = derived(t);
    let benchmark = 0;
    let benchLabel = "";
    if (bench === "app") {
      benchmark = derived(bySec(appCells, s)).bounce_rate ?? 0;
      benchLabel = "App, same section";
    } else if (bench === "best") {
      const peers = SECTIONS.filter((x) => GROUP[x] === GROUP[s]);
      const b = peers.reduce((m, x) => (webBR[x] < webBR[m] ? x : m), peers[0]);
      benchmark = webBR[b];
      benchLabel = `Best ${GROUP[s]} section (${SECTION_LABEL[b]})`;
    } else {
      const prev = weeks.filter((w) => w < week).slice(-4);
      const rates = prev.map((w) => derived(sum(cells.filter((c) => c.week === w && c.platform === "web" && mk(c) && c.section === s))).bounce_rate ?? 1);
      benchmark = rates.length ? Math.min(...rates) : d.bounce_rate ?? 0;
      benchLabel = `Own trailing best (${prev.length} wk)`;
    }
    const cr = !d.suppressed_orders && d.nonbounce_cr != null ? d.nonbounce_cr : sd.nonbounce_cr ?? 0;
    const r = revenueAtStake({ total_sessions: t.total_sessions, bounce_rate: d.bounce_rate ?? 0, benchmark_bounce_rate: benchmark, nonbounce_cr: cr, aov });
    return {
      key: `s-${s}`,
      label: `${SECTION_LABEL[s]} bounce`,
      kind: "section",
      sessions: t.total_sessions,
      current: d.bounce_rate ?? 0,
      benchmark,
      benchLabel,
      recoverable: r.recoverable_sessions,
      ras: r.revenue_at_stake,
      conf: confidence(t.bounce_sessions, t.total_sessions),
      hyp: HYPOTHESIS[s][0],
      metric: HYPOTHESIS[s][1],
    };
  });

  // Funnel step losses: web step rate vs App step rate, same markets and week.
  const w = scopeT;
  const a = sum(appCells);
  const steps: [string, keyof Totals, keyof Totals, string][] = [
    ["PDP → Add to bag", "pdp", "atb", "PDP→ATB rate ↑"],
    ["Add to bag → Checkout", "atb", "checkout", "ATB→checkout rate ↑"],
    ["Checkout → Payment", "checkout", "payment", "Checkout→payment rate ↑"],
    ["Payment → Order", "payment", "orders", "Payment→order rate ↑"],
  ];
  for (const [label, from, to, metric] of steps) {
    const rw = w[from] ? w[to] / w[from] : 0;
    const ra = a[from] ? a[to] / a[from] : 0;
    const lost = w[from] * Math.max(ra - rw, 0);
    const downstream = w[to] ? w.orders / w[to] : 0;
    opps.push({
      key: `f-${from}`,
      label,
      kind: "funnel",
      sessions: w[from],
      current: rw,
      benchmark: ra,
      benchLabel: "App step rate",
      recoverable: lost,
      ras: lost * downstream * aov,
      conf: confidence(w[from] - w[to], w[from]),
      hyp: "Step friction vs app — needs session replay / test",
      metric,
    });
  }
  // Rank by revenue at stake; Low-confidence items never ranked above evidenced ones.
  opps.sort((x, y) => Number(x.conf === "Low") - Number(y.conf === "Low") || y.ras - x.ras);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2>D2 · Web opportunity board — where to optimise next</h2>
          <div className="sub">
            Weekly revenue at stake = recoverable sessions × section non-bounce CR × AOV ({fmtUsd(aov, 2)}). Hypotheses are hypotheses — each needs a test.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className="seg">
            <button aria-pressed={scope === "th"} onClick={() => setScope("th")}>Thailand web</button>
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>Web 5 markets</button>
          </span>
          <select value={bench} onChange={(e) => setBench(e.target.value as typeof bench)} aria-label="Benchmark">
            <option value="app">Benchmark: App same section</option>
            <option value="best">Benchmark: best comparable web section</option>
            <option value="trailing">Benchmark: own trailing 4-wk best</option>
          </select>
        </div>
      </div>
      <div className="scroll">
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>#</th>
              <th style={{ textAlign: "left" }}>Opportunity</th>
              <th>Sessions</th>
              <th>Current</th>
              <th>Benchmark</th>
              <th>Recoverable</th>
              <th>Revenue at stake / wk</th>
              <th>Confidence</th>
              <th style={{ textAlign: "left" }}>Hypothesis — needs test · success metric</th>
            </tr>
          </thead>
          <tbody>
            {opps.map((o, i) => (
              <tr key={o.key} className={o.conf === "Low" ? "low" : ""}>
                <td>{i + 1}</td>
                <td style={{ textAlign: "left" }}>
                  {o.label} <span className="sub">{o.kind === "funnel" ? "funnel step" : "section"}</span>
                </td>
                <td>{fmtInt(o.sessions)}</td>
                <td>{fmtPct(o.current, 1)}</td>
                <td title={o.benchLabel}>
                  {fmtPct(o.benchmark, 1)}
                  <div className="sub">{o.benchLabel}</div>
                </td>
                <td>{fmtInt(o.recoverable)}</td>
                <td>
                  <strong>{fmtUsd(o.ras)}</strong>
                </td>
                <td>
                  <span className={`badge b-${o.conf}`}>{o.conf}</span>
                </td>
                <td className="hyp">
                  {o.hyp} <em>(hypothesis — needs test)</em> · <strong>{o.metric}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note">
        Largest evidenced item = first non-grey row. Recommendations are for the team to decide; no row claims a cause. Funnel rows compare web step rates with App
        (iOS + Android) in the same markets.
      </div>
    </div>
  );
}
