// Read model over the cache. Everything returned is an aggregate (day/week grain or coarser).
import { addDays, completeWeeks, DailyRow, HourlyRow, mondayOf, OrdersSource } from "@/lib/compute";
import { getDb } from "./cache/db";
import { computeImpact, confounders, Impact, PrRow, releaseMetric, ReleaseRow } from "./impact";
import { bangkokToday, Market, MARKETS } from "./metrics/definitions";
import { METRIC_LABEL } from "./metrics/release-metric";

const ALL_MARKETS = MARKETS.map((m) => m.id) as Market[];

export function loadDaily(): DailyRow[] {
  const db = getDb();
  const t = db.prepare("SELECT * FROM traffic_daily").all() as Record<string, unknown>[];
  const o = db.prepare("SELECT * FROM orders_daily").all() as Record<string, unknown>[];
  const key = (r: Record<string, unknown>) => `${r.day}|${r.platform}|${r.device}|${r.market}`;
  const orders = new Map(o.map((r) => [key(r), r]));
  const hasOrders = o.length > 0;
  const out: DailyRow[] = t.map((r) => {
    const e = orders.get(key(r));
    orders.delete(key(r));
    return {
      day: String(r.day),
      platform: r.platform as DailyRow["platform"],
      device: r.device as DailyRow["device"],
      market: r.market as Market,
      total: Number(r.total_sessions),
      bounces: Number(r.bounces),
      nb: Number(r.non_bounces),
      s_orders: r.orders == null ? null : Number(r.orders),
      s_revenue: r.revenue_usd == null ? null : Number(r.revenue_usd),
      e_orders: hasOrders ? Number(e?.orders ?? 0) : null,
      e_revenue: hasOrders ? Number(e?.revenue_usd ?? 0) : null,
    };
  });
  // backend orders on a key with no tracked sessions stay visible (orders without traffic), never dropped
  for (const e of orders.values()) {
    out.push({
      day: String(e.day),
      platform: e.platform as DailyRow["platform"],
      device: e.device as DailyRow["device"],
      market: e.market as Market,
      total: 0,
      bounces: 0,
      nb: 0,
      s_orders: null,
      s_revenue: null,
      e_orders: Number(e.orders),
      e_revenue: e.revenue_usd == null ? null : Number(e.revenue_usd),
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Hourly rows (Bangkok hour). Orders are null for a day when the source has no hourly order times. */
export function loadHourly(): HourlyRow[] {
  const db = getDb();
  const t = db.prepare("SELECT * FROM traffic_hourly").all() as Record<string, unknown>[];
  const o = db.prepare("SELECT * FROM orders_hourly").all() as Record<string, unknown>[];
  const key = (r: Record<string, unknown>) => `${r.day}|${r.hour}|${r.platform}|${r.device}|${r.market}`;
  const orders = new Map(o.map((r) => [key(r), r]));
  const orderDays = new Set(o.map((r) => String(r.day)));
  return t.map((r) => {
    const e = orders.get(key(r));
    const known = orderDays.has(String(r.day));
    return {
      day: String(r.day),
      hour: Number(r.hour),
      platform: r.platform as DailyRow["platform"],
      device: r.device as DailyRow["device"],
      market: r.market as Market,
      total: Number(r.total_sessions),
      bounces: Number(r.bounces),
      nb: Number(r.non_bounces),
      s_orders: r.orders == null ? null : Number(r.orders),
      s_revenue: r.revenue_usd == null ? null : Number(r.revenue_usd),
      e_orders: known ? Number(e?.orders ?? 0) : null,
      e_revenue: known ? Number(e?.revenue_usd ?? 0) : null,
    };
  });
}

export function loadTable<T>(sql: string): T[] {
  return getDb().prepare(sql).all() as T[];
}

export interface ReleaseView extends ReleaseRow {
  prs: (Omit<PrRow, "dirs" | "decision_ids"> & { dirs: string[]; decision_ids: string[] })[];
  metric: { id: string; label: string; direction: "up" | "down"; source: string; surface: string };
  impacts: Impact[];
  confounders: { id: string; repo: string; date: string }[];
  decision_ids: string[];
}

export function loadReleases(rows: DailyRow[], src: OrdersSource): ReleaseView[] {
  const rels = loadTable<ReleaseRow>("SELECT * FROM releases ORDER BY bangkok_date");
  const prs = loadTable<PrRow>("SELECT * FROM release_prs");
  const byRel = new Map<string, PrRow[]>();
  for (const p of prs) byRel.set(p.release_key, [...(byRel.get(p.release_key) ?? []), p]);
  const today = bangkokToday();
  return rels.map((r) => {
    const ps = byRel.get(r.id) ?? [];
    const m = releaseMetric(ps);
    const scopes: ("web" | "app")[] = r.platform === "web" ? ["web"] : r.platform === "backend" ? ["web", "app"] : ["app"];
    // App releases ramp per platform; measure the platform that shipped (falls back to App when mixed).
    const impacts = scopes.map((s) => computeImpact(rows, s, r.bangkok_date, m.metric, m.direction, ALL_MARKETS, today, src));
    if (r.platform === "ios" || r.platform === "android") {
      impacts[0] = { ...computeImpact(rows.filter((x) => x.platform === r.platform), "app", r.bangkok_date, m.metric, m.direction, ALL_MARKETS, today, src) };
    }
    const decisionIds = [...new Set(ps.flatMap((p) => JSON.parse(p.decision_ids || "[]") as string[]))];
    return {
      ...r,
      prs: ps.map((p) => ({ ...p, dirs: JSON.parse(p.dirs || "[]"), decision_ids: JSON.parse(p.decision_ids || "[]") })),
      metric: { id: m.metric, label: METRIC_LABEL[m.metric], direction: m.direction, source: m.source, surface: m.surface },
      impacts,
      confounders: confounders(rels, r),
      decision_ids: decisionIds,
    };
  });
}

/** D8 delivery health per platform. */
export function deliveryHealth(rels: ReleaseView[]) {
  const platforms = ["web", "ios", "android", "backend"] as const;
  const weeks = [...new Set(rels.map((r) => mondayOf(r.bangkok_date)))].sort();
  return platforms.map((p) => {
    const rs = rels.filter((r) => r.platform === p);
    const perWeek = weeks.map((w) => ({ week: w, deploys: rs.filter((r) => mondayOf(r.bangkok_date) === w).length }));
    const declared = rs.filter((r) => r.metric.source === "declared").length;
    const judged = rs.filter((r) => r.impacts.some((i) => i.verdict === "moved as expected" || i.verdict === "moved opposite" || i.verdict === "no clear change"));
    const expected = judged.filter((r) => r.impacts.some((i) => i.verdict === "moved as expected")).length;
    const hotfix = rs.filter((r) => {
      const isFix = r.prs.some((x) => /\b(hotfix|revert|rollback)\b/i.test(x.title)) || /\.\d+\.\d+\.\d+$/.test(r.release_id ?? "");
      const prior = rs.some((o) => o.id !== r.id && o.bangkok_date <= r.bangkok_date && o.bangkok_date >= addDays(r.bangkok_date, -7));
      return isFix && prior;
    }).length;
    return {
      platform: p,
      releases: rs.length,
      prs: rs.reduce((a, r) => a + r.prs.length, 0),
      per_week: perWeek,
      declared_share: rs.length ? declared / rs.length : null,
      judged: judged.length,
      moved_expected_share: judged.length ? expected / judged.length : null,
      hotfix_within_7d: hotfix,
      confounded_share: rs.length ? rs.filter((r) => r.confounded).length / rs.length : null,
    };
  });
}

export function coverage(rows: DailyRow[]) {
  const total = rows.reduce((a, r) => a + r.total, 0);
  const unknown = rows.filter((r) => r.platform === "unknown").reduce((a, r) => a + r.total, 0);
  const ordersNoTraffic = rows.filter((r) => r.total === 0).reduce((a, r) => a + (r.e_orders ?? 0), 0);
  return { total_sessions: total, unknown_platform_sessions: unknown, unknown_platform_share: total ? unknown / total : 0, orders_without_tracked_sessions: ordersNoTraffic };
}

export function availableWeeks(rows: DailyRow[]) {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  return { days, weeks: completeWeeks(days, bangkokToday()), latest: days[days.length - 1] ?? null, earliest: days[0] ?? null };
}
