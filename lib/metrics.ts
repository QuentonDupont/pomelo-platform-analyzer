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

export function bangkokToday(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}
