"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, METRIC_KEYS, resolveRange } from "@/lib/compute";
import { DEFINITION_VERSION, Market, MARKETS } from "@/server/metrics/definitions";
import BounceCourt from "./components/BounceCourt";
import FilterBar, { compareFor, endOf, rangeError, startOf } from "./components/FilterBar";
import Kpis from "./components/Kpis";
import { useReducedMotion } from "./components/shared";
import Panels from "./components/Panels";
import PeriodSummary from "./components/PeriodSummary";
import SimpleView from "./components/SimpleView";
import { getClient, RefreshProgress } from "./components/client";
import Report from "./report/Report";
import type { Api, Filters, PanelProps } from "./components/types";

const POLL_MS = 60_000; // UI polls the local cache API; the server syncs sources every REFRESH_INTERVAL_MINUTES
const SYNC_MINUTES = 10;
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ALL_MARKETS = MARKETS.map((m) => m.id) as Market[];

function defaults(api: Api): Filters {
  const w = api.data.calendar.weeks[api.data.calendar.weeks.length - 1] ?? api.data.calendar.latest ?? "2026-09-28";
  const from = startOf(w);
  const to = endOf(addDays(w, 6));
  return {
    view: "simple",
    ceoChannel: "all",
    ceoMarket: "all",
    from,
    to,
    compare: "prior",
    ...compareFor({ from, to, compare: "prior", cfrom: "", cto: "" }),
    platform: "web",
    markets: ALL_MARKETS,
    device: "all",
    orders: api.data.orders_source,
    tab: "numbers",
    split: false,
    lanes: "market",
    metric: "bounce_rate",
  };
}

/** Filters live in the URL so any view can be shared. */
function fromUrl(api: Api): Filters {
  const d = defaults(api);
  const q = new URLSearchParams(window.location.search);
  const dt = (k: string, fb: string) => (DT.test(q.get(k) ?? "") ? (q.get(k) as string) : fb);
  const from = dt("from", d.from);
  const to = dt("to", d.to);
  const compare = (["prior", "week", "custom"].includes(q.get("c") ?? "") ? q.get("c") : "prior") as Filters["compare"];
  const markets = (q.get("m") ?? "").split(",").filter((m): m is Market => (ALL_MARKETS as string[]).includes(m));
  const f: Filters = {
    ...d,
    view: q.get("view") === "analyst" ? "analyst" : "simple",
    ceoChannel: (["all", "web", "app"].includes(q.get("cc") ?? "") ? q.get("cc") : d.ceoChannel) as Filters["ceoChannel"],
    ceoMarket: (q.get("cm") === "all" || (ALL_MARKETS as string[]).includes(q.get("cm") ?? "") ? q.get("cm") : d.ceoMarket) as Filters["ceoMarket"],
    from,
    to,
    compare,
    cfrom: dt("cfrom", d.cfrom),
    cto: dt("cto", d.cto),
    platform: (["web", "app", "ios", "android"].includes(q.get("p") ?? "") ? q.get("p") : d.platform) as Filters["platform"],
    markets: markets.length ? markets : ALL_MARKETS,
    device: (["all", "desktop", "mobile"].includes(q.get("d") ?? "") ? q.get("d") : "all") as Filters["device"],
    orders: q.get("o") === "session" ? "session" : q.get("o") === "backend" && api.data.has_backend_orders ? "backend" : d.orders,
    tab: (["numbers", "dropoffs", "decisions", "overview", "releases", "quality"].includes(q.get("t") ?? "") ? q.get("t") : "numbers") as Filters["tab"],
    metric: ((METRIC_KEYS as string[]).includes(q.get("k") ?? "") ? q.get("k") : "bounce_rate") as Filters["metric"],
    split: q.get("split") === "1",
    lanes: q.get("lanes") === "device" ? "device" : "market",
  };
  if (compare !== "custom") Object.assign(f, compareFor(f));
  return f;
}

export function filtersToQuery(f: Filters) {
  const q = new URLSearchParams({
    view: f.view,
    cc: f.ceoChannel,
    cm: f.ceoMarket,
    from: f.from,
    to: f.to,
    cfrom: f.cfrom,
    cto: f.cto,
    c: f.compare,
    p: f.platform,
    m: f.markets.join(","),
    d: f.device,
    o: f.orders,
    t: f.tab,
    lanes: f.lanes,
    k: f.metric,
  });
  if (f.split) q.set("split", "1");
  return q.toString();
}

export default function Dashboard() {
  const [api, setApi] = useState<Api | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filters | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reduced = useReducedMotion();

  const [refreshing, setRefreshing] = useState<RefreshProgress | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [report, setReport] = useState(false);
  const client = getClient();

  const load = useCallback(async () => {
    try {
      const j = await getClient().load();
      if (!j?.data?.daily) throw new Error("unexpected response shape");
      setApi(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    load();
    // the artifact re-reads its shared database less often; its Refresh button pulls on demand
    const t = setInterval(load, getClient().kind === "artifact" ? 5 * POLL_MS : POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  useEffect(() => {
    if (api && !f) setF(fromUrl(api));
  }, [api, f]);
  useEffect(() => {
    if (!f) return;
    try {
      window.history.replaceState(null, "", `?${filtersToQuery(f)}`);
    } catch {
      /* sandboxed frames may refuse history changes; filters still work in-page */
    }
  }, [f]);

  const ranges = useMemo(() => {
    if (!api || !f) return null;
    const valid = !rangeError(f.from, f.to, null, null) && !rangeError(f.cfrom, f.cto, null, null);
    const d = defaults(api);
    // Only days with tracked sessions count: otherwise orders from days without session data would be divided
    // by a partial session count (e.g. a 19.8% "CR"). Days without sessions are reported by the range warning.
    const tracked = new Set(api.data.calendar.days);
    const daily = api.data.daily.filter((r) => tracked.has(r.day));
    const hourly = (api.data.hourly ?? []).filter((r) => tracked.has(r.day));
    const cur = resolveRange(daily, hourly, valid ? f.from : d.from, valid ? f.to : d.to);
    const cmp = resolveRange(daily, hourly, valid ? f.cfrom : d.cfrom, valid ? f.cto : d.cto);
    return { cur, cmp };
  }, [api, f]);

  if (!api || !f || !ranges) {
    return (
      <main className="wrap" style={{ paddingTop: 40 }}>
        {error ? <p className="down" role="alert">Could not load metrics: {error}. Retrying every minute.</p> : <p className="muted">Loading metrics…</p>}
      </main>
    );
  }

  const set = (p: Partial<Filters>) => setF((prev) => (prev ? { ...prev, ...p } : prev));
  const props: PanelProps = { api, f, cur: ranges.cur, cmp: ranges.cmp, reduced };
  const lastSuperset = api.data.sync.find((s) => s.job === "sync-superset");
  const failed = api.data.sync.some((s) => s.status === "error");
  const ageMin = api.as_of ? (now - new Date(api.as_of).getTime()) / 60000 : Infinity;
  const pulse = failed ? "red" : ageMin > 2 * SYNC_MINUTES ? "amber" : "";
  const asOf = api.as_of ? new Date(api.as_of).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "never";
  const empty = api.data.daily.length === 0;

  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      {empty && (
        <div className="sample-banner" role="status">
          {client.kind === "artifact" ? (
            <>No data saved yet. Press ↻ Refresh data in the owner&apos;s Claude app to pull it from Superset.</>
          ) : (
            <>
              No data in the cache yet — run <code>npm run sync</code> (imports discovery snapshots; live sync needs credentials in .env.local).
            </>
          )}
        </div>
      )}
      <main className="wrap" id="main">
        <header className="top">
          <div>
            <h1>Pomelo bounce rate &amp; release impact</h1>
            <div className="sub">
              {f.view === "simple" ? (
                "A plain-English weekly readout for the website and app."
              ) : (
                <>Web (pomelofashion.com) + App (iOS + Android) · TH SG HK Global-USD AU · Bangkok time · bot_flag = false · definitions {DEFINITION_VERSION}</>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="pulse" aria-live="polite" title={lastSuperset?.message ?? ""}>
              <span className={`dot ${pulse}`} aria-hidden />
              {failed ? "A sync failed — showing last good data" : `data as of ${asOf} ICT`}
              {pulse === "amber" && !failed && (client.kind === "artifact" ? " · press Refresh for the latest" : " · stale (live sync not connected)")}
            </div>
            <button type="button" className="button" onClick={() => set({ view: f.view === "simple" ? "analyst" : "simple" })}>
              {f.view === "simple" ? "Analyst view" : "Simple view"}
            </button>
            <button
              type="button"
              className="refresh"
              disabled={Boolean(refreshing)}
              aria-busy={Boolean(refreshing)}
              onClick={async () => {
                setRefreshMsg(null);
                setRefreshing({ step: "Starting refresh", done: 0, total: 1 });
                try {
                  const r = await client.refresh((p) => setRefreshing(p));
                  await load();
                  setRefreshMsg({ ok: r.mode === "live", text: r.message });
                } catch (e) {
                  setRefreshMsg({ ok: false, text: e instanceof Error ? e.message : "Refresh failed." });
                } finally {
                  setRefreshing(null);
                }
              }}
            >
              {refreshing ? `${refreshing.step}${refreshing.total > 1 ? ` (${refreshing.done}/${refreshing.total})` : ""}…` : "↻ Refresh data"}
            </button>
            {client.kind === "local" ? (
              <a className="button" href={`/report?${filtersToQuery(f)}`}>
                Generate report
              </a>
            ) : (
              <button type="button" className="button" aria-pressed={report} onClick={() => setReport(!report)}>
                {report ? "Back to dashboard" : "Generate report"}
              </button>
            )}
          </div>
        </header>

        {refreshMsg && (
          <div className={refreshMsg.ok ? "callout" : "field-warn"} role="status" style={{ marginBottom: 8 }}>
            {refreshMsg.text}
          </div>
        )}
        {report && <Report embedded api={api} params={{ from: f.from, to: f.to, cfrom: f.cfrom, cto: f.cto, p: f.platform, m: f.markets, d: f.device, o: f.orders }} />}
        <div hidden={report}>
        {f.view === "simple" ? (
          <SimpleView {...props} set={set} />
        ) : (
          <>
            <FilterBar f={f} set={set} api={api} />
            {ranges.cur.partialDays.length > 0 && (
              <div className="note" role="note">
                Partial days:{" "}
                {ranges.cur.partialDays
                  .map((p) => `${p.day} ${String(p.fromHour).padStart(2, "0")}:00–${String(p.toHour).padStart(2, "0")}:59 (${p.precision === "hour" ? "hourly data" : "no hourly data → whole day used"}${p.orders === "unavailable" ? ", orders not hourly" : ""})`)
                  .join(" · ")}
              </div>
            )}

            <PeriodSummary {...props} />
            <nav className="tabs" role="tablist" aria-label="Views">
              {(
                [
                  ["numbers", "Numbers"],
                  ["dropoffs", "Funnel drop-offs"],
                  ["decisions", "Decisions"],
                  ["overview", "Bounce & funnel"],
                  ["releases", "Releases"],
                  ["quality", "Data quality"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={f.tab === k} onClick={() => set({ tab: k })}>
                  {label}
                </button>
              ))}
            </nav>

            <Kpis {...props} set={set} />
            <div className="grid" style={{ marginTop: 12 }}>
              {f.tab === "overview" && <BounceCourt {...props} set={set} />}
              <Panels {...props} set={set} reload={load} />
            </div>
            <p className="note">
              Non-bounce CR = eligible backend orders / known-bot-excluded non-bounce tracked sessions (operational ratio, not matched session conversion). Booked revenue = after-discount
              merchandise value in USD before returns. Cells with &lt; 30 sessions or &lt; 5 orders show “insufficient sample”. Changes are shown vs comparison; no causal claims.
            </p>
          </>
        )}
        </div>
      </main>
    </>
  );
}
