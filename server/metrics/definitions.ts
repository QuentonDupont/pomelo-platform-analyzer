// Single source of truth for every metric shown in the dashboard.
// Definitions follow the CEO brief (7 Oct 2026). Anything not yet confirmed
// against Superset dataset SQL is marked `status: "pending"`.

export const DEFINITION_VERSION = "2026-10-08.mvp1";

export type Platform = "web" | "ios" | "android" | "unknown";
export type PlatformFilter = "web" | "app" | "ios" | "android";
export type Market = "TH" | "SG" | "HK" | "GL" | "AU";

export const MARKETS: { id: Market; label: string }[] = [
  { id: "TH", label: "Thailand" },
  { id: "SG", label: "Singapore" },
  { id: "HK", label: "Hong Kong" },
  { id: "GL", label: "Global USD" },
  { id: "AU", label: "Australia" },
];

export const SECTIONS = [
  "home",
  "listing",
  "search",
  "pdp",
  "bag",
  "checkout",
  "account",
  "content",
] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<Section, string> = {
  home: "Home",
  listing: "Category / listing",
  search: "Search",
  pdp: "Product (PDP)",
  bag: "Bag",
  checkout: "Checkout",
  account: "Account",
  content: "Content / campaign",
};

/** One aggregate cell: week x platform x market x landing section. Never row-level. */
export interface Cell {
  week: string; // Monday, Asia/Bangkok business date YYYY-MM-DD
  platform: Platform;
  market: Market;
  section: Section;
  total_sessions: number;
  nonbounce_sessions: number;
  orders: number;
  booked_revenue_usd: number;
  pdp: number;
  atb: number;
  checkout: number;
  payment: number;
}

export interface Totals {
  total_sessions: number;
  bounce_sessions: number;
  nonbounce_sessions: number;
  orders: number;
  booked_revenue_usd: number;
  pdp: number;
  atb: number;
  checkout: number;
  payment: number;
}

export const MIN_SESSIONS = 30;
export const MIN_ORDERS = 5;

export const METRIC_DEFS = {
  bounce_rate: {
    label: "Bounce rate",
    status: "pending" as const,
    web: "Session with exactly one page view and no engagement event (pending Superset dataset 63 confirmation)",
    app: "App-bounce: single-screen session with no tracked interaction, same rule for iOS and Android (proposal — not industry standard)",
  },
  nonbounce_cr: {
    label: "Non-bounce CR",
    status: "brief" as const,
    text: "Eligible backend orders / known-bot-excluded non-bounce tracked sessions. Operational ratio, not matched session conversion.",
  },
  booked_revenue: {
    label: "Booked revenue",
    status: "brief" as const,
    text: "After-discount booked merchandise value in source USD, before returns. Not net revenue.",
  },
};

export function inPlatform(p: Platform, f: PlatformFilter): boolean {
  if (f === "app") return p === "ios" || p === "android";
  return p === f;
}

export function sum(cells: Cell[]): Totals {
  const t: Totals = {
    total_sessions: 0,
    bounce_sessions: 0,
    nonbounce_sessions: 0,
    orders: 0,
    booked_revenue_usd: 0,
    pdp: 0,
    atb: 0,
    checkout: 0,
    payment: 0,
  };
  for (const c of cells) {
    t.total_sessions += c.total_sessions;
    t.nonbounce_sessions += c.nonbounce_sessions;
    t.orders += c.orders;
    t.booked_revenue_usd += c.booked_revenue_usd;
    t.pdp += c.pdp;
    t.atb += c.atb;
    t.checkout += c.checkout;
    t.payment += c.payment;
  }
  t.bounce_sessions = t.total_sessions - t.nonbounce_sessions;
  return t;
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

export function derived(t: Totals) {
  return {
    bounce_rate: ratio(t.bounce_sessions, t.total_sessions),
    nonbounce_cr: ratio(t.orders, t.nonbounce_sessions),
    aov: ratio(t.booked_revenue_usd, t.orders),
    rev_per_nb_session: ratio(t.booked_revenue_usd, t.nonbounce_sessions),
    rev_per_session: ratio(t.booked_revenue_usd, t.total_sessions),
    suppressed_sessions: t.total_sessions < MIN_SESSIONS,
    suppressed_orders: t.orders < MIN_ORDERS,
  };
}

/** Wilson score interval for a proportion (95% by default). */
export function wilson(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export type Confidence = "High" | "Medium" | "Low";

/** Confidence from sample size and relative interval width of the bounce rate. */
export function confidence(bounces: number, sessions: number): Confidence {
  const ci = wilson(bounces, sessions);
  if (!ci || sessions < MIN_SESSIONS) return "Low";
  const p = bounces / sessions;
  const rel = p > 0 ? (ci[1] - ci[0]) / p : 1;
  if (sessions >= 1000 && rel < 0.1) return "High";
  if (sessions >= 200 && rel < 0.25) return "Medium";
  return "Low";
}

/**
 * D2 revenue at stake (weekly, USD).
 * recoverable_sessions = total_sessions * max(bounce_gap, 0)
 * revenue_at_stake     = recoverable_sessions * nonbounce_cr * aov
 */
export function revenueAtStake(input: {
  total_sessions: number;
  bounce_rate: number;
  benchmark_bounce_rate: number;
  nonbounce_cr: number;
  aov: number;
}) {
  const gap = input.bounce_rate - input.benchmark_bounce_rate;
  const recoverable = input.total_sessions * Math.max(gap, 0);
  return {
    bounce_gap: gap,
    recoverable_sessions: recoverable,
    revenue_at_stake: recoverable * input.nonbounce_cr * input.aov,
  };
}

/**
 * D3 LMDI decomposition of revenue change into traffic x conversion x AOV.
 * Revenue = sessions * (orders/sessions) * (revenue/orders); effects sum exactly to the change.
 */
export function lmdi(
  a: { sessions: number; orders: number; revenue: number },
  b: { sessions: number; orders: number; revenue: number },
) {
  const L = (x: number, y: number) => (x === y ? x : (y - x) / (Math.log(y) - Math.log(x)));
  const w = L(a.revenue, b.revenue);
  const crA = a.orders / a.sessions;
  const crB = b.orders / b.sessions;
  const aovA = a.revenue / a.orders;
  const aovB = b.revenue / b.orders;
  return {
    total: b.revenue - a.revenue,
    traffic: w * Math.log(b.sessions / a.sessions),
    conversion: w * Math.log(crB / crA),
    aov: w * Math.log(aovB / aovA),
  };
}

/** A week is immature when it is incomplete or ended < 7 days ago (late cancellations). */
export function isImmature(weekStart: string, today: string): boolean {
  const end = new Date(weekStart + "T00:00:00+07:00").getTime() + 7 * 86400000;
  const now = new Date(today + "T00:00:00+07:00").getTime();
  return now - end < 7 * 86400000;
}

/**
 * 95% interval for the difference of two proportions (p2 - p1), Newcombe hybrid score
 * method built from the two Wilson intervals.
 */
export function newcombeDiff(x1: number, n1: number, x2: number, n2: number, z = 1.96): [number, number] | null {
  const a = wilson(x1, n1, z);
  const b = wilson(x2, n2, z);
  if (!a || !b) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const d = p2 - p1;
  const lo = d - Math.sqrt((p2 - b[0]) ** 2 + (a[1] - p1) ** 2);
  const hi = d + Math.sqrt((b[1] - p2) ** 2 + (p1 - a[0]) ** 2);
  return [lo, hi];
}

/** Deterministic PRNG so bootstrap intervals are reproducible across refreshes. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap 95% interval for the change in a ratio metric (sum(num)/sum(den)) between two
 * windows, resampling days (the unit we hold) with replacement. Used for AOV and revenue
 * per session, where a binomial interval does not apply.
 */
export function bootstrapRatioDiff(
  before: { num: number; den: number }[],
  after: { num: number; den: number }[],
  iterations = 2000,
  seed = 7,
): [number, number] | null {
  if (before.length < 3 || after.length < 3) return null;
  const rnd = mulberry32(seed);
  const draw = (xs: { num: number; den: number }[]) => {
    let n = 0;
    let d = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[Math.floor(rnd() * xs.length)];
      n += x.num;
      d += x.den;
    }
    return d > 0 ? n / d : NaN;
  };
  const diffs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const v = draw(after) - draw(before);
    if (Number.isFinite(v)) diffs.push(v);
  }
  if (diffs.length < iterations / 2) return null;
  diffs.sort((a, b) => a - b);
  return [diffs[Math.floor(diffs.length * 0.025)], diffs[Math.floor(diffs.length * 0.975)]];
}

/** Source platform spelling (Superset app_name_short_version / online_sales.platform) → dashboard platform + device. */
export function normalizePlatform(src: string | null | undefined): { platform: Platform; device: Device } {
  switch ((src ?? "").trim()) {
    case "iOS":
      return { platform: "ios", device: "app" };
    case "Android":
      return { platform: "android", device: "app" };
    case "Web Desktop":
      return { platform: "web", device: "desktop" };
    case "Web Mobile":
      return { platform: "web", device: "mobile" };
    default:
      return { platform: "unknown", device: "unknown" };
  }
}
export type Device = "desktop" | "mobile" | "app" | "unknown";

/** id_shop → market. Shop 10 = AU is an assumption pending confirmation (OPEN_QUESTIONS #3). */
export const SHOP_MARKET: Record<number, Market> = { 1: "TH", 2: "SG", 4: "GL", 10: "AU", 12: "HK" };
export const IN_SCOPE_SHOPS = [1, 2, 4, 10, 12];

export function bangkokToday(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}
