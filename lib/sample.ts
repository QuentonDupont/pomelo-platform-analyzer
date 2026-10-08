// SAMPLE DATA fixture. Totals marked `ceo_brief` reproduce the CEO brief (7 Oct 2026)
// exactly; every other split (market, iOS/Android, section, bounce, revenue, funnel,
// the 21–27 Sep week) is ILLUSTRATIVE so the UX can be reviewed before real data lands.
import { Cell, Market, Platform, SECTIONS, Section } from "./metrics";

export const SAMPLE_WEEKS = ["2026-09-14", "2026-09-21", "2026-09-28"] as const;

/** Largest-remainder allocation: integers that sum exactly to `total`. */
export function allocate(total: number, weights: number[]): number[] {
  const s = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / s);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k++, rest--) out[order[k % order.length][1]]++;
  return out;
}

// CEO-brief totals (non-bounce sessions, orders). W-1 (21 Sep) is illustrative.
export const CEO_BRIEF = {
  app: { "2026-09-14": [13615, 174], "2026-09-28": [12510, 163] },
  web: { "2026-09-14": [6317, 33], "2026-09-28": [6014, 28] },
  th_web: { "2026-09-14": [4255, 21], "2026-09-28": [3890, 21] },
} as const;

const APP_TOTALS: Record<string, [number, number]> = {
  "2026-09-14": [13615, 174],
  "2026-09-21": [13020, 168],
  "2026-09-28": [12510, 163],
};
const WEB_TH: Record<string, [number, number]> = {
  "2026-09-14": [4255, 21],
  "2026-09-21": [4080, 20],
  "2026-09-28": [3890, 21],
};
const WEB_OTHER: Record<string, [number, number]> = {
  "2026-09-14": [6317 - 4255, 33 - 21],
  "2026-09-21": [2110, 10],
  "2026-09-28": [6014 - 3890, 28 - 21],
};

const WEB_OTHER_MKT: [Market, number][] = [["SG", 35], ["HK", 20], ["GL", 30], ["AU", 15]];
const APP_MKT: [Market, number][] = [["TH", 70], ["SG", 12], ["HK", 8], ["GL", 6], ["AU", 4]];
const IOS_SHARE = 0.58;

// Landing-section mix of non-bounce sessions, and illustrative bounce rates.
const SECTION_W: Record<Section, number> = {
  home: 30, listing: 26, search: 6, pdp: 24, bag: 2, checkout: 1, account: 3, content: 8,
};
const BOUNCE: Record<"web" | "app", Record<Section, number>> = {
  web: { home: 0.52, listing: 0.61, search: 0.34, pdp: 0.68, bag: 0.22, checkout: 0.18, account: 0.3, content: 0.74 },
  app: { home: 0.31, listing: 0.36, search: 0.21, pdp: 0.42, bag: 0.15, checkout: 0.12, account: 0.2, content: 0.47 },
};
const ORDER_W: Record<Section, number> = {
  home: 1, listing: 1.1, search: 1.6, pdp: 1.3, bag: 3, checkout: 4, account: 0.8, content: 0.5,
};
const AOV = { web: { "2026-09-14": 41, "2026-09-21": 38.5, "2026-09-28": 36 }, app: { "2026-09-14": 47, "2026-09-21": 46.5, "2026-09-28": 47.5 } } as Record<
  "web" | "app",
  Record<string, number>
>;

function weekDrift(week: string, section: Section): number {
  // deterministic small drift so movers exist; listing and pdp get worse on web in the latest week
  const i = SAMPLE_WEEKS.indexOf(week as (typeof SAMPLE_WEEKS)[number]);
  const bump = section === "listing" ? 0.025 : section === "pdp" ? 0.015 : section === "search" ? -0.01 : 0;
  return i * bump;
}

function cellsFor(week: string, platform: Platform, market: Market, nb: number, orders: number): Cell[] {
  const kind = platform === "web" ? "web" : "app";
  const nbBySection = allocate(nb, SECTIONS.map((s) => SECTION_W[s]));
  const ordBySection = allocate(orders, SECTIONS.map((s, i) => nbBySection[i] * ORDER_W[s]));
  return SECTIONS.map((section, i) => {
    const nbs = nbBySection[i];
    const br = Math.min(0.9, BOUNCE[kind][section] + (kind === "web" ? weekDrift(week, section) : weekDrift(week, section) / 3));
    const total = Math.round(nbs / (1 - br));
    const o = ordBySection[i];
    const pdp = Math.round(nbs * (kind === "web" ? 0.52 : 0.61));
    const atb = Math.round(pdp * (kind === "web" ? 0.11 : 0.16));
    const checkout = Math.max(o, Math.round(atb * (kind === "web" ? 0.42 : 0.55)));
    const payment = Math.max(o, Math.round(checkout * (kind === "web" ? 0.62 : 0.74)));
    return {
      week, platform, market, section,
      total_sessions: total,
      nonbounce_sessions: nbs,
      orders: o,
      booked_revenue_usd: Math.round(o * AOV[kind][week] * 100) / 100,
      pdp, atb, checkout, payment,
    };
  });
}

export function buildSample(): Cell[] {
  const out: Cell[] = [];
  for (const week of SAMPLE_WEEKS) {
    out.push(...cellsFor(week, "web", "TH", ...WEB_TH[week]));
    const [onb, oord] = WEB_OTHER[week];
    const nbs = allocate(onb, WEB_OTHER_MKT.map((m) => m[1]));
    const ords = allocate(oord, WEB_OTHER_MKT.map((m) => m[1]));
    WEB_OTHER_MKT.forEach(([m], i) => out.push(...cellsFor(week, "web", m, nbs[i], ords[i])));

    const [anb, aord] = APP_TOTALS[week];
    const mnb = allocate(anb, APP_MKT.map((m) => m[1]));
    const mord = allocate(aord, APP_MKT.map((m) => m[1]));
    APP_MKT.forEach(([m], i) => {
      const [inb, anbr] = allocate(mnb[i], [IOS_SHARE, 1 - IOS_SHARE]);
      const [io, ao] = allocate(mord[i], [IOS_SHARE, 1 - IOS_SHARE]);
      out.push(...cellsFor(week, "ios", m, inb, io));
      out.push(...cellsFor(week, "android", m, anbr, ao));
    });
    // visible unknown-platform bucket (illustrative), never folded into Web or App
    out.push(...cellsFor(week, "unknown", "TH", 140, 0));
  }
  return out;
}

export interface Release {
  id: string;
  platform: "web" | "ios" | "android" | "backend";
  repo: string;
  go_live: string; // Asia/Bangkok date
  title: string;
  prs: { number: number; title: string }[];
  success_metric: string | null;
  metric_source: "declared" | "inferred" | "none";
  surface: string;
  confounded: boolean;
}

export const SAMPLE_RELEASES: Release[] = [
  { id: "web-sample-1", platform: "web", repo: "www", go_live: "2026-09-16", title: "Sample: listing filter refresh", prs: [{ number: 0, title: "Sample PR" }], success_metric: "Listing bounce rate ↓", metric_source: "inferred", surface: "listing", confounded: false },
  { id: "web-sample-2", platform: "web", repo: "www", go_live: "2026-09-24", title: "Sample: PDP + bag bundle", prs: [{ number: 0, title: "Sample PR A" }, { number: 0, title: "Sample PR B" }], success_metric: "PDP→ATB rate ↑", metric_source: "inferred", surface: "pdp", confounded: true },
  { id: "ios-sample-1", platform: "ios", repo: "ios", go_live: "2026-09-22", title: "Sample: iOS build 5.x ramp", prs: [], success_metric: null, metric_source: "none", surface: "app", confounded: false },
  { id: "and-sample-1", platform: "android", repo: "android", go_live: "2026-09-30", title: "Sample: Android build ramp", prs: [], success_metric: null, metric_source: "none", surface: "app", confounded: false },
  { id: "be-sample-1", platform: "backend", repo: "api", go_live: "2026-10-01", title: "Sample: cart API deploy", prs: [{ number: 0, title: "Sample PR" }], success_metric: "Checkout→Payment rate ↑", metric_source: "inferred", surface: "checkout", confounded: false },
];
