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

// ---------- CEO depth: metric registry, series, segment decomposition ----------
export type MetricKey = "total" | "bounce_rate" | "nb" | "nonbounce_cr" | "orders" | "aov" | "revenue" | "rev_per_nb";

export interface MetricDef {
  key: MetricKey;
  label: string;
  kind: "count" | "rate" | "money" | "moneyRatio";
  good: "up" | "down";
  /** numerator / denominator of the metric (count metrics: den = null) */
  num: (a: Agg) => number;
  den: (a: Agg) => number | null;
  numLabel: string;
  denLabel: string | null;
  needsOrders: boolean;
  fmt: (v: number | null) => string;
  /** format a change in this metric */
  fmtDelta: (d: number | null) => string;
}

const ppDelta = (d: number | null, dp = 2) => (d == null ? "—" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(dp)} pp`);
const signed = (d: number | null, f: (n: number) => string) => (d == null ? "—" : `${d >= 0 ? "+" : "−"}${f(Math.abs(d))}`);

export const METRICS: Record<MetricKey, MetricDef> = {
  total: { key: "total", label: "Total sessions", kind: "count", good: "up", num: (a) => a.total, den: () => null, numLabel: "sessions", denLabel: null, needsOrders: false, fmt: (v) => fmtInt(v), fmtDelta: (d) => signed(d, (n) => fmtInt(n)) },
  bounce_rate: { key: "bounce_rate", label: "Bounce rate", kind: "rate", good: "down", num: (a) => a.bounces, den: (a) => a.total, numLabel: "bounced sessions", denLabel: "total sessions", needsOrders: false, fmt: (v) => fmtPct(v, 1), fmtDelta: (d) => ppDelta(d, 2) },
  nb: { key: "nb", label: "Non-bounce sessions", kind: "count", good: "up", num: (a) => a.nb, den: () => null, numLabel: "non-bounce sessions", denLabel: null, needsOrders: false, fmt: (v) => fmtInt(v), fmtDelta: (d) => signed(d, (n) => fmtInt(n)) },
  nonbounce_cr: { key: "nonbounce_cr", label: "Non-bounce CR", kind: "rate", good: "up", num: (a) => a.orders, den: (a) => a.nb, numLabel: "orders", denLabel: "non-bounce sessions", needsOrders: true, fmt: (v) => fmtPct(v, 3), fmtDelta: (d) => ppDelta(d, 3) },
  orders: { key: "orders", label: "Orders", kind: "count", good: "up", num: (a) => a.orders, den: () => null, numLabel: "orders", denLabel: null, needsOrders: true, fmt: (v) => fmtInt(v), fmtDelta: (d) => signed(d, (n) => fmtInt(n)) },
  aov: { key: "aov", label: "AOV", kind: "moneyRatio", good: "up", num: (a) => a.revenue, den: (a) => a.orders, numLabel: "booked revenue (USD)", denLabel: "orders", needsOrders: true, fmt: (v) => fmtUsd(v, 2), fmtDelta: (d) => signed(d, (n) => fmtUsd(n, 2)) },
  revenue: { key: "revenue", label: "Booked revenue", kind: "money", good: "up", num: (a) => a.revenue, den: () => null, numLabel: "booked revenue (USD)", denLabel: null, needsOrders: true, fmt: (v) => fmtUsd(v), fmtDelta: (d) => signed(d, (n) => fmtUsd(n)) },
  rev_per_nb: { key: "rev_per_nb", label: "Revenue / non-bounce session", kind: "moneyRatio", good: "up", num: (a) => a.revenue, den: (a) => a.nb, numLabel: "booked revenue (USD)", denLabel: "non-bounce sessions", needsOrders: true, fmt: (v) => fmtUsd(v, 3), fmtDelta: (d) => signed(d, (n) => fmtUsd(n, 3)) },
};
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function metricValue(m: MetricDef, a: Agg): number | null {
  if (m.needsOrders && !a.orders_known) return null;
  const d = m.den(a);
  if (d === null) return m.num(a);
  return d > 0 ? m.num(a) / d : null;
}

/** 95% interval for the metric value: Wilson for rates, day-bootstrap for money ratios, none for counts. */
export function metricCi(m: MetricDef, a: Agg, days: Agg[]): [number, number] | null {
  if (m.needsOrders && !a.orders_known) return null;
  if (m.kind === "rate") return wilson(m.num(a), m.den(a) ?? 0);
  if (m.kind === "moneyRatio") {
    const pts = days.map((d) => ({ num: m.num(d), den: m.den(d) ?? 0 })).filter((p) => p.den > 0);
    if (pts.length < 3) return null;
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const vals: number[] = [];
    for (let i = 0; i < 1000; i++) {
      let n = 0,
        dd = 0;
      for (let j = 0; j < pts.length; j++) {
        const p = pts[Math.floor(rnd() * pts.length)];
        n += p.num;
        dd += p.den;
      }
      if (dd > 0) vals.push(n / dd);
    }
    vals.sort((x, y) => x - y);
    return [vals[Math.floor(vals.length * 0.025)], vals[Math.floor(vals.length * 0.975)]];
  }
  return null;
}

export interface SeriesPoint {
  t: string; // day "YYYY-MM-DD" or hour "YYYY-MM-DDTHH"
  agg: Agg;
  value: number | null;
  ci: [number, number] | null;
}

/** Daily series (or hourly when `hourly` rows are passed) for one platform scope. */
export function metricSeries(m: MetricDef, rows: DailyRow[], f: Filter, src: OrdersSource, hourly?: HourlyRow[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  if (hourly) {
    const hs = hourly.filter((r) => r.day >= f.from && r.day <= f.to && inPlatformKey(r.platform, f.platform) && f.markets.includes(r.market) && (f.device === "all" || r.device === f.device));
    const key = (h: HourlyRow) => `${h.day}T${String(h.hour).padStart(2, "0")}`;
    for (const k of [...new Set(hs.map(key))].sort()) {
      const a = aggregate(hs.filter((h) => key(h) === k), src);
      out.push({ t: k, agg: a, value: metricValue(m, a), ci: metricCi(m, a, []) });
    }
    return out;
  }
  for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
    const a = aggregate(filterRows(rows, { ...f, from: d, to: d }), src);
    if (!a.days) continue;
    out.push({ t: d, agg: a, value: metricValue(m, a), ci: metricCi(m, a, []) });
  }
  return out;
}

export interface Segment {
  key: string;
  label: string;
  market: Market;
  platform: "web" | "ios" | "android";
  device: Device | "all";
}

/** Market × (Web mobile, Web desktop, iOS, Android) segments inside the platform filter. */
export function segmentsFor(platform: PlatformFilter | "all", markets: Market[], webDevice: Device | "all" = "all"): Segment[] {
  const parts: { platform: Segment["platform"]; device: Segment["device"]; name: string }[] = [];
  if (platform === "web" || platform === "all") {
    if (webDevice === "all" || webDevice === "mobile") parts.push({ platform: "web", device: "mobile", name: "Web mobile" });
    if (webDevice === "all" || webDevice === "desktop") parts.push({ platform: "web", device: "desktop", name: "Web desktop" });
  }
  if (platform === "app" || platform === "ios" || platform === "all") parts.push({ platform: "ios", device: "all", name: "iOS" });
  if (platform === "app" || platform === "android" || platform === "all") parts.push({ platform: "android", device: "all", name: "Android" });
  return markets.flatMap((m) => parts.map((p) => ({ key: `${m}|${p.platform}|${p.device}`, label: `${m} · ${p.name}`, market: m, platform: p.platform, device: p.device })));
}

export function segmentAgg(rows: DailyRow[], s: Segment, from: string, to: string, src: OrdersSource) {
  return aggregate(filterRows(rows, { from, to, platform: s.platform, markets: [s.market], device: s.device }), src);
}

export interface Contribution {
  key: string;
  label: string;
  a: { num: number; den: number | null; value: number | null; share: number | null };
  b: { num: number; den: number | null; value: number | null; share: number | null };
  mix: number; // ratio metrics: effect of the segment's share of the denominator changing
  rate: number; // ratio metrics: effect of the segment's own rate changing
  total: number; // contribution to the headline change; contributions sum exactly to it
}

/**
 * Exact decomposition of a metric's change across segments.
 * Counts/money: contribution = the segment's own change. Ratio metrics (R = Σ wᵢrᵢ, wᵢ = denᵢ/Σden):
 * ΔR = Σ Δwᵢ·r̄ᵢ (mix) + Σ w̄ᵢ·Δrᵢ (rate), midpoint weights, so the parts sum exactly to ΔR.
 */
export function decomposeChange(m: MetricDef, segs: { key: string; label: string; a: Agg; b: Agg }[]) {
  if (m.kind === "count" || m.kind === "money") {
    const contributions: Contribution[] = segs.map((s) => {
      const va = m.num(s.a);
      const vb = m.num(s.b);
      return { key: s.key, label: s.label, a: { num: va, den: null, value: va, share: null }, b: { num: vb, den: null, value: vb, share: null }, mix: 0, rate: 0, total: vb - va };
    });
    return { contributions, total: contributions.reduce((x, c) => x + c.total, 0), mix: 0, rate: 0 };
  }
  const denA = segs.reduce((x, s) => x + (m.den(s.a) ?? 0), 0);
  const denB = segs.reduce((x, s) => x + (m.den(s.b) ?? 0), 0);
  const contributions: Contribution[] = [];
  for (const s of segs) {
    const da = m.den(s.a) ?? 0;
    const db = m.den(s.b) ?? 0;
    if (!da && !db) continue;
    const wa = denA ? da / denA : 0;
    const wb = denB ? db / denB : 0;
    const ra0 = da ? m.num(s.a) / da : null;
    const rb0 = db ? m.num(s.b) / db : null;
    const ra = ra0 ?? (rb0 as number);
    const rb = rb0 ?? (ra0 as number);
    const mix = (wb - wa) * ((ra + rb) / 2);
    const rate = ((wa + wb) / 2) * (rb - ra);
    contributions.push({
      key: s.key,
      label: s.label,
      a: { num: m.num(s.a), den: da, value: ra0, share: wa },
      b: { num: m.num(s.b), den: db, value: rb0, share: wb },
      mix,
      rate,
      total: mix + rate,
    });
  }
  const mix = contributions.reduce((x, c) => x + c.mix, 0);
  const rate = contributions.reduce((x, c) => x + c.rate, 0);
  return { contributions, total: mix + rate, mix, rate };
}

/** Neutral sentence describing a decomposition (no causal claims). */
export function describeChange(m: MetricDef, d: ReturnType<typeof decomposeChange>): string {
  if (!d.contributions.length || d.total === 0) return `${m.label} did not change between the two periods.`;
  const byMag = [...d.contributions].sort((x, y) => Math.abs(y.total) - Math.abs(x.total));
  const same = byMag.filter((c) => Math.sign(c.total) === Math.sign(d.total)).slice(0, 2);
  const against = byMag.find((c) => Math.sign(c.total) === -Math.sign(d.total) && c.total !== 0);
  const lead = same.map((c) => `${c.label} ${m.fmtDelta(c.total)}`).join(" and ");
  const offset = against ? `, partly offset by ${against.label} ${m.fmtDelta(against.total)}` : "";
  const mr = m.kind === "rate" || m.kind === "moneyRatio" ? ` Of the ${m.fmtDelta(d.total)}, ${m.fmtDelta(d.mix)} comes from the traffic mix shifting between segments and ${m.fmtDelta(d.rate)} from rates changing within segments.` : "";
  return `${m.label} changed ${m.fmtDelta(d.total)}. Biggest contributors: ${lead}${offset}.${mr}`;
}
