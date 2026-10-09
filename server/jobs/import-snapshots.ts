// Load read-only discovery snapshots (aggregates pulled via the Superset MCP and GitHub) into the cache.
// Idempotent: every table upserts on its natural key.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getDb, recordRun, tx } from "../cache/db";
import { IN_SCOPE_SHOPS, normalizePlatform, SHOP_MARKET } from "../metrics/definitions";
import { upsertRelease } from "./sync-github";

type Snap = { source?: string; as_of?: string; rows?: Record<string, unknown>[] };
type Row = Record<string, unknown>;

const dir = () => path.join(process.cwd(), "discovery");
function readSnap(rel: string): Snap | null {
  const p = path.join(dir(), rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pick = (r: Row, ...keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined) return r[k];
  return undefined;
};
const day10 = (v: unknown) => String(v ?? "").slice(0, 10);

function marketOf(r: Row): string | null {
  const shop = num(pick(r, "id_shop", "shop"));
  if (shop != null) return IN_SCOPE_SHOPS.includes(shop) ? SHOP_MARKET[shop] : null;
  const m = String(pick(r, "market") ?? "");
  if (/^TH/.test(m)) return "TH";
  if (/^SG/.test(m)) return "SG";
  if (/^HK/.test(m)) return "HK";
  if (/Global|shop 4/.test(m)) return "GL";
  if (/AU|shop 10/.test(m)) return "AU";
  return null;
}

function label(snap: Snap, file: string) {
  return `${file} · ${snap.as_of ?? "unknown as_of"} · ${snap.source ?? ""}`.slice(0, 500);
}

export function importTrafficDaily(): number {
  const snap = readSnap("snapshots/traffic_daily.json");
  if (!snap?.rows?.length) return 0;
  const src = label(snap, "traffic_daily");
  const st = getDb().prepare(
    `INSERT INTO traffic_daily (day, platform, device, market, total_sessions, bounces, non_bounces, orders, revenue_usd, product_views, added_to_bag, checkout, payment, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, platform, device, market) DO UPDATE SET total_sessions=excluded.total_sessions, bounces=excluded.bounces,
       non_bounces=excluded.non_bounces, orders=excluded.orders, revenue_usd=excluded.revenue_usd, product_views=excluded.product_views,
       added_to_bag=excluded.added_to_bag, checkout=excluded.checkout, payment=excluded.payment, source=excluded.source`,
  );
  let n = 0;
  tx(() => {
    for (const r of snap.rows!) {
      const market = marketOf(r);
      if (!market) continue;
      const { platform, device } = normalizePlatform(pick(r, "platform", "app_name_short_version") as string);
      const total = num(pick(r, "total_sessions")) ?? 0;
      const bounces = num(pick(r, "bounces", "bounce_sessions")) ?? 0;
      const nb = num(pick(r, "non_bounces", "non_bounce_sessions")) ?? total - bounces;
      st.run(
        day10(pick(r, "day", "date", "session_start_date")),
        platform,
        device,
        market,
        total,
        bounces,
        nb,
        num(pick(r, "gross_orders", "orders")),
        num(pick(r, "revenue_usd", "revenue_after_discount_in_usd", "booked_revenue_usd")),
        num(pick(r, "product_views", "total_product_views")),
        num(pick(r, "added_to_bag", "total_number_added_to_bag")),
        num(pick(r, "checkout", "checkout_started")),
        num(pick(r, "payment", "payment_info_entered")),
        src,
      );
      n++;
    }
  });
  return n;
}

export function importMix(): number {
  const snap = readSnap("snapshots/traffic_mix_weekly.json");
  if (!snap?.rows?.length) return 0;
  const src = label(snap, "traffic_mix_weekly");
  const st = getDb().prepare(
    `INSERT INTO traffic_mix_weekly (week, platform, device, market, channel, customer_type, total_sessions, bounces, non_bounces, orders, revenue_usd, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(week, platform, device, market, channel, customer_type) DO UPDATE SET total_sessions=excluded.total_sessions,
       bounces=excluded.bounces, non_bounces=excluded.non_bounces, orders=excluded.orders, revenue_usd=excluded.revenue_usd, source=excluded.source`,
  );
  let n = 0;
  tx(() => {
    for (const r of snap.rows!) {
      const market = marketOf(r);
      if (!market) continue;
      const { platform, device } = normalizePlatform(pick(r, "platform", "app_name_short_version") as string);
      const total = num(pick(r, "total_sessions")) ?? 0;
      const bounces = num(pick(r, "bounces", "bounce_sessions")) ?? 0;
      const ec = pick(r, "existing_customer", "customer_type");
      const customer = ec == null || ec === "" ? "unknown" : ec === true || /^(true|existing|yes|1)$/i.test(String(ec)) ? "returning" : /^(false|new|no|0)$/i.test(String(ec)) ? "new" : String(ec);
      const ch = pick(r, "channel_group", "channel");
      st.run(
        day10(pick(r, "week", "week_start")),
        platform,
        device,
        market,
        ch == null || ch === "" ? "unknown" : String(ch),
        customer,
        total,
        bounces,
        num(pick(r, "non_bounces", "non_bounce_sessions")) ?? total - bounces,
        num(pick(r, "gross_orders", "orders")),
        num(pick(r, "revenue_usd", "revenue_after_discount_in_usd")),
        src,
      );
      n++;
    }
  });
  return n;
}

export function importAppVersions(): number {
  const snap = readSnap("snapshots/app_version_weekly.json");
  if (!snap?.rows?.length) return 0;
  const src = label(snap, "app_version_weekly");
  const st = getDb().prepare(
    `INSERT INTO app_version_weekly (week, platform, version, total_sessions, bounces, non_bounces, orders, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(week, platform, version) DO UPDATE SET total_sessions=excluded.total_sessions, bounces=excluded.bounces,
       non_bounces=excluded.non_bounces, orders=excluded.orders, source=excluded.source`,
  );
  let n = 0;
  tx(() => {
    for (const r of snap.rows!) {
      const { platform } = normalizePlatform(pick(r, "platform", "app_name_short_version") as string);
      if (platform !== "ios" && platform !== "android") continue;
      const total = num(pick(r, "total_sessions")) ?? 0;
      const bounces = num(pick(r, "bounces")) ?? 0;
      const v = pick(r, "version", "product_list_viewed_app_version", "app_version");
      st.run(day10(pick(r, "week", "week_start")), platform, v == null || v === "" ? "unknown" : String(v), total, bounces, num(pick(r, "non_bounces")) ?? total - bounces, num(pick(r, "gross_orders", "orders")), src);
      n++;
    }
  });
  return n;
}

export function importOrders(): number {
  const snap = readSnap("snapshots/orders_daily.json");
  if (!snap?.rows?.length) return 0;
  const src = label(snap, "orders_daily");
  const st = getDb().prepare(
    `INSERT INTO orders_daily (day, platform, device, market, orders, revenue_usd, source) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, platform, device, market) DO UPDATE SET orders=excluded.orders, revenue_usd=excluded.revenue_usd, source=excluded.source`,
  );
  let n = 0;
  tx(() => {
    for (const r of snap.rows!) {
      const market = marketOf(r);
      if (!market) continue;
      const { platform, device } = normalizePlatform(pick(r, "platform") as string);
      st.run(day10(pick(r, "day", "date", "order_date")), platform, device, market, num(pick(r, "orders", "gross_orders")) ?? 0, num(pick(r, "revenue_usd", "revenue_after_discount_in_USD", "revenue_after_discount_in_usd")), src);
      n++;
    }
  });
  return n;
}

export function importFunnel(): number {
  const snap = readSnap("snapshots/funnel_weekly.json");
  if (!snap?.rows?.length) return 0;
  const src = label(snap, "funnel_weekly");
  const st = getDb().prepare(
    `INSERT INTO funnel_weekly (week, platform, stage, stage_order, sessions, source) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(week, platform, stage) DO UPDATE SET stage_order=excluded.stage_order, sessions=excluded.sessions, source=excluded.source`,
  );
  let n = 0;
  tx(() => {
    for (const r of snap.rows!) {
      const p = String(pick(r, "platform") ?? "").toLowerCase();
      const platform = p.startsWith("web") ? "web" : p.startsWith("ios") ? "ios" : p.startsWith("android") ? "android" : null;
      if (!platform) continue;
      // sankey rows: numeric `stage` = order, `event` = stage name, sessions_in/out; sessions reaching a stage = max(in, out)
      const name = pick(r, "event") != null ? String(pick(r, "event")) : String(pick(r, "stage"));
      const order = num(pick(r, "stage_order")) ?? (pick(r, "event") != null ? num(pick(r, "stage")) : null) ?? 0;
      const reached = num(pick(r, "sessions", "count")) ?? Math.max(num(pick(r, "sessions_in")) ?? 0, num(pick(r, "sessions_out")) ?? 0);
      st.run(day10(pick(r, "week", "week_start")), platform, name, order, reached, src);
      n++;
    }
  });
  return n;
}

/** discovery/snapshots/traffic_hourly.json and orders_hourly.json: rows carry day + hour (Bangkok). */
export function importHourly(): number {
  let n = 0;
  const t = readSnap("snapshots/traffic_hourly.json");
  if (t?.rows?.length) {
    const src = label(t, "traffic_hourly");
    const st = getDb().prepare(
      `INSERT INTO traffic_hourly (day, hour, platform, device, market, total_sessions, bounces, non_bounces, orders, revenue_usd, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, hour, platform, device, market) DO UPDATE SET total_sessions=excluded.total_sessions, bounces=excluded.bounces,
         non_bounces=excluded.non_bounces, orders=excluded.orders, revenue_usd=excluded.revenue_usd, source=excluded.source`,
    );
    tx(() => {
      for (const r of t.rows!) {
        const market = marketOf(r);
        if (!market) continue;
        const { platform, device } = normalizePlatform(pick(r, "platform", "app_name_short_version") as string);
        const total = num(pick(r, "total_sessions")) ?? 0;
        const bounces = num(pick(r, "bounces")) ?? 0;
        st.run(day10(pick(r, "day", "date")), num(pick(r, "hour")) ?? 0, platform, device, market, total, bounces, num(pick(r, "non_bounces")) ?? total - bounces, num(pick(r, "gross_orders", "orders")), num(pick(r, "revenue_usd", "revenue_after_discount_in_usd")), src);
        n++;
      }
    });
  }
  const o = readSnap("snapshots/orders_hourly.json");
  if (o?.rows?.length) {
    const src = label(o, "orders_hourly");
    const st = getDb().prepare(
      `INSERT INTO orders_hourly (day, hour, platform, device, market, orders, revenue_usd, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, hour, platform, device, market) DO UPDATE SET orders=excluded.orders, revenue_usd=excluded.revenue_usd, source=excluded.source`,
    );
    tx(() => {
      for (const r of o.rows!) {
        const market = marketOf(r);
        if (!market) continue;
        const { platform, device } = normalizePlatform(pick(r, "platform") as string);
        st.run(day10(pick(r, "day", "date")), num(pick(r, "hour")) ?? 0, platform, device, market, num(pick(r, "orders", "gross_orders")) ?? 0, num(pick(r, "revenue_usd", "revenue_after_discount_in_USD")), src);
        n++;
      }
    });
  }
  return n;
}

const tri = (v: unknown) => (v === true || /^(true|t|1|yes)$/i.test(String(v)) ? "true" : v === false || /^(false|f|0|no)$/i.test(String(v)) ? "false" : "unknown");
const fplat = (v: unknown) => {
  const p = String(v ?? "").toLowerCase();
  return p.startsWith("web") ? "web" : p.startsWith("ios") ? "ios" : p.startsWith("android") ? "android" : "unknown";
};

/** Funnel drop-off inputs: Sankey transitions + Cube session flags + Cube user funnel counts. */
export function importDropoffs(): number {
  let n = 0;
  const t = readSnap("snapshots/funnel_transitions.json");
  if (t?.rows?.length) {
    const src = label(t, "funnel_transitions");
    const st = getDb().prepare(
      `INSERT INTO funnel_transitions (week, platform, source, target, source_stage, target_stage, sessions, source_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(week, platform, source, target) DO UPDATE SET sessions=excluded.sessions, source_stage=excluded.source_stage, target_stage=excluded.target_stage, source_note=excluded.source_note`,
    );
    tx(() => {
      for (const r of t.rows!) {
        const platform = fplat(pick(r, "platform"));
        if (platform === "unknown") continue;
        st.run(day10(pick(r, "week", "week_start")), platform, String(pick(r, "source")), String(pick(r, "target")), num(pick(r, "source_stage")), num(pick(r, "target_stage")), num(pick(r, "sessions", "value")) ?? 0, src);
        n++;
      }
    });
  }
  const fl = readSnap("snapshots/session_flags_weekly.json");
  if (fl?.rows?.length) {
    const src = label(fl, "session_flags_weekly");
    const acc = new Map<string, number>();
    for (const r of fl.rows) {
      const market = marketOf(r);
      if (!market) continue;
      const k = [day10(pick(r, "week", "week_start")), fplat(pick(r, "platform", "app_name_short_version")), market, tri(pick(r, "was_signed_in", "signed_in")), tri(pick(r, "was_add_to_cart", "atc")), tri(pick(r, "was_purchase_made", "purchase"))].join("|");
      acc.set(k, (acc.get(k) ?? 0) + (num(pick(r, "sessions", "total_sessions")) ?? 0));
    }
    const st = getDb().prepare(
      `INSERT INTO session_flags_weekly (week, platform, market, signed_in, atc, purchase, sessions, source_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(week, platform, market, signed_in, atc, purchase) DO UPDATE SET sessions=excluded.sessions, source_note=excluded.source_note`,
    );
    tx(() => {
      for (const [k, v] of acc) {
        st.run(...(k.split("|") as [string, string, string, string, string, string]), v, src);
        n++;
      }
    });
  }
  const uf = readSnap("snapshots/user_funnel_weekly.json");
  if (uf?.rows?.length) {
    const src = label(uf, "user_funnel_weekly");
    const acc = new Map<string, number[]>();
    for (const r of uf.rows) {
      const market = marketOf(r);
      if (!market) continue;
      const k = [day10(pick(r, "week", "week_start")), fplat(pick(r, "platform", "app_name_short_version")), market, tri(pick(r, "was_signed_in", "signed_in"))].join("|");
      const a = acc.get(k) ?? [0, 0, 0, 0];
      a[0] += num(pick(r, "users", "total_users")) ?? 0;
      a[1] += num(pick(r, "users_list_viewed", "total_users_product_list_viewed", "list_viewed")) ?? 0;
      a[2] += num(pick(r, "users_product_click", "total_users_product_click", "product_click")) ?? 0;
      a[3] += num(pick(r, "users_added_to_bag", "total_users_added_to_bag", "added_to_bag")) ?? 0;
      acc.set(k, a);
    }
    const st = getDb().prepare(
      `INSERT INTO user_funnel_weekly (week, platform, market, signed_in, users, list_viewed, product_click, added_to_bag, source_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(week, platform, market, signed_in) DO UPDATE SET users=excluded.users, list_viewed=excluded.list_viewed, product_click=excluded.product_click, added_to_bag=excluded.added_to_bag, source_note=excluded.source_note`,
    );
    tx(() => {
      for (const [k, a] of acc) {
        st.run(...(k.split("|") as [string, string, string, string]), a[0], a[1], a[2], a[3], src);
        n++;
      }
    });
  }
  return n;
}

export function importReleases(): number {
  const p = path.join(dir(), "github_releases.json");
  if (!existsSync(p)) return 0;
  const list = JSON.parse(readFileSync(p, "utf8")) as Row[];
  let n = 0;
  tx(() => {
    for (const r of list) {
      const prs = ((r.prs as Row[]) ?? []).map((x) => ({
        number: Number(x.number),
        title: String(x.title ?? ""),
        merged_at: (x.merged_at as string) ?? null,
        author: (x.author as string) ?? null,
        labels: (x.labels as string[]) ?? [],
        dirs: (x.changed_top_dirs as string[]) ?? [],
        body: null,
        declared: Boolean(x.success_metric_declared),
      }));
      upsertRelease({
        id: `${r.repo}-${r.release_id}`,
        repo: String(r.repo),
        platform: String(r.platform),
        release_id: (r.release_id as string) ?? null,
        go_live_at: (r.go_live_at as string) ?? null,
        bangkok_date: String(r.bangkok_date ?? String(r.go_live_at).slice(0, 10)),
        signal: String(r.signal ?? "workflow_run"),
        prs,
        note: (r.note as string) ?? null,
        source: "github-discovery-snapshot",
      });
      n++;
    }
  });
  return n;
}

export function importSnapshots() {
  const started = new Date().toISOString();
  const counts = {
    traffic_daily: importTrafficDaily(),
    hourly: importHourly(),
    traffic_mix_weekly: importMix(),
    app_version_weekly: importAppVersions(),
    orders_daily: importOrders(),
    funnel_weekly: importFunnel(),
    dropoffs: importDropoffs(),
    releases: importReleases(),
  };
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  recordRun("import-snapshots", "ok", rows, JSON.stringify(counts), started);
  return counts;
}
