// CEO weekly view: orchestration and plain-English copy only. Every number comes from
// aggregate/filterRows/METRICS/metricValue (lib/compute.ts), newcombeDiff (server/metrics/definitions.ts)
// and scoreReleases (lib/release-sections.ts) — nothing here recomputes a metric formula.
import { addDays, Agg, aggregate, DailyRow, filterRows, fmtDate, fmtInt, fmtPct, fmtRange, fmtUsd, METRICS, MetricKey, metricValue, mondayOf, OrdersSource } from "@/lib/compute";
import { releaseFeatures } from "@/lib/features";
import { scoreReleases, SCORE_PLATS, ScorePlat, ScoreRow } from "@/lib/release-sections";
import { Market, MARKETS, newcombeDiff } from "@/server/metrics/definitions";

export type CeoChannel = "all" | "web" | "app";
export type CeoMarket = "all" | Market;

/** Presentational label only (distinct from the analyst MARKETS[].label "Global USD"). */
export const CEO_MARKET_LABEL: Record<Market, string> = { TH: "Thailand", SG: "Singapore", HK: "Hong Kong", GL: "Global (USD site)", AU: "Australia" };
const ALL_MARKETS = MARKETS.map((m) => m.id) as Market[];

export interface PartialWeek {
  week: string;
  daysIn: number;
}

/** Complete weeks (api.data.calendar.weeks) plus the trailing partial week, if the latest day starts a new one. */
export function ceoWeeks(weeks: string[], days: string[]): { weeks: string[]; partial: PartialWeek | null } {
  if (!days.length) return { weeks, partial: null };
  const lastComplete = weeks[weeks.length - 1] ?? null;
  const latestDay = [...days].sort().at(-1)!;
  const curMonday = mondayOf(latestDay);
  if (lastComplete && curMonday <= lastComplete) return { weeks, partial: null };
  const set = new Set(days);
  let daysIn = 0;
  for (let i = 0; i < 7; i++) if (set.has(addDays(curMonday, i))) daysIn++;
  return { weeks, partial: daysIn ? { week: curMonday, daysIn } : null };
}

/** One week's Agg for a channel + market scope (the trailing weekly series the sparkline/trend chart show). */
export function weekAgg(rows: DailyRow[], week: string, channel: CeoChannel, markets: Market[], src: OrdersSource): Agg {
  return aggregate(filterRows(rows, { from: week, to: addDays(week, 6), platform: channel, markets, device: "all" }), src);
}

/** Agg for a channel + market scope over rows already date-scoped by the caller (e.g. props.cur.rows/props.cmp.rows, the same ResolvedRange every other panel uses). */
export function rangeAgg(rows: DailyRow[], channel: CeoChannel, markets: Market[], src: OrdersSource): Agg {
  return aggregate(filterRows(rows, { from: "0000-01-01", to: "9999-12-31", platform: channel, markets, device: "all" }), src);
}

/** The selected period, for copy: a clean calendar week, or an arbitrary date range from the full picker. */
export type CeoPeriod = { kind: "week"; week: string } | { kind: "range"; from: string; to: string };

/** "Real" per the spec: the 95% Newcombe interval of the change excludes zero. */
export function ceoRealChange(aNum: number, aDen: number, bNum: number, bDen: number): { diff: number | null; halfWidth: number | null; real: boolean } {
  if (!aDen || !bDen) return { diff: null, halfWidth: null, real: false };
  const ci = newcombeDiff(aNum, aDen, bNum, bDen);
  if (!ci) return { diff: null, halfWidth: null, real: false };
  return { diff: bNum / bDen - aNum / aDen, halfWidth: (ci[1] - ci[0]) / 2, real: ci[0] > 0 || ci[1] < 0 };
}

export interface VerdictInput {
  channel: CeoChannel;
  market: CeoMarket;
  period: CeoPeriod;
  cur: Agg;
  prev: Agg | null;
  /** the selected period itself is still in progress (only possible for period.kind === "week"): totals aren't compared, rates still are */
  isPartial: boolean;
}

/** The two-line plain-English verdict at the top of the CEO view. */
export function ceoVerdict(v: VerdictInput): [string, string] {
  const isWeek = v.period.kind === "week";
  const comparisonNoun = isWeek ? "the week before" : "the previous period";
  const channelPhrase = v.channel === "all" ? "Across the website and app" : v.channel === "web" ? "On the website" : "On the app";
  const marketPhrase = v.market === "all" ? "" : ` in ${CEO_MARKET_LABEL[v.market]}`;
  const periodPhrase = v.period.kind === "week" ? `the week of ${fmtDate(v.period.week)}` : fmtRange(v.period.from, v.period.to);
  const sales = fmtUsd(metricValue(METRICS.revenue, v.cur), 2); // the CEO view shows exact cents for sales; the analyst Kpis tile rounds to whole dollars
  const orders = fmtInt(v.cur.orders);
  let salesClause = "";
  if (!v.isPartial && v.prev && v.prev.revenue) {
    const rel = (v.cur.revenue - v.prev.revenue) / v.prev.revenue;
    salesClause = `, sales ${rel >= 0 ? "up" : "down"} ${Math.abs(rel * 100).toFixed(1)}% on ${comparisonNoun}`;
  }
  const line1 = `${channelPhrase}${marketPhrase}, ${periodPhrase} brought ${sales} in sales from ${orders} orders${salesClause}.`;

  const convVal = metricValue(METRICS.nonbounce_cr, v.cur);
  const convTxt = METRICS.nonbounce_cr.fmt(convVal);
  let convClause = "";
  if (v.prev) {
    const r = ceoRealChange(v.prev.orders, v.prev.nb, v.cur.orders, v.cur.nb);
    if (r.diff != null && r.halfWidth != null) {
      const verdict = r.real ? (r.diff > 0 ? "a real rise" : "a real drop") : "within normal ups and downs";
      convClause = ` (±${(r.halfWidth * 100).toFixed(2)} pts, ${verdict})`;
    }
  }
  const bounceVal = metricValue(METRICS.bounce_rate, v.cur);
  const bounceTxt = METRICS.bounce_rate.fmt(bounceVal);
  let bounceClause = "";
  if (v.prev) {
    const r = ceoRealChange(v.prev.bounces, v.prev.total, v.cur.bounces, v.cur.total);
    if (r.real && r.diff != null) bounceClause = r.diff > 0 ? `, more than ${comparisonNoun}` : `, fewer than ${comparisonNoun}`;
  }
  const line2 = `Conversion was ${convTxt}${convClause}, and ${bounceTxt} of visits bounced${bounceClause}.`;
  return [line1, line2];
}

export type ChangeTone = "good" | "bad" | "flat" | "muted";
export interface TileChange {
  text: string;
  tone: ChangeTone;
}
export interface ScorecardTile {
  key: MetricKey;
  label: string;
  value: string;
  change: TileChange;
  definition: string;
  spark: (number | null)[];
}

const TILE_KEYS: MetricKey[] = ["revenue", "orders", "nonbounce_cr", "total", "bounce_rate"];
export const TILE_LABEL: Record<MetricKey, string> = { revenue: "Sales", orders: "Orders", nonbounce_cr: "Conversion", total: "Visits", bounce_rate: "Bounce rate", nb: "Non-bounce sessions", aov: "AOV", rev_per_nb: "Revenue / non-bounce session" };
export const TILE_DEF: Record<MetricKey, string> = {
  revenue: "Booked revenue from orders placed this week, in US dollars.",
  orders: "The number of eligible orders placed this week.",
  nonbounce_cr: "Orders divided by non-bounce sessions — how often a visit that stuck around turned into a sale.",
  total: "Total sessions across the website and app this week.",
  bounce_rate: "The share of sessions that left after one page with no engagement. Lower is better.",
  nb: "",
  aov: "",
  rev_per_nb: "",
};

/** The 5 scorecard tiles. `series` is one Agg per week (same order as the trend chart), for the sparkline. */
export function ceoScorecard(cur: Agg, prev: Agg | null, isPartial: boolean, noPriorData: boolean, series: Agg[], isWeekMode = true): ScorecardTile[] {
  const noPriorMsg = isWeekMode ? "No week before to compare" : "No earlier period to compare";
  return TILE_KEYS.map((key) => {
    const m = METRICS[key];
    const spark = series.map((a) => metricValue(m, a));
    let change: TileChange;
    if (m.kind === "rate") {
      if (!prev) {
        change = { text: noPriorData ? noPriorMsg : "no comparison", tone: "muted" };
      } else {
        const r = ceoRealChange(m.num(prev), m.den(prev) ?? 0, m.num(cur), m.den(cur) ?? 0);
        if (r.diff == null) {
          change = { text: "no comparison", tone: "muted" };
        } else {
          const pts = `${r.diff >= 0 ? "+" : "−"}${Math.abs(r.diff * 100).toFixed(2)} pts`;
          const better = m.good === "up" ? r.diff > 0 : r.diff < 0;
          change = r.real ? { text: pts, tone: better ? "good" : "bad" } : { text: `${pts} · normal ups and downs`, tone: "flat" };
        }
      }
    } else if (isPartial) {
      change = { text: "Week in progress", tone: "muted" };
    } else if (!prev) {
      change = { text: noPriorData ? noPriorMsg : "no comparison", tone: "muted" };
    } else {
      const va = metricValue(m, prev);
      const vb = metricValue(m, cur);
      if (va == null || vb == null || va === 0) {
        change = { text: "no comparison", tone: "muted" };
      } else {
        const rel = (vb - va) / va;
        const better = m.good === "up" ? rel > 0 : rel < 0;
        change = { text: `${rel >= 0 ? "+" : "−"}${Math.abs(rel * 100).toFixed(1)}%`, tone: rel === 0 ? "flat" : better ? "good" : "bad" };
      }
    }
    const value = key === "revenue" ? fmtUsd(metricValue(m, cur), 2) : m.fmt(metricValue(m, cur));
    return { key, label: TILE_LABEL[key], value, change, definition: TILE_DEF[key], spark };
  });
}

export interface TrendPoint {
  week: string;
  value: number | null;
  agg: Agg;
  partial: boolean;
}

/** One point per week for the selected metric. `weeks`/`series` must be the same length and order. */
export function ceoTrend(weeks: { week: string; partial?: boolean }[], metricKey: MetricKey, series: Agg[]): TrendPoint[] {
  const m = METRICS[metricKey];
  return weeks.map((w, i) => ({ week: w.week, value: metricValue(m, series[i]), agg: series[i], partial: Boolean(w.partial) }));
}

export interface MarketRow {
  market: Market;
  label: string;
  sales: number;
  orders: number;
  ordersDeltaPct: number | null;
  conversion: number | null;
  bounce: number | null;
}

/** By-market breakdown for the selected week + channel, sorted by sales desc. Drops markets with no data. */
export function ceoByMarket(rows: DailyRow[], week: string, channel: CeoChannel, prevWeek: string | null, src: OrdersSource): MarketRow[] {
  return MARKETS.map((mk) => {
    const cur = weekAgg(rows, week, channel, [mk.id], src);
    const prev = prevWeek ? weekAgg(rows, prevWeek, channel, [mk.id], src) : null;
    const ordersDeltaPct = prev && prev.orders ? (cur.orders - prev.orders) / prev.orders : null;
    return { market: mk.id, label: CEO_MARKET_LABEL[mk.id], sales: cur.revenue, orders: cur.orders, ordersDeltaPct, conversion: metricValue(METRICS.nonbounce_cr, cur), bounce: metricValue(METRICS.bounce_rate, cur) };
  })
    .filter((r) => r.sales > 0 || r.orders > 0 || r.bounce != null)
    .sort((a, b) => b.sales - a.sales);
}

export interface FunnelLike {
  week: string;
  platform: "web" | "ios" | "android";
  stage_order: number;
  sessions: number;
}
export interface JourneyStep {
  label: string;
  sessions: number;
}
export interface Journey {
  steps: JourneyStep[];
  /** the funnel weeks (Mondays) summed into `steps`: every week that overlaps the range and has data */
  weeks: string[];
  minWeek: string | null;
}

/** An inclusive day range ("YYYY-MM-DD"). */
export interface DayRange {
  from: string;
  to: string;
}

const JOURNEY_STAGES: { order: number; label: string }[] = [
  { order: 3, label: "Browsed products" },
  { order: 4, label: "Opened a product" },
  { order: 6, label: "Added to bag" },
  { order: 12, label: "Placed an order" },
];

/**
 * Shopping journey (stage_order 3/4/6/12) summed over the channel's platforms and every funnel week that
 * overlaps `range` (funnel data is weekly, so a range is widened to whole weeks). Not split by market.
 */
export function ceoJourney(funnel: FunnelLike[], range: DayRange, channel: CeoChannel): Journey {
  const plats: FunnelLike["platform"][] = channel === "all" ? ["web", "ios", "android"] : channel === "web" ? ["web"] : ["ios", "android"];
  const byOrder = new Map<number, number>();
  const weeks = new Set<string>();
  for (const r of funnel) {
    if (r.week > range.to || addDays(r.week, 6) < range.from || !plats.includes(r.platform)) continue;
    byOrder.set(r.stage_order, (byOrder.get(r.stage_order) ?? 0) + r.sessions);
    weeks.add(r.week);
  }
  const steps = JOURNEY_STAGES.map((s) => ({ label: s.label, sessions: byOrder.get(s.order) ?? 0 }));
  const minWeek = funnel.length ? [...funnel].map((r) => r.week).sort()[0] : null;
  return { steps, weeks: [...weeks].sort(), minWeek };
}

export type ReleaseVerdict = "Helped" | "Likely helped" | "No clear effect" | "Likely hurt" | "Hurt" | "Can't compare" | "Too early to tell";
export const RELEASE_VERDICTS: ReleaseVerdict[] = ["Helped", "Likely helped", "No clear effect", "Likely hurt", "Hurt", "Can't compare", "Too early to tell"];
const VERDICT_MAP: Record<string, ReleaseVerdict> = {
  better: "Helped",
  "likely better": "Likely helped",
  "no clear change": "No clear effect",
  "likely worse": "Likely hurt",
  worse: "Hurt",
  unreliable: "Can't compare",
  "too early": "Too early to tell",
  "no data": "Too early to tell",
};
const EXCLUDED_LABEL: Record<string, string> = { "incomplete data": "incomplete data", "sale day": "sale", "order spike": "order spike", "traffic spike": "traffic spike" };
const PLAT_LABEL: Record<ScorePlat, string> = { web: "Web", web_mobile: "Web mobile", ios: "iOS", android: "Android" };

export interface ReleaseLike {
  id: string;
  repo: string;
  release_id: string | null;
  platform: string;
  bangkok_date: string;
  go_live_at: string | null;
  prs: { number: number; title: string; dirs: string[] }[];
}
/** Where a release shipped from, in plain words (keyed by the release's platform in config/repos.yml). */
export const RELEASE_SOURCE_LABEL: Record<string, string> = { backend: "API", web: "Website", ios: "iOS app", android: "Android app" };
export const RELEASE_SOURCE_ORDER = ["API", "Website", "iOS app", "Android app"];

export interface ReleaseRowView {
  key: string;
  /** one id per scored release group, shared by its per-platform rows (for counting releases, not rows) */
  releaseKey: string;
  /** production releases in the group (same day + source are scored together) */
  releaseCount: number;
  source: string;
  what: string;
  /** every customer-facing feature in the release, most telling first (empty: behind-the-scenes only) */
  features: string[];
  wentLive: string;
  measuredOn: string;
  result: ReleaseVerdict;
  before: string;
  after: string;
  change: string;
  /** why the result is what it is: unreliable/too-early reason, days left out, other releases sharing the same days */
  notes: string[];
  ids: string[];
  prTitles: string[];
}

/**
 * "Did this period's releases help?" — releases that went live inside `range` (the same selected/compare
 * ranges the analyst Releases tab scores). Always all markets, regardless of the UI market filter.
 */
export function ceoReleases(releases: ReleaseLike[], daily: DailyRow[], range: DayRange, cmp: DayRange): ReleaseRowView[] {
  const scored: ScoreRow<ReleaseLike>[] = scoreReleases(releases, daily, range, cmp, ALL_MARKETS);
  const rows: ReleaseRowView[] = [];
  const rate = (v: number | null, orders: number) => (v == null ? "—" : `${fmtPct(v, 2)} (${fmtInt(orders)} orders)`);
  for (const r of scored) {
    const features = releaseFeatures(r.prs.map((p) => p.title));
    // another source that went live the same day and is measured on the same platform gets the very same numbers
    const sameDayOn = (plat: ScorePlat) =>
      scored.filter((o) => o !== r && o.r.bangkok_date === r.r.bangkok_date && o.cells[plat]).map((o) => RELEASE_SOURCE_LABEL[o.r.platform] ?? o.r.repo);
    for (const p of SCORE_PLATS) {
      const c = r.cells[p.key];
      if (!c) continue;
      if (p.key === "web_mobile" && r.cells.web && r.cells.web.verdict === c.verdict) continue; // same dedup rule as lib/summary.ts
      const result = VERDICT_MAP[c.verdict];
      const notes: string[] = [];
      if (c.reason) notes.push(c.reason.charAt(0).toUpperCase() + c.reason.slice(1));
      if (c.excluded?.length) notes.push(`Left out: ${c.excluded.map((e) => `${fmtDate(e.day)} (${EXCLUDED_LABEL[e.reason]})`).join(", ")}`);
      const sameDay = sameDayOn(p.key);
      if (sameDay.length) notes.push(`Same day as ${[...new Set(sameDay)].join(" & ")} release — can't tell them apart`);
      const measured = result !== "Too early to tell" && result !== "Can't compare";
      rows.push({
        key: `${r.ids.join(",")}-${p.key}`,
        releaseKey: r.ids.join(","),
        releaseCount: r.releases,
        source: RELEASE_SOURCE_LABEL[r.r.platform] ?? r.r.repo,
        what: r.name,
        features,
        wentLive: fmtDate(r.r.bangkok_date),
        measuredOn: PLAT_LABEL[p.key],
        result,
        before: measured ? rate(c.before.value, c.before.orders) : "—",
        after: measured ? rate(c.after.value, c.after.orders) : "—",
        change: !measured || c.rel == null ? "—" : `${c.rel >= 0 ? "+" : ""}${(c.rel * 100).toFixed(1)}%`,
        notes,
        ids: r.ids,
        prTitles: r.prs.slice(0, 3).map((pr) => pr.title),
      });
    }
  }
  return rows;
}

/** Distinct releases per source in the rows (API, Website, iOS app, Android app order), for the summary chips. */
export function ceoReleaseSources(rows: ReleaseRowView[]): { source: string; releases: number }[] {
  const seen = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!seen.has(r.source)) seen.set(r.source, new Map());
    seen.get(r.source)!.set(r.releaseKey, r.releaseCount);
  }
  const rank = (s: string) => (RELEASE_SOURCE_ORDER.indexOf(s) + 1 || 99);
  return [...seen]
    .map(([source, groups]) => ({ source, releases: [...groups.values()].reduce((n, c) => n + c, 0) }))
    .sort((a, b) => rank(a.source) - rank(b.source));
}
