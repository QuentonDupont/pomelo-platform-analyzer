// Pure, browser-safe payload builders shared by the local server (SQLite cache) and the published
// Artifact (artifact database). Same inputs → same dashboard numbers in both places.
import { addDays, aggregate, completeWeeks, DailyRow, filterRows, HourlyRow, mondayOf, OrdersSource, rates } from "@/lib/compute";
import { computeImpact, confounders, Impact, PrRow, releaseMetric, ReleaseRow } from "@/server/impact";
import { bangkokToday, Market, MARKETS, newcombeDiff, PlatformFilter } from "@/server/metrics/definitions";
import { METRIC_LABEL } from "@/server/metrics/metric-labels";

const ALL_MARKETS = MARKETS.map((m) => m.id) as Market[];
type Rec = Record<string, unknown>;

/** Merge session aggregates with backend orders on day × platform × device × market. */
export function mergeDaily(traffic: Rec[], orders: Rec[]): DailyRow[] {
  const key = (r: Rec) => `${r.day}|${r.platform}|${r.device}|${r.market}`;
  const om = new Map(orders.map((r) => [key(r), r]));
  const hasOrders = orders.length > 0;
  const out: DailyRow[] = traffic.map((r) => {
    const e = om.get(key(r));
    om.delete(key(r));
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
  for (const e of om.values()) {
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
export function mergeHourly(traffic: Rec[], orders: Rec[]): HourlyRow[] {
  const key = (r: Rec) => `${r.day}|${r.hour}|${r.platform}|${r.device}|${r.market}`;
  const om = new Map(orders.map((r) => [key(r), r]));
  const orderDays = new Set(orders.map((r) => String(r.day)));
  return traffic.map((r) => {
    const e = om.get(key(r));
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

export interface ReleaseView extends ReleaseRow {
  prs: (Omit<PrRow, "dirs" | "decision_ids"> & { dirs: string[]; decision_ids: string[] })[];
  metric: { id: string; label: string; direction: "up" | "down"; source: string; surface: string };
  impacts: Impact[];
  confounders: { id: string; repo: string; date: string }[];
  decision_ids: string[];
}

const parseList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  try {
    return JSON.parse(String(v || "[]"));
  } catch {
    return [];
  }
};

export function buildReleases(rels: ReleaseRow[], prs: PrRow[], rows: DailyRow[], src: OrdersSource, today = bangkokToday()): ReleaseView[] {
  const byRel = new Map<string, PrRow[]>();
  for (const p of prs) byRel.set(p.release_key, [...(byRel.get(p.release_key) ?? []), p]);
  const sorted = [...rels].sort((a, b) => a.bangkok_date.localeCompare(b.bangkok_date));
  return sorted.map((r) => {
    const ps = byRel.get(r.id) ?? [];
    const m = releaseMetric(ps);
    const scopes: ("web" | "app")[] = r.platform === "web" ? ["web"] : r.platform === "backend" ? ["web", "app"] : ["app"];
    const impacts = scopes.map((s) => computeImpact(rows, s, r.bangkok_date, m.metric, m.direction, ALL_MARKETS, today, src));
    // App releases ship per platform: measure the platform that shipped.
    if (r.platform === "ios" || r.platform === "android") {
      impacts[0] = computeImpact(rows.filter((x) => x.platform === r.platform), "app", r.bangkok_date, m.metric, m.direction, ALL_MARKETS, today, src);
    }
    return {
      ...r,
      prs: ps.map((p) => ({ ...p, dirs: parseList(p.dirs), decision_ids: parseList(p.decision_ids) })),
      metric: { id: m.metric, label: METRIC_LABEL[m.metric], direction: m.direction, source: m.source, surface: m.surface },
      impacts,
      confounders: confounders(sorted, r),
      decision_ids: [...new Set(ps.flatMap((p) => parseList(p.decision_ids)))],
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

/** Calendar is driven by days that have tracked sessions (order-only days don't make a range usable). */
export function availableWeeks(rows: DailyRow[], today = bangkokToday()) {
  const days = [...new Set(rows.filter((r) => r.total > 0).map((r) => r.day))].sort();
  return { days, weeks: completeWeeks(days, today), latest: days[days.length - 1] ?? null, earliest: days[0] ?? null };
}

// ---------- D10 alert rules (pure evaluation) ----------
export type AlertRule = {
  id: string;
  label: string;
  scope?: { platform: PlatformFilter; markets: Market[] };
  metric: "bounce_rate" | "nonbounce_cr" | "release";
  threshold_pp?: number;
  min_sessions?: number;
  min_orders?: number;
  panel: string;
};
export type FiredAlert = { id: string; rule: string; severity: string; message: string; sample: string; panel: string };

/** Mirrors config/alerts.yml (the artifact has no file system; the server reads the YAML). */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: "th_web_bounce_up", label: "Thailand web bounce rate up vs trailing 4 complete weeks", scope: { platform: "web", markets: ["TH"] }, metric: "bounce_rate", threshold_pp: 3, min_sessions: 1000, panel: "decisions" },
  { id: "web_cr_down", label: "Web (5 markets) non-bounce CR down vs trailing 4 complete weeks", scope: { platform: "web", markets: ALL_MARKETS }, metric: "nonbounce_cr", threshold_pp: 0.15, min_orders: 20, panel: "decisions" },
  { id: "app_bounce_up", label: "App (iOS + Android) app-bounce rate up vs trailing 4 complete weeks", scope: { platform: "app", markets: ALL_MARKETS }, metric: "bounce_rate", threshold_pp: 3, min_sessions: 1000, panel: "decisions" },
  { id: "release_wrong_way", label: "Release success metric moved opposite to expected after 7+ days", metric: "release", panel: "releases" },
];

/** Never fires on immature (< 7 days old) weeks or below the sample thresholds. */
export function evaluateAlertRules(rows: DailyRow[], releases: ReleaseView[], rules: AlertRule[], today = bangkokToday()): FiredAlert[] {
  if (!rows.length) return [];
  const tracked = rows.filter((r) => r.total > 0);
  const weeks = completeWeeks([...new Set(tracked.map((r) => r.day))].sort(), today);
  const mature = weeks.filter((w) => addDays(w, 6) <= addDays(today, -7));
  const latest = mature[mature.length - 1];
  const fired: FiredAlert[] = [];
  for (const r of rules) {
    if (r.metric === "release" || !latest || !r.scope) continue;
    const trailing = mature.slice(-5, -1);
    if (trailing.length < 2) continue;
    const f = (from: string, to: string) => aggregate(filterRows(tracked, { from, to, platform: r.scope!.platform, markets: r.scope!.markets, device: "all" }), "backend");
    const cur = f(latest, addDays(latest, 6));
    const base = f(trailing[0], addDays(trailing[trailing.length - 1], 6));
    if (r.metric === "bounce_rate") {
      if (cur.total < (r.min_sessions ?? 1000)) continue;
      const d = (rates(cur).bounce_rate ?? 0) - (rates(base).bounce_rate ?? 0);
      const ci = newcombeDiff(base.bounces, base.total, cur.bounces, cur.total);
      if (d * 100 > (r.threshold_pp ?? 3) && ci && ci[0] > 0)
        fired.push({
          id: `${r.id}:${latest}`,
          rule: r.id,
          severity: "warning",
          message: `${r.label}: ${(rates(cur).bounce_rate! * 100).toFixed(1)}% in week of ${latest} vs ${(rates(base).bounce_rate! * 100).toFixed(1)}% trailing (${(d * 100).toFixed(1)} pp, 95% CI ${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)} pp)`,
          sample: `n=${cur.total.toLocaleString()} sessions vs ${base.total.toLocaleString()}`,
          panel: r.panel,
        });
    } else if (r.metric === "nonbounce_cr") {
      if (!cur.orders_known || cur.orders < (r.min_orders ?? 20)) continue;
      const d = (rates(cur).nonbounce_cr ?? 0) - (rates(base).nonbounce_cr ?? 0);
      const ci = newcombeDiff(base.orders, base.nb, cur.orders, cur.nb);
      if (-d * 100 > (r.threshold_pp ?? 0.15) && ci && ci[1] < 0)
        fired.push({
          id: `${r.id}:${latest}`,
          rule: r.id,
          severity: "warning",
          message: `${r.label}: ${(rates(cur).nonbounce_cr! * 100).toFixed(3)}% vs ${(rates(base).nonbounce_cr! * 100).toFixed(3)}% trailing`,
          sample: `${cur.orders} orders / ${cur.nb.toLocaleString()} non-bounce sessions`,
          panel: r.panel,
        });
    }
  }
  if (rules.some((r) => r.metric === "release")) {
    for (const rel of releases)
      for (const i of rel.impacts)
        if (i.verdict === "moved opposite" && i.post.days >= 7)
          fired.push({
            id: `release_wrong_way:${rel.id}:${i.scope}`,
            rule: "release_wrong_way",
            severity: "info",
            message: `${rel.repo} ${rel.release_id} (${rel.bangkok_date}): ${rel.metric.label} moved opposite to expected on ${i.scope} (change vs baseline, not causal)`,
            sample: `n=${i.baseline.n.toLocaleString()} → ${i.post.n.toLocaleString()}`,
            panel: "releases",
          });
  }
  return fired;
}
