// Artifact data client. Data lives in the artifact's shared database as compact weekly/daily documents.
// Refresh: the owner's Claude app can pull the latest days live from Superset through the local
// `superset` MCP server (read-only `query_dataset`) and save them for every viewer; any other viewer
// re-reads the newest saved data.
import type { DataClient, DecisionInput, RefreshProgress, RefreshResult } from "../app/components/client";
import type { AlertRow, Api, DecisionRow } from "../app/components/types";
import { addDays, DailyRow, mondayOf } from "../lib/compute";
import { toDropoffData } from "../lib/dropoffs";
import { availableWeeks, buildReleases, coverage, DEFAULT_ALERT_RULES, deliveryHealth, evaluateAlertRules, mergeDaily, mergeHourly } from "../lib/payload";
import type { PrRow, ReleaseRow } from "../server/impact";
import { DEFINITION_VERSION, IN_SCOPE_SHOPS, normalizePlatform, SHOP_MARKET } from "../server/metrics/definitions";
import { ELIGIBLE_ORDER_FILTERS, ELIGIBLE_ORDER_RULE_STATUS } from "../server/jobs/order-eligibility";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cap = any;
declare global {
  interface Window {
    claude?: { use(name: string): Promise<Cap | null> };
  }
}

export const SUPERSET_SERVER = "host:superset";
const LIVE_DAYS = 3; // refresh re-pulls today and the 2 days before (late events / cancellations)

const capability = (name: string): Promise<Cap | null> => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
const bangkokToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

// ---------- compact row codecs (keep documents well under 256 KiB) ----------
type T = (string | number | null)[];
const decTraffic = (r: T) => ({ day: r[0], platform: r[1], device: r[2], market: r[3], total_sessions: r[4], bounces: r[5], non_bounces: r[6], orders: r[7], revenue_usd: r[8] });
const decOrders = (r: T) => ({ day: r[0], platform: r[1], device: r[2], market: r[3], orders: r[4], revenue_usd: r[5] });
const decHourly = (day: string) => (r: T) => ({ day, hour: r[0], platform: r[1], device: r[2], market: r[3], total_sessions: r[4], bounces: r[5], non_bounces: r[6], orders: r[7], revenue_usd: r[8] });
const decHourlyOrders = (day: string) => (r: T) => ({ day, hour: r[0], platform: r[1], device: r[2], market: r[3], orders: r[4], revenue_usd: r[5] });

async function all(db: Cap, collection: string): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const snap = await db.collection(collection).limit(1000).get();
  return snap.docs.map((d: Cap) => ({ id: d.id, data: d.data() ?? {} }));
}
const rowsOf = (docs: { data: Record<string, unknown> }[]) => docs.flatMap((d) => (d.data.rows as T[]) ?? []);

/** Tolerant reader for the Superset MCP `query_dataset` payload. */
function toolRows(result: Cap): Record<string, unknown>[] {
  const find = (o: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(o)) return o as Record<string, unknown>[];
    if (o && typeof o === "object") for (const k of ["data", "rows", "result", "records"]) {
      const v = find((o as Record<string, unknown>)[k]);
      if (v) return v;
    }
    return null;
  };
  const direct = find(result?.payload) ?? find(result?.structuredContent);
  if (direct) return direct;
  for (const c of result?.content ?? []) {
    if (c?.type === "text" && c.text) {
      try {
        const v = find(JSON.parse(c.text));
        if (v) return v;
      } catch {
        /* not JSON */
      }
    }
  }
  return [];
}

function aggregateRows(rows: Record<string, unknown>[], platformKey: string, measures: string[]) {
  const acc = new Map<string, number[]>();
  for (const r of rows) {
    const shop = Number(r.id_shop);
    if (!SHOP_MARKET[shop]) continue;
    const { platform, device } = normalizePlatform(r[platformKey] as string);
    const k = `${platform}|${device}|${SHOP_MARKET[shop]}`;
    const a = acc.get(k) ?? measures.map(() => 0);
    measures.forEach((m, i) => (a[i] += Number(r[m] ?? 0) || 0));
    acc.set(k, a);
  }
  return [...acc.entries()].map(([k, v]) => [...k.split("|"), ...v]);
}

function csvFor(api: Api, q: { from: string; to: string; markets: string[]; orders: string }) {
  const lines = ["day,platform,device,market,total_sessions,bounce_sessions,non_bounce_sessions,orders,booked_revenue_usd"];
  for (const r of api.data.daily)
    if (r.day >= q.from && r.day <= q.to && q.markets.includes(r.market) && r.total > 0) {
      const o = q.orders === "session" ? r.s_orders : r.e_orders;
      const rev = q.orders === "session" ? r.s_revenue : r.e_revenue;
      lines.push([r.day, r.platform, r.device, r.market, r.total, r.bounces, r.nb, o ?? "", rev == null ? "" : rev.toFixed(2)].join(","));
    }
  return lines.join("\n");
}

let lastApi: Api | null = null;

export const artifactClient: DataClient = {
  kind: "artifact",
  canPrint: false,

  async load(): Promise<Api> {
    const db = await capability("db");
    if (!db) throw new Error("Sign in to claude.ai to load this dashboard's data.");
    const [daily, orders, hourly, hourlyOrders, mix, appver, funnel, releases, prs, decisions, acks, metaSnap, trans, flags, ufunnel] = await Promise.all([
      all(db, "daily"),
      all(db, "orders"),
      all(db, "hourly"),
      all(db, "hourly_orders"),
      all(db, "mix"),
      all(db, "appver"),
      all(db, "funnel"),
      all(db, "releases"),
      all(db, "prs"),
      all(db, "decisions"),
      all(db, "alert_acks"),
      db.doc("meta/info").get(),
      all(db, "transitions"),
      all(db, "flags"),
      all(db, "ufunnel"),
    ]);
    const meta = (metaSnap.exists ? metaSnap.data() : {}) as Record<string, unknown>;
    const dailyRows: DailyRow[] = mergeDaily(rowsOf(daily).map(decTraffic), rowsOf(orders).map(decOrders));
    const hourlyRows = mergeHourly(
      hourly.flatMap((d) => ((d.data.rows as T[]) ?? []).map(decHourly(d.id))),
      hourlyOrders.flatMap((d) => ((d.data.rows as T[]) ?? []).map(decHourlyOrders(d.id))),
    );
    const hasBackend = dailyRows.some((r) => r.e_orders != null);
    const src = hasBackend ? "backend" : "session";
    const rels = buildReleases(rowsOf(releases) as unknown as ReleaseRow[], rowsOf(prs) as unknown as PrRow[], dailyRows, src);
    const ackIds = new Set(acks.map((a) => String(a.data.id)));
    const fired = evaluateAlertRules(dailyRows, rels, DEFAULT_ALERT_RULES);
    const asOf = (meta.as_of as string) ?? null;
    const alerts: AlertRow[] = fired.map((a) => ({ ...a, fired_at: asOf ?? new Date().toISOString(), acknowledged: ackIds.has(a.id) ? 1 : 0 }));
    const api: Api = {
      data: {
        daily: dailyRows,
        hourly: hourlyRows,
        mix: rowsOf(mix).map((r) => ({ week: r[0], platform: r[1], device: r[2], market: r[3], channel: r[4], customer_type: r[5], total_sessions: r[6], bounces: r[7], non_bounces: r[8], orders: r[9], revenue_usd: r[10] })) as unknown as Api["data"]["mix"],
        app_versions: rowsOf(appver).map((r) => ({ week: r[0], platform: r[1], version: r[2], total_sessions: r[3], bounces: r[4], non_bounces: r[5], orders: r[6] })) as unknown as Api["data"]["app_versions"],
        dropoffs: toDropoffData(
          trans.flatMap((d) => ((d.data.rows as T[]) ?? []).map((r) => ({ week: d.id, platform: r[0], source: r[1], target: r[2], source_stage: r[3], target_stage: r[4], sessions: r[5] }))),
          flags.flatMap((d) => ((d.data.rows as T[]) ?? []).map((r) => ({ week: d.id, platform: r[0], market: r[1], signed_in: r[2], atc: r[3], purchase: r[4], sessions: r[5] }))),
          ufunnel.flatMap((d) => ((d.data.rows as T[]) ?? []).map((r) => ({ week: d.id, platform: r[0], market: r[1], signed_in: r[2], users: r[3], list_viewed: r[4], product_click: r[5], added_to_bag: r[6] }))),
        ),
        funnel: rowsOf(funnel).map((r) => ({ week: r[0], platform: r[1], stage: r[2], stage_order: r[3], sessions: r[4], source: "funnel snapshot" })) as unknown as Api["data"]["funnel"],
        releases: rels,
        health: deliveryHealth(rels),
        alerts,
        decisions: decisions.map((d) => d.data as unknown as DecisionRow).sort((a, b) => b.decided_on.localeCompare(a.decided_on) || b.id - a.id),
        calendar: availableWeeks(dailyRows),
        orders_source: src,
        has_backend_orders: hasBackend,
        sync: (meta.sync as Api["data"]["sync"]) ?? [],
      },
      as_of: asOf,
      source: {
        traffic: (meta.traffic_source as string) ?? "Superset dataset 63 (Cube segment_session) — saved in this artifact",
        orders_rule: ELIGIBLE_ORDER_RULE_STATUS,
        refresh: "↻ Refresh pulls the latest days live from Superset in the owner's Claude app (local Superset connector); other viewers reload the newest saved data",
        vitals: "not connected (CRUX_API_KEY lives on the local server)",
        warehouse: "not connected (RudderStack tables are not exposed as Superset datasets)",
      },
      definition_version: DEFINITION_VERSION,
      coverage: coverage(dailyRows),
    };
    lastApi = api;
    return api;
  },

  async refresh(onProgress?: (p: RefreshProgress) => void): Promise<RefreshResult> {
    const reloaded = (why: string): RefreshResult => ({ mode: "reloaded", message: `${why} Showing the newest saved data.` });
    const [mcp, db, user] = await Promise.all([capability("mcp"), capability("db"), capability("user")]);
    if (!db) throw new Error("Sign in to claude.ai to refresh this dashboard.");
    if (!mcp) return reloaded("Live pull from Superset is not available in this view.");
    const today = bangkokToday();
    const days = Array.from({ length: LIVE_DAYS }, (_, i) => addDays(today, i - (LIVE_DAYS - 1)));
    const total = days.length * 2;
    let done = 0;
    const call = async (args: Record<string, unknown>) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return toolRows(await mcp.callTool(SUPERSET_SERVER, "query_dataset", args, { cache: false }));
        } catch (e) {
          const err = e as { code?: string; message?: string; retryable?: boolean; retryAfterMs?: number };
          // Superset's Cube backend often times out on the first call and answers from cache on the second
          const timeout = err.code === "tool_error" && /timed out/i.test(err.message ?? "");
          if (attempt === 0 && (err.retryable || timeout)) {
            await new Promise((r) => setTimeout(r, err.retryAfterMs ?? 1500 + Math.random() * 1500));
            continue;
          }
          throw err;
        }
      }
      return [];
    };
    const fresh: { day: string; traffic: T[]; orders: T[] }[] = [];
    try {
      for (const day of days) {
        const next = addDays(day, 1);
        onProgress?.({ step: `Pulling sessions for ${day}`, done, total });
        const traffic = await call({
          dataset_id: 63,
          columns: ["app_name_short_version", "id_shop", "total_sessions", "bounces", "non_bounces", "gross_orders", "revenue_after_discount_in_usd"],
          filters: [
            { column: "session_start_date", operator: "gte", value: day },
            { column: "session_start_date", operator: "lt", value: next },
            { column: "bot_flag", operator: "eq", value: false },
            { column: "id_shop", operator: "in", value: IN_SCOPE_SHOPS },
          ],
          row_limit: 500,
        });
        done++;
        onProgress?.({ step: `Pulling orders for ${day}`, done, total });
        const orders = await call({
          dataset_id: 33,
          columns: ["platform", "id_shop", "gross_orders", "revenue_after_discount_in_USD"],
          filters: [{ column: "order_date", operator: "gte", value: day }, { column: "order_date", operator: "lt", value: next }, { column: "id_shop", operator: "in", value: IN_SCOPE_SHOPS }, ...ELIGIBLE_ORDER_FILTERS],
          row_limit: 500,
        });
        done++;
        fresh.push({
          day,
          traffic: aggregateRows(traffic, "app_name_short_version", ["total_sessions", "bounces", "non_bounces", "gross_orders", "revenue_after_discount_in_usd"]).map((r) => [day, ...r]) as T[],
          orders: aggregateRows(orders, "platform", ["gross_orders", "revenue_after_discount_in_USD"]).map((r) => [day, ...r]) as T[],
        });
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      switch (err.code) {
        case "server_not_connected":
          return reloaded("Live pull needs the Claude desktop app with the Superset connector running (owner only).");
        case "not_in_manifest":
        case "not_granted":
        case "capability_disabled":
        case "capability_removed":
          return reloaded("Superset access is not allowed for this page in this view (check the artifact's Permissions).");
        case "cancelled":
          return reloaded("The Superset call was declined.");
        case "tool_error":
          throw new Error(`Superset reported an error: ${err.message ?? "unknown"}. Nothing was saved; the previous data is unchanged.`);
        default:
          throw new Error(`Live pull failed (${err.code ?? "error"}): ${err.message ?? ""}. Nothing was saved.`);
      }
    }

    // Save: replace the refreshed days inside their week documents, one write per document.
    onProgress?.({ step: "Saving for all viewers", done, total });
    const byWeek = new Map<string, typeof fresh>();
    for (const f of fresh) byWeek.set(mondayOf(f.day), [...(byWeek.get(mondayOf(f.day)) ?? []), f]);
    for (const [week, items] of byWeek) {
      const ds = new Set(items.map((i) => i.day));
      for (const [col, key] of [["daily", "traffic"], ["orders", "orders"]] as const) {
        const ref = db.doc(`${col}/${week}`);
        const snap = await ref.get();
        const kept = ((snap.exists ? (snap.data().rows as T[]) : []) ?? []).filter((r) => !ds.has(String(r[0])));
        await ref.set({ rows: [...kept, ...items.flatMap((i) => i[key])] });
      }
    }
    const metaRef = db.doc("meta/info");
    const metaSnap = await metaRef.get();
    const meta = (metaSnap.exists ? metaSnap.data() : {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    const entry = { job: "artifact-refresh", status: "ok", finished_at: now, rows: fresh.reduce((a, f) => a + f.traffic.length + f.orders.length, 0), message: `live pull ${days[0]} → ${days[days.length - 1]}` };
    const sync = [entry, ...(((meta.sync as unknown[]) ?? []) as Record<string, unknown>[]).filter((s) => s.job !== "artifact-refresh")];
    await metaRef.set({ ...meta, as_of: now, refreshed_by: (await user?.id?.()) ?? null, sync });
    return { mode: "live", message: `Pulled ${days[0]} → ${days[days.length - 1]} from Superset and saved it for every viewer (${entry.rows} aggregate rows). Today is a partial day.` };
  },

  async createDecision(d: DecisionInput) {
    const db = await capability("db");
    if (!db) throw new Error("Sign in to save decisions.");
    const existing = await all(db, "decisions");
    const id = existing.reduce((m, x) => Math.max(m, Number(x.data.id) || 0), 0) + 1;
    const row: DecisionRow = {
      id,
      created_at: new Date().toISOString(),
      decided_on: d.decided_on,
      decision: d.decision.trim().slice(0, 300),
      owner: d.owner.trim().slice(0, 80),
      opportunity_key: d.opportunity_key || null,
      release_ids: d.release_ids || null,
      hypothesis: d.hypothesis || null,
      success_metric: d.success_metric || null,
      target: d.target || null,
      review_date: d.review_date || null,
      outcome: "Pending",
      notes: d.notes || null,
    };
    await db.doc(`decisions/${id}`).set(row as unknown as Record<string, unknown>);
    return { ref: `DEC-${id}` };
  },

  async updateDecision(id: number, outcome: string) {
    const db = await capability("db");
    if (!db) throw new Error("Sign in to update decisions.");
    await db.doc(`decisions/${id}`).update({ outcome });
  },

  async ackAlert(id: string) {
    const db = await capability("db");
    if (!db) throw new Error("Sign in to acknowledge alerts.");
    await db.doc(`alert_acks/${id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180)}`).set({ id, at: new Date().toISOString() });
  },

  async vitals() {
    return { data: [], source: "not connected in the artifact — Core Web Vitals need CRUX_API_KEY on the local server (no RUM source live)" };
  },

  async exportCsv(q) {
    const downloads = await capability("downloads");
    if (!downloads) throw new Error("Downloads are not available in this view.");
    if (!lastApi) throw new Error("Data is still loading.");
    await downloads.save({ filename: `pomelo-aggregates-${q.from}-to-${q.to}.csv`, data: csvFor(lastApi, q) });
  },
};
