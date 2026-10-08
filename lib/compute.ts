// Pure, browser-safe computations over cached aggregates. Shared by the dashboard, the report and tests.
import { confidence, Confidence, lmdi, Market, MIN_ORDERS, MIN_SESSIONS, PlatformFilter, revenueAtStake, wilson } from "@/server/metrics/definitions";

export type Device = "desktop" | "mobile" | "app" | "unknown";
export type PlatformKey = "web" | "ios" | "android" | "unknown";

/** One cached aggregate row: Bangkok day x platform x device x market. */
export interface DailyRow {
  day: string;
  platform: PlatformKey;
  device: Device;
  market: Market;
  total: number;
  bounces: number;
  nb: number;
  s_orders: number | null; // session-attributed gross_orders (dataset 63)
  s_revenue: number | null;
  e_orders: number | null; // backend eligible orders by order date (dataset 33)
  e_revenue: number | null;
}

export type OrdersSource = "backend" | "session";

export interface Agg {
  total: number;
  bounces: number;
  nb: number;
  orders: number;
  revenue: number;
  days: number;
  orders_known: boolean;
}

export interface Filter {
  from: string;
  to: string; // inclusive
  platform: PlatformFilter | "all";
  markets: Market[];
  device: Device | "all";
}

export function inPlatformKey(p: PlatformKey, f: PlatformFilter | "all") {
  if (f === "all") return p !== "unknown";
  if (f === "app") return p === "ios" || p === "android";
  return p === f;
}

export function filterRows(rows: DailyRow[], f: Filter) {
  return rows.filter(
    (r) => r.day >= f.from && r.day <= f.to && inPlatformKey(r.platform, f.platform) && f.markets.includes(r.market) && (f.device === "all" || r.device === f.device),
  );
}

export function aggregate(rows: DailyRow[], src: OrdersSource): Agg {
  const days = new Set<string>();
  let total = 0,
    bounces = 0,
    nb = 0,
    orders = 0,
    revenue = 0,
    known = false;
  for (const r of rows) {
    days.add(r.day);
    total += r.total;
    bounces += r.bounces;
    nb += r.nb;
    const o = src === "backend" ? r.e_orders : r.s_orders;
    const rev = src === "backend" ? r.e_revenue : r.s_revenue;
    if (o != null) {
      known = true;
      orders += o;
    }
    revenue += rev ?? 0;
  }
  return { total, bounces, nb, orders, revenue, days: days.size, orders_known: known };
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export function rates(a: Agg) {
  return {
    bounce_rate: ratio(a.bounces, a.total),
    nonbounce_cr: a.orders_known ? ratio(a.orders, a.nb) : null,
    aov: a.orders_known ? ratio(a.revenue, a.orders) : null,
    rev_per_nb: a.orders_known ? ratio(a.revenue, a.nb) : null,
    rev_per_session: a.orders_known ? ratio(a.revenue, a.total) : null,
    low_sessions: a.total < MIN_SESSIONS,
    low_orders: a.orders < MIN_ORDERS,
  };
}

// ---------- date-time ranges (From/To with hour precision, Asia/Bangkok) ----------
export interface HourlyRow extends DailyRow {
  hour: number; // 0-23, Bangkok local hour of session start / order time
}

/** "YYYY-MM-DDTHH:mm" (Bangkok) → { day, hour }. Minutes snap down to the hour (data is hourly). */
export function parseLocal(dt: string): { day: string; hour: number } {
  const [day, time = "00:00"] = dt.split("T");
  return { day, hour: Math.min(23, Math.max(0, Number(time.slice(0, 2)) || 0)) };
}

export interface ResolvedRange {
  rows: DailyRow[]; // day-grain rows covering exactly [from, to]; partial days are built from hourly rows
  from: string; // first day
  to: string; // last day (inclusive)
  partialDays: { day: string; fromHour: number; toHour: number; precision: "hour" | "rounded-to-day"; orders: "hour" | "unavailable" }[];
  /** true when a partial day has hourly sessions but no hourly orders: order-based rates are not shown. */
  ordersUnavailable: boolean;
}

/**
 * Resolve an hour-precise From/To (inclusive of the To hour) into day-grain rows.
 * Whole days use daily totals; a partial first/last day is summed from hourly rows for the chosen hours.
 * If hourly rows are missing for a partial day, the whole day is used and the day is flagged "rounded-to-day".
 */
export function resolveRange(daily: DailyRow[], hourly: HourlyRow[], fromDT: string, toDT: string): ResolvedRange {
  const a = parseLocal(fromDT);
  const b = parseLocal(toDT);
  const partialDays: ResolvedRange["partialDays"] = [];
  const out: DailyRow[] = [];
  const hourlyDays = new Set(hourly.map((h) => h.day));
  for (let d = a.day; d <= b.day; d = addDays(d, 1)) {
    const fromHour = d === a.day ? a.hour : 0;
    const toHour = d === b.day ? b.hour : 23;
    if (fromHour === 0 && toHour === 23) {
      for (const r of daily) if (r.day === d) out.push(r);
      continue;
    }
    if (!hourlyDays.has(d)) {
      partialDays.push({ day: d, fromHour, toHour, precision: "rounded-to-day", orders: "hour" });
      for (const r of daily) if (r.day === d) out.push(r);
      continue;
    }
    const dayHours = hourly.filter((h) => h.day === d);
    const hasHourlyOrders = dayHours.some((h) => h.e_orders != null || h.s_orders != null);
    partialDays.push({ day: d, fromHour, toHour, precision: "hour", orders: hasHourlyOrders ? "hour" : "unavailable" });
    const acc = new Map<string, DailyRow>();
    for (const h of hourly) {
      if (h.day !== d || h.hour < fromHour || h.hour > toHour) continue;
      const k = `${h.platform}|${h.device}|${h.market}`;
      const x = acc.get(k) ?? { day: d, platform: h.platform, device: h.device, market: h.market, total: 0, bounces: 0, nb: 0, s_orders: null, s_revenue: null, e_orders: null, e_revenue: null };
      x.total += h.total;
      x.bounces += h.bounces;
      x.nb += h.nb;
      const add = (p: number | null, q: number | null) => (q == null ? p : (p ?? 0) + q);
      x.s_orders = add(x.s_orders, h.s_orders);
      x.s_revenue = add(x.s_revenue, h.s_revenue);
      x.e_orders = add(x.e_orders, h.e_orders);
      x.e_revenue = add(x.e_revenue, h.e_revenue);
      acc.set(k, x);
    }
    out.push(...acc.values());
  }
  return { rows: out, from: a.day, to: b.day, partialDays, ordersUnavailable: partialDays.some((p) => p.orders === "unavailable") };
}

/** Same-length comparison window immediately before [from, to], to the hour. */
export function priorWindow(fromDT: string, toDT: string) {
  const ms = (dt: string) => {
    const { day, hour } = parseLocal(dt);
    return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`).getTime();
  };
  const len = ms(toDT) - ms(fromDT) + 3600_000;
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 16);
  return { from: fmt(ms(fromDT) - len), to: fmt(ms(toDT) - len) };
}

// ---------- dates (Bangkok business dates as YYYY-MM-DD strings) ----------
export const addDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
export function mondayOf(d: string) {
  const dow = new Date(d + "T00:00:00Z").getUTCDay(); // 0 Sun
  return addDays(d, -((dow + 6) % 7));
}

/** Complete Mon–Sun weeks fully covered by data and ended before `today`. */
export function completeWeeks(days: string[], today: string): string[] {
  if (!days.length) return [];
  const set = new Set(days);
  const out: string[] = [];
  for (let w = mondayOf(days[0]); addDays(w, 6) < today; w = addDays(w, 7)) {
    let ok = true;
    for (let i = 0; i < 7; i++) if (!set.has(addDays(w, i))) ok = false;
    if (ok) out.push(w);
  }
  return out;
}

/** Window is immature if it is not complete or ended less than 7 days ago (current-status filtering lets orders cancel later). */
export function windowImmature(to: string, today: string) {
  return daysBetween(to, today) <= 7;
}

export type Preset = "today" | "last7" | "lastweek" | "custom";
export function presetRange(p: Preset, today: string, latestDay: string, weeks: string[]) {
  if (p === "today") return { from: latestDay, to: latestDay, cfrom: addDays(latestDay, -7), cto: addDays(latestDay, -7) };
  if (p === "last7") {
    const to = addDays(today, -1) <= latestDay ? addDays(today, -1) : latestDay;
    return { from: addDays(to, -6), to, cfrom: addDays(to, -13), cto: addDays(to, -7) };
  }
  const w = weeks[weeks.length - 1];
  return { from: w, to: addDays(w, 6), cfrom: addDays(w, -7), cto: addDays(w, -1) };
}

// ---------- D2 opportunities ----------
export interface Opportunity {
  key: string;
  label: string;
  kind: "segment" | "funnel" | "section";
  sessions: number;
  current: number | null;
  benchmark: number | null;
  benchLabel: string;
  recoverable: number;
  ras: number;
  conf: Confidence;
  hypothesis: string;
  metric: string;
  evidenced: boolean;
}

const HYP: Record<string, [string, string]> = {
  mobile: ["Mobile web landing experience (speed, above-the-fold relevance) loses visitors before a second page", "Web Mobile bounce rate ↓ (same market)"],
  desktop: ["Desktop landing pages not matching campaign intent", "Web Desktop bounce rate ↓ (same market)"],
};

export type Benchmark = "app" | "peer" | "trailing";

/**
 * Web segments (market x device) ranked by weekly revenue at stake.
 * revenue_at_stake = total_sessions * max(bounce - benchmark, 0) * segment non-bounce CR * AOV, scaled to 7 days.
 */
export function webOpportunities(rows: DailyRow[], f: Filter, bench: Benchmark, src: OrdersSource): Opportunity[] {
  const scale = (days: number) => (days > 0 ? 7 / days : 0);
  const webAll = aggregate(filterRows(rows, { ...f, platform: "web", device: "all" }), src);
  const scopeRates = rates(webAll);
  const aov = scopeRates.aov ?? 0;
  const out: Opportunity[] = [];
  for (const m of f.markets) {
    for (const dev of ["mobile", "desktop"] as const) {
      const seg = aggregate(filterRows(rows, { ...f, platform: "web", markets: [m], device: dev }), src);
      if (!seg.total) continue;
      const r = rates(seg);
      let benchmark: number | null = null;
      let benchLabel = "";
      if (bench === "app") {
        benchmark = rates(aggregate(filterRows(rows, { ...f, platform: "app", markets: [m], device: "all" }), src)).bounce_rate;
        benchLabel = `App (iOS + Android), ${m}`;
      } else if (bench === "peer") {
        const other = dev === "mobile" ? "desktop" : "mobile";
        benchmark = rates(aggregate(filterRows(rows, { ...f, platform: "web", markets: [m], device: other }), src)).bounce_rate;
        benchLabel = `Web ${other}, ${m}`;
      } else {
        const best: number[] = [];
        for (let k = 1; k <= 4; k++) {
          const a = aggregate(filterRows(rows, { ...f, from: addDays(f.from, -7 * k), to: addDays(f.to, -7 * k), platform: "web", markets: [m], device: dev }), src);
          const br = rates(a).bounce_rate;
          if (br != null && a.total >= MIN_SESSIONS) best.push(br);
        }
        benchmark = best.length ? Math.min(...best) : null;
        benchLabel = `Own best of trailing ${best.length} periods`;
      }
      const cr = !r.low_orders && r.nonbounce_cr != null ? r.nonbounce_cr : scopeRates.nonbounce_cr ?? 0;
      const ras = benchmark == null || r.bounce_rate == null ? null : revenueAtStake({ total_sessions: seg.total, bounce_rate: r.bounce_rate, benchmark_bounce_rate: benchmark, nonbounce_cr: cr, aov });
      out.push({
        key: `seg-${m}-${dev}`,
        label: `${m} · Web ${dev} bounce`,
        kind: "segment",
        sessions: seg.total,
        current: r.bounce_rate,
        benchmark,
        benchLabel,
        recoverable: (ras?.recoverable_sessions ?? 0) * scale(seg.days),
        ras: (ras?.revenue_at_stake ?? 0) * scale(seg.days),
        conf: benchmark == null ? "Low" : confidence(seg.bounces, seg.total),
        hypothesis: HYP[dev][0],
        metric: HYP[dev][1],
        evidenced: benchmark != null,
      });
    }
  }
  return out;
}

export interface FunnelStage {
  stage: string;
  stage_order: number;
  sessions: number;
}

/** Funnel step losses: web step rate vs App step rate (same weeks). */
export function funnelOpportunities(web: FunnelStage[], app: FunnelStage[], ordersPerLastStage: number, aov: number, weeks: number): Opportunity[] {
  const out: Opportunity[] = [];
  const w = [...web].sort((a, b) => a.stage_order - b.stage_order);
  const a = new Map(app.map((s) => [s.stage, s.sessions]));
  for (let i = 1; i < w.length; i++) {
    const from = w[i - 1];
    const to = w[i];
    const af = a.get(from.stage);
    const at = a.get(to.stage);
    if (!from.sessions || af == null || at == null || !af) continue;
    const rw = to.sessions / from.sessions;
    const ra = at / af;
    const lost = from.sessions * Math.max(ra - rw, 0);
    const downstream = to.sessions ? ordersPerLastStage / to.sessions : 0;
    out.push({
      key: `fun-${from.stage}-${to.stage}`,
      label: `${from.stage} → ${to.stage}`,
      kind: "funnel",
      sessions: from.sessions,
      current: rw,
      benchmark: ra,
      benchLabel: "App step rate",
      recoverable: lost / Math.max(1, weeks),
      ras: (lost * Math.min(1, downstream) * aov) / Math.max(1, weeks),
      conf: confidence(from.sessions - to.sessions, from.sessions),
      hypothesis: `Friction between ${from.stage} and ${to.stage} on web vs app`,
      metric: `${from.stage}→${to.stage} rate ↑`,
      evidenced: true,
    });
  }
  return out;
}

/** Low-confidence and unevidenced items are never ranked above evidenced ones. */
export function rankOpportunities(xs: Opportunity[]) {
  return [...xs].sort((x, y) => Number(x.conf === "Low" || !x.evidenced) - Number(y.conf === "Low" || !y.evidenced) || y.ras - x.ras);
}

// ---------- D3 decomposition ----------
export function revenueDecomposition(a: Agg, b: Agg) {
  if (!a.nb || !b.nb || !a.orders || !b.orders || !a.revenue || !b.revenue) return null;
  return lmdi({ sessions: a.nb, orders: a.orders, revenue: a.revenue }, { sessions: b.nb, orders: b.orders, revenue: b.revenue });
}

export function rateCi(x: number, n: number) {
  return wilson(x, n);
}

// ---------- formatting ----------
export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtPct = (n: number | null | undefined, dp = 2) => (n == null ? "—" : `${(n * 100).toFixed(dp)}%`);
export const fmtUsd = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const fmtPp = (n: number | null | undefined, dp = 2) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(dp)} pp`);
export function fmtDate(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
export function fmtRange(a: string, b: string) {
  return a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`;
}
