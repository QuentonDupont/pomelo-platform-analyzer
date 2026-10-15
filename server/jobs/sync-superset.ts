// Incremental, idempotent Superset sync. Re-pulls a trailing window (default 14 days) because
// late cancellations and late-arriving events change recent days. One query per Bangkok day keeps
// the day assignment explicit (from the filter) and each result well under the 500-row cap.
import { queryDataset, supersetTransport } from "../adapters/superset";
import { getDb, recordRun, tx } from "../cache/db";
import { IN_SCOPE_SHOPS, normalizePlatform, SHOP_MARKET } from "../metrics/definitions";
import { ELIGIBLE_ORDER_FILTERS } from "./order-eligibility";

const TRAFFIC_DATASET = 63; // Cube-PROD public.segment_session
const ORDERS_DATASET = 33; // Cube-PROD public.online_sales

export const TRAFFIC_COLUMNS = [
  "app_name_short_version",
  "id_shop",
  "total_sessions",
  "bounces",
  "non_bounces",
  "gross_orders",
  "revenue_after_discount_in_usd",
  "total_product_views",
  "total_number_added_to_bag",
  "total_number_product_list_viewed",
  "total_number_products_clicked",
  "total_number_product_searches",
];

const addDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const n = (v: unknown) => (v == null ? null : Number(v));

/** "YYYY-MM-DD HH:00:00" in Bangkok for `hoursAgo` hours before now. */
function bangkokHour(hoursAgo: number) {
  const t = new Date(Date.now() + 7 * 3600_000 - hoursAgo * 3600_000).toISOString();
  return { day: t.slice(0, 10), hour: Number(t.slice(11, 13)), stamp: `${t.slice(0, 10)} ${t.slice(11, 13)}:00:00` };
}

/**
 * Hourly sessions for the trailing window (traffic only: online_sales order_date has no confirmed
 * time component, so hourly orders come only from snapshots that verified it).
 */
async function syncHourly(hours: number, transport: string, started: string) {
  const up = getDb().prepare(
    `INSERT INTO traffic_hourly (day, hour, platform, device, market, total_sessions, bounces, non_bounces, orders, revenue_usd, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, hour, platform, device, market) DO UPDATE SET total_sessions=excluded.total_sessions, bounces=excluded.bounces,
       non_bounces=excluded.non_bounces, orders=excluded.orders, revenue_usd=excluded.revenue_usd, source=excluded.source`,
  );
  let rows = 0;
  for (let h = hours; h >= 0; h--) {
    const cur = bangkokHour(h);
    const next = bangkokHour(h - 1);
    const res = await queryDataset({
      dataset_id: TRAFFIC_DATASET,
      columns: TRAFFIC_COLUMNS,
      filters: [
        { column: "session_start_date", operator: "gte", value: cur.stamp },
        { column: "session_start_date", operator: "lt", value: next.stamp },
        { column: "bot_flag", operator: "eq", value: false },
        { column: "id_shop", operator: "in", value: IN_SCOPE_SHOPS },
      ],
    });
    const acc = new Map<string, number[]>();
    for (const r of res) {
      const shop = Number(r.id_shop);
      if (!SHOP_MARKET[shop]) continue;
      const { platform, device } = normalizePlatform(r.app_name_short_version as string);
      const k = `${platform}|${device}|${SHOP_MARKET[shop]}`;
      const a = acc.get(k) ?? [0, 0, 0, 0, 0];
      a[0] += n(r.total_sessions) ?? 0;
      a[1] += n(r.bounces) ?? 0;
      a[2] += n(r.non_bounces) ?? 0;
      a[3] += n(r.gross_orders) ?? 0;
      a[4] += n(r.revenue_after_discount_in_usd) ?? 0;
      acc.set(k, a);
    }
    tx(() => {
      for (const [k, a] of acc) {
        const [platform, device, market] = k.split("|");
        up.run(cur.day, cur.hour, platform, device, market, a[0], a[1], a[2], a[3], a[4], `superset-${transport} hourly sync ${started}`);
        rows++;
      }
    });
  }
  return rows;
}

export async function syncSuperset(lookbackDays = Number(process.env.SYNC_LOOKBACK_DAYS ?? 14)) {
  const started = new Date().toISOString();
  const transport = supersetTransport();
  if (!transport) {
    const msg = "Superset credentials not set (SUPERSET_MCP_URL/TOKEN or SUPERSET_URL + login) — source not connected; showing last snapshot";
    recordRun("sync-superset", "skipped", 0, msg, started);
    return { status: "skipped" as const, rows: 0, message: msg };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const db = getDb();
  const upTraffic = db.prepare(
    `INSERT INTO traffic_daily (day, platform, device, market, total_sessions, bounces, non_bounces, orders, revenue_usd, product_views, added_to_bag, list_views, product_clicks, searches, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, platform, device, market) DO UPDATE SET total_sessions=excluded.total_sessions, bounces=excluded.bounces,
       non_bounces=excluded.non_bounces, orders=excluded.orders, revenue_usd=excluded.revenue_usd, product_views=excluded.product_views,
       added_to_bag=excluded.added_to_bag, list_views=excluded.list_views, product_clicks=excluded.product_clicks, searches=excluded.searches, source=excluded.source`,
  );
  const upOrders = db.prepare(
    `INSERT INTO orders_daily (day, platform, device, market, orders, revenue_usd, source) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, platform, device, market) DO UPDATE SET orders=excluded.orders, revenue_usd=excluded.revenue_usd, source=excluded.source`,
  );
  let rows = 0;
  try {
    for (let i = lookbackDays; i >= 0; i--) {
      const day = addDays(today, -i);
      const next = addDays(day, 1);
      const traffic = await queryDataset({
        dataset_id: TRAFFIC_DATASET,
        columns: TRAFFIC_COLUMNS,
        filters: [
          { column: "session_start_date", operator: "gte", value: day },
          { column: "session_start_date", operator: "lt", value: next },
          { column: "bot_flag", operator: "eq", value: false },
          { column: "id_shop", operator: "in", value: IN_SCOPE_SHOPS },
        ],
      });
      const orders = await queryDataset({
        dataset_id: ORDERS_DATASET,
        columns: ["platform", "id_shop", "gross_orders", "revenue_after_discount_in_USD"],
        filters: [
          { column: "order_date", operator: "gte", value: day },
          { column: "order_date", operator: "lt", value: next },
          { column: "id_shop", operator: "in", value: IN_SCOPE_SHOPS },
          ...ELIGIBLE_ORDER_FILTERS,
        ],
      });
      const src = `superset-${transport} live sync ${started} · dataset 63 / 33`;
      tx(() => {
        // aggregate in case the source returns more than one row per platform x shop
        const acc = new Map<string, number[]>();
        const measures = TRAFFIC_COLUMNS.slice(2);
        for (const r of traffic) {
          const shop = Number(r.id_shop);
          if (!SHOP_MARKET[shop]) continue;
          const { platform, device } = normalizePlatform(r.app_name_short_version as string);
          const k = `${platform}|${device}|${SHOP_MARKET[shop]}`;
          const a = acc.get(k) ?? measures.map(() => 0);
          measures.forEach((m, i) => (a[i] += n(r[m]) ?? 0));
          acc.set(k, a);
        }
        for (const [k, a] of acc) {
          const [platform, device, market] = k.split("|");
          upTraffic.run(day, platform, device, market, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], src);
          rows++;
        }
        const oacc = new Map<string, number[]>();
        for (const r of orders) {
          const shop = Number(r.id_shop);
          if (!SHOP_MARKET[shop]) continue;
          const { platform, device } = normalizePlatform(r.platform as string);
          const k = `${platform}|${device}|${SHOP_MARKET[shop]}`;
          const a = oacc.get(k) ?? [0, 0];
          a[0] += n(r.gross_orders) ?? 0;
          a[1] += n(r.revenue_after_discount_in_USD) ?? 0;
          oacc.set(k, a);
        }
        for (const [k, a] of oacc) {
          const [platform, device, market] = k.split("|");
          upOrders.run(day, platform, device, market, a[0], a[1], src);
          rows++;
        }
      });
    }
    rows += await syncHourly(Number(process.env.SYNC_HOURLY_LOOKBACK_HOURS ?? 6), transport, started);
    recordRun("sync-superset", "ok", rows, `${rows} rows over ${lookbackDays + 1} days via ${transport}`, started);
    return { status: "ok" as const, rows, message: `${rows} rows` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordRun("sync-superset", "error", rows, msg, started);
    return { status: "error" as const, rows, message: msg };
  }
}
