"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, resolveRange } from "@/lib/compute";
import { DEFINITION_VERSION, Market, MARKETS } from "@/server/metrics/definitions";
import BounceCourt from "./components/BounceCourt";
import FilterBar, { compareFor, endOf, rangeError, startOf } from "./components/FilterBar";
import Kpis from "./components/Kpis";
import { useReducedMotion } from "./components/shared";
import Panels from "./components/Panels";
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
    from,
    to,
    compare: "prior",
    ...compareFor({ from, to, compare: "prior", cfrom: "", cto: "" }),
    platform: "web",
    markets: ALL_MARKETS,
    device: "all",
    orders: api.data.orders_source,
    tab: "decisions",
    split: false,
    lanes: "market",
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
    from,
    to,
    compare,
    cfrom: dt("cfrom", d.cfrom),
    cto: dt("cto", d.cto),
    platform: (["web", "app", "ios", "android"].includes(q.get("p") ?? "") ? q.get("p") : d.platform) as Filters["platform"],
    markets: markets.length ? markets : ALL_MARKETS,
    device: (["all", "desktop", "mobile"].includes(q.get("d") ?? "") ? q.get("d") : "all") as Filters["device"],
    orders: q.get("o") === "session" ? "session" : q.get("o") === "backend" && api.data.has_backend_orders ? "backend" : d.orders,
    tab: (["decisions", "overview", "releases", "quality"].includes(q.get("t") ?? "") ? q.get("t") : "decisions") as Filters["tab"],
    split: q.get("split") === "1",
    lanes: q.get("lanes") === "device" ? "device" : "market",
  };
  if (compare !== "custom") Object.assign(f, compareFor(f));
  return f;
}

export function filtersToQuery(f: Filters) {
  const q = new URLSearchParams({ from: f.from, to: f.to, cfrom: f.cfrom, cto: f.cto, c: f.compare, p: f.platform, m: f.markets.join(","), d: f.device, o: f.orders, t: f.tab, lanes: f.lanes });
  if (f.split) q.set("split", "1");
  return q.toString();
}

export default function Dashboard() {
  const [api, setApi] = useState<Api | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filters | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reduced = useReducedMotion();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/metrics", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Api;
      if (!j?.data?.daily) throw new Error("unexpected response shape");
      setApi(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
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
    if (f) window.history.replaceState(null, "", `?${filtersToQuery(f)}`);
  }, [f]);

  const ranges = useMemo(() => {
    if (!api || !f) return null;
    const valid = !rangeError(f.from, f.to, null, null) && !rangeError(f.cfrom, f.cto, null, null);
    const d = defaults(api);
    const cur = resolveRange(api.data.daily, api.data.hourly ?? [], valid ? f.from : d.from, valid ? f.to : d.to);
    const cmp = resolveRange(api.data.daily, api.data.hourly ?? [], valid ? f.cfrom : d.cfrom, valid ? f.cto : d.cto);
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
          No data in the cache yet — run <code>npm run sync</code> (imports discovery snapshots; live sync needs credentials in .env.local).
        </div>
      )}
      <main className="wrap" id="main">
        <header className="top">
          <div>
            <h1>Pomelo bounce rate &amp; release impact</h1>
            <div className="sub">
              Web (pomelofashion.com) + App (iOS + Android) · TH SG HK Global-USD AU · Bangkok time · bot_flag = false · definitions {DEFINITION_VERSION}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="pulse" aria-live="polite" title={lastSuperset?.message ?? ""}>
              <span className={`dot ${pulse}`} aria-hidden />
              {failed ? "A sync failed — showing last good data" : `data as of ${asOf} ICT`}
              {pulse === "amber" && !failed && " · stale (live sync not connected)"}
            </div>
            <a className="button" href={`/report?${filtersToQuery(f)}`}>
              Generate report
            </a>
          </div>
        </header>

        <FilterBar f={f} set={set} api={api} />
        {ranges.cur.partialDays.length > 0 && (
          <div className="note" role="note">
            Partial days:{" "}
            {ranges.cur.partialDays
              .map((p) => `${p.day} ${String(p.fromHour).padStart(2, "0")}:00–${String(p.toHour).padStart(2, "0")}:59 (${p.precision === "hour" ? "hourly data" : "no hourly data → whole day used"}${p.orders === "unavailable" ? ", orders not hourly" : ""})`)
              .join(" · ")}
          </div>
        )}

        <nav className="tabs" role="tablist" aria-label="Views">
          {(
            [
              ["decisions", "Decisions"],
              ["overview", "Bounce & funnel"],
              ["releases", "Releases"],
              ["quality", "Data quality"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={f.tab === k} aria-pressed={f.tab === k} onClick={() => set({ tab: k })}>
              {label}
            </button>
          ))}
        </nav>

        <Kpis {...props} />
        <div className="grid" style={{ marginTop: 12 }}>
          {f.tab === "overview" && <BounceCourt {...props} set={set} />}
          <Panels {...props} set={set} reload={load} />
        </div>
        <p className="note">
          Non-bounce CR = eligible backend orders / known-bot-excluded non-bounce tracked sessions (operational ratio, not matched session conversion). Booked revenue = after-discount
          merchandise value in USD before returns. Cells with &lt; 30 sessions or &lt; 5 orders show “insufficient sample”. Changes are shown vs comparison; no causal claims.
        </p>
      </main>
    </>
  );
}
