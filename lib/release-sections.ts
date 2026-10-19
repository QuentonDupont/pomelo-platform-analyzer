// Semantic mapping of releases to the shopping sections used across the dashboard (same names as the
// funnel: Product list, PDP, Add to bag, Cart, Checkout …) and range-driven impact per section.
// Pure and browser-safe: runs identically in the local app and the published Artifact.
import { addDays, DailyRow, daysBetween } from "@/lib/compute";
import { bootstrapRatioDiff, Market, newcombeDiff } from "@/server/metrics/definitions";

export type SectionId = "home_feed" | "product_list" | "search" | "pdp" | "add_to_bag" | "cart" | "checkout" | "order" | "account" | "wishlist" | "content" | "platform";

export interface SectionDef {
  id: SectionId;
  label: string;
  /** matched against the PR title (lower-cased), incl. conventional-commit scope like "feat(pdp):" */
  title: RegExp;
  /** matched against changed folders (first 2 path segments) */
  path: RegExp;
  /** daily metric that tells whether this section moved */
  metric: SectionMetricId;
}

// Order = funnel order; first match wins per signal, a PR can map to several sections.
export const SECTIONS: SectionDef[] = [
  { id: "home_feed", label: "Home feed", title: /home ?feed|homepage|home page|\bhome\b|app_feed|masonry|hero|banner|slider/, path: /home|feed|banner|hero/, metric: "list_click" },
  { id: "product_list", label: "Product list", title: /\bplp\b|listing|product list|categor(y|ies)|catalog|collection|filter|sort|grid|boost|ranking|navigation|mega-?menu|\bmenu\b|best-?sellers?/, path: /listing|category|catalog|plp|collection|filter|boost|navigation|menu/, metric: "list_click" },
  { id: "search", label: "Search", title: /search|algolia|typeahead|autocomplete|placeholder/, path: /search|algolia/, metric: "search_rate" },
  { id: "pdp", label: "PDP", title: /\bpdp\b|product detail|product page|size ?guide|sizing|review|swatch|gallery|vto|try[- ]?on|availability|stock|pre-?order/, path: /pdp|product-?detail|productcontainer|\/product\b|products/, metric: "pdp_atb" },
  { id: "add_to_bag", label: "Add to bag", title: /add[- ]to[- ](bag|cart)|\batc\b|quick ?add|bag counter/, path: /add-?to-?(bag|cart)|quick-?add/, metric: "pdp_atb" },
  { id: "cart", label: "Cart", title: /\bcart\b|\bbag\b|voucher|coupon|promo ?code|recalc/, path: /cart|bag|voucher|coupon/, metric: "atb_order" },
  { id: "checkout", label: "Checkout", title: /checkout|address|shipping|payment|omise|2c2p|adyen|card|cod\b|guest checkout/, path: /checkout|payment|address|shipping/, metric: "atb_order" },
  { id: "order", label: "Order complete", title: /order (complete|confirm|success)|thank ?you|order rating|\bnps\b|cashback/, path: /order|thank/, metric: "nonbounce_cr" },
  { id: "account", label: "Login & account", title: /login|log in|sign[- ]?in|sign[- ]?up|register|otp|account|profile|auth|loyalty/, path: /account|login|auth|profile|register|loyalty/, metric: "nonbounce_cr" },
  { id: "wishlist", label: "Wishlist", title: /wishlist|favou?rite/, path: /wishlist/, metric: "pdp_atb" },
  { id: "content", label: "Content & campaigns", title: /campaign|landing|lookbook|cms|content|seo|hreflang|robots|sitemap|blog|smart banner/, path: /campaign|landing|cms|content|lookbook|seo/, metric: "bounce_rate" },
  { id: "platform", label: "Platform & tracking", title: /.*/, path: /.*/, metric: "bounce_rate" },
];
const BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<SectionId, SectionDef>;
export const sectionLabel = (id: SectionId) => BY_ID[id].label;

/** Sections a PR touches: from its title first, then its changed folders; "platform" only when nothing else matches. */
export function classifyPr(title: string, dirs: string[]): SectionId[] {
  const t = title.toLowerCase();
  const found = new Set<SectionId>();
  for (const s of SECTIONS) if (s.id !== "platform" && s.title.test(t)) found.add(s.id);
  if (!found.size)
    for (const d of dirs.map((x) => x.toLowerCase()))
      for (const s of SECTIONS) if (s.id !== "platform" && s.path.test(d)) found.add(s.id);
  return found.size ? SECTIONS.filter((s) => found.has(s.id)).map((s) => s.id) : ["platform"];
}

// ---------- section metrics (daily, from session-attributed event counts) ----------
export type SectionMetricId = "list_click" | "pdp_atb" | "atb_order" | "search_rate" | "bounce_rate" | "nonbounce_cr";
export const SECTION_METRIC: Record<SectionMetricId, { label: string; good: "up" | "down"; num: (r: DailyRow) => number | null; den: (r: DailyRow) => number | null; explain: string }> = {
  list_click: { label: "Product list → product click rate", good: "up", num: (r) => r.clicks ?? null, den: (r) => r.lists ?? null, explain: "product clicks ÷ product-list views" },
  pdp_atb: { label: "PDP → add-to-bag rate", good: "up", num: (r) => r.atb ?? null, den: (r) => r.pdp ?? null, explain: "add-to-bag events ÷ product views" },
  atb_order: { label: "Add-to-bag → order rate", good: "up", num: (r) => r.e_orders ?? r.s_orders ?? null, den: (r) => r.atb ?? null, explain: "orders ÷ add-to-bag events" },
  search_rate: { label: "Searches per session", good: "up", num: (r) => r.searches ?? null, den: (r) => r.total, explain: "product searches ÷ sessions" },
  bounce_rate: { label: "Bounce rate", good: "down", num: (r) => r.bounces, den: (r) => r.total, explain: "bounced ÷ total sessions" },
  nonbounce_cr: { label: "Non-bounce CR", good: "up", num: (r) => r.e_orders ?? r.s_orders ?? null, den: (r) => r.nb, explain: "orders ÷ non-bounce sessions" },
};

export type RelPlatform = "web" | "ios" | "android" | "backend";
/** Which traffic a release can affect: web → web, iOS/Android → that app, backend → web and both apps. */
export function scopesFor(p: RelPlatform): { key: "web" | "ios" | "android"; label: string }[] {
  if (p === "web") return [{ key: "web", label: "Web" }];
  if (p === "ios") return [{ key: "ios", label: "iOS" }];
  if (p === "android") return [{ key: "android", label: "Android" }];
  return [
    { key: "web", label: "Web" },
    { key: "ios", label: "iOS" },
    { key: "android", label: "Android" },
  ];
}

// ---------- CEO scorecard: one measure everywhere (conversion) ----------
export const SHORT_LABEL: Record<SectionId, string> = {
  home_feed: "Home feed",
  product_list: "Product listing",
  search: "Search",
  pdp: "Product page",
  add_to_bag: "Add to bag",
  cart: "Cart",
  checkout: "Checkout",
  order: "Order confirmation",
  account: "Sign-in & account",
  wishlist: "Wishlist",
  content: "Content & campaigns",
  platform: "Behind-the-scenes fixes",
};

/** Plain-English release name from the sections it touched, most-touched first. */
export function releaseName(sections: { id: SectionId; prs: number }[]): string {
  const top = [...sections].sort((a, b) => b.prs - a.prs).filter((s, i, arr) => s.id !== "platform" || arr.length === 1).slice(0, 2);
  if (!top.length) return "Release";
  const names = top.map((s) => SHORT_LABEL[s.id]);
  return names.length === 1 && top[0].id === "platform" ? names[0] : `${names.join(" & ")} updates`;
}

export interface ConversionImpact {
  /** relative change in conversion, e.g. 0.042 = +4.2% */
  rel: number | null;
  before: { value: number | null; orders: number; sessions: number; from: string; to: string; label: string };
  after: { value: number | null; orders: number; sessions: number; from: string; to: string; days: number };
  /**
   * better/worse: the 95% interval of the change excludes zero · likely better/worse: only the 80% interval does
   * (direction probable, not proven) · unreliable: the data can't support a comparison (see `reason`).
   */
  verdict: "better" | "worse" | "likely better" | "likely worse" | "no clear change" | "too early" | "no data" | "unreliable";
  /** days left out of the matched windows, and why (incomplete tracking, sale/spike day) */
  excluded?: { day: string; reason: "incomplete data" | "sale day" | "order spike" | "traffic spike" }[];
  /** plain-English reason for "unreliable" / "too early" */
  reason?: string;
}

/** A day counts only when its sessions reach this share of the usual (median) day: drops tracking gaps and today's partial day. */
const MIN_DAY_SHARE = 0.5;
/** A day with this multiple of the usual orders (and at least SPIKE_MIN_ORDERS) is a sale/spike day, left out of both windows. */
const SPIKE_MULTIPLE = 2.5;
const SPIKE_MIN_ORDERS = 10;
/** A day with this multiple of the usual sessions is a traffic spike (bots, campaign bursts), left out of both windows. */
const TRAFFIC_SPIKE_MULTIPLE = 1.6;
/**
 * Known sale days: the double-date campaigns (9.9, 10.10, 11.11, 12.12 …). The day itself is always left out;
 * days within SALE_HALO of it are left out too when orders ran SALE_HALO_MULTIPLE above the other week (multi-day campaigns).
 */
const isDoubleDate = (d: string) => Number(d.slice(5, 7)) === Number(d.slice(8, 10));
const SALE_HALO = 2;
const SALE_HALO_MULTIPLE = 1.5;
/** Sessions per day moving by more than this factor between the windows means tracking changed: no verdict. */
const TRAFFIC_JUMP = 1.5;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Matched-day comparison: each day after go-live (up to `windowDays`) is paired with the same weekday one week
 * earlier, so both sides have the same weekday mix and length. A pair is dropped when either day has incomplete
 * tracking or an order spike (a sale). Needs 3+ pairs; a jump in sessions per day means tracking changed.
 */
function matchedImpact(rows: DailyRow[], goLive: string, scope: ImpactScope, markets: Market[], windowDays: number): ConversionImpact {
  // sessions = non-bounce sessions (the conversion denominator); total = all sessions, where bot bursts show up
  const byDay = new Map<string, { orders: number; sessions: number; total: number }>();
  let lastDay = "";
  for (const r of rows) {
    if (!inScope(r, scope) || !markets.includes(r.market) || r.total <= 0) continue;
    const x = byDay.get(r.day) ?? { orders: 0, sessions: 0, total: 0 };
    x.orders += r.e_orders ?? r.s_orders ?? 0;
    x.sessions += r.nb;
    x.total += r.total;
    byDay.set(r.day, x);
    if (r.day > lastDay) lastDay = r.day;
  }
  // "Usual" is judged within each day's own week (the week before go-live, or the window after it), so a
  // one-off gap or spike stands out while a lasting shift — including a release that really works — does not.
  // A lasting jump in visits is caught separately by TRAFFIC_JUMP.
  const week = (start: number, len: number) => {
    const xs: { orders: number; sessions: number; total: number }[] = [];
    for (let i = start; i < start + len; i++) {
      const x = byDay.get(addDays(goLive, i));
      if (x) xs.push(x);
    }
    return { sessions: median(xs.map((x) => x.sessions)), orders: median(xs.map((x) => x.orders)), total: median(xs.map((x) => x.total)) };
  };
  const wBefore = week(-7, 7);
  const wAfter = week(0, windowDays);
  const own = (d: string) => (d < goLive ? wBefore : wAfter);
  const other = (d: string) => (d < goLive ? wAfter : wBefore);
  const usualSessions = Math.max(wBefore.sessions, wAfter.sessions);
  // with under 3 days in since go-live, the after window can't vouch for itself (it may be one partial day)
  let afterDays = 0;
  for (let i = 0; i < windowDays; i++) if (byDay.has(addDays(goLive, i))) afterDays++;
  const complete = (d: string) => {
    const x = byDay.get(d);
    const ref = d >= goLive && afterDays < 3 ? wBefore : own(d);
    return Boolean(x && x.sessions >= MIN_DAY_SHARE * ref.sessions);
  };
  // a spike stands out from its own week and from the other one
  const spike = (d: string) => {
    const o = byDay.get(d)?.orders ?? 0;
    return o >= SPIKE_MIN_ORDERS && o >= 2 * own(d).orders && o >= SPIKE_MULTIPLE * other(d).orders;
  };
  const saleDay = (d: string) => {
    if (isDoubleDate(d)) return true;
    let near = false;
    for (let i = -SALE_HALO; i <= SALE_HALO; i++) near ||= isDoubleDate(addDays(d, i));
    const o = byDay.get(d)?.orders ?? 0;
    return near && o >= SPIKE_MIN_ORDERS && o >= SALE_HALO_MULTIPLE * other(d).orders;
  };
  // bot bursts that reach the conversion denominator: all sessions at least double the quieter week's usual
  // day AND non-bounce sessions clearly up too (bots that only bounce don't distort conversion)
  const trafficSpike = (d: string) => {
    const x = byDay.get(d);
    return Boolean(x && x.total >= TRAFFIC_SPIKE_MULTIPLE * Math.min(wBefore.total, wAfter.total) && x.sessions >= SALE_HALO_MULTIPLE * Math.min(wBefore.sessions, wAfter.sessions));
  };

  const a = { orders: 0, sessions: 0 };
  const b = { orders: 0, sessions: 0 };
  const pairs: string[] = [];
  const excluded: NonNullable<ConversionImpact["excluded"]> = [];
  let notYet = 0;
  let rawBefore = 0;
  let rawAfter = 0;
  for (let k = 0; k < windowDays; k++) {
    const d = addDays(goLive, k);
    const p = addDays(d, -7);
    if (d > lastDay) {
      notYet++;
      continue;
    }
    if (!complete(d) || !complete(p)) {
      excluded.push({ day: complete(d) ? p : d, reason: "incomplete data" });
      continue;
    }
    // every complete pair counts toward the tracking-change check, before sale/spike days are set aside
    rawBefore += byDay.get(p)!.sessions;
    rawAfter += byDay.get(d)!.sessions;
    if (saleDay(d) || saleDay(p)) {
      excluded.push({ day: saleDay(d) ? d : p, reason: "sale day" });
      continue;
    }
    if (spike(d) || spike(p)) {
      excluded.push({ day: spike(d) ? d : p, reason: "order spike" });
      continue;
    }
    if (trafficSpike(d) || trafficSpike(p)) {
      excluded.push({ day: trafficSpike(d) ? d : p, reason: "traffic spike" });
      continue;
    }
    const x = byDay.get(d)!;
    const y = byDay.get(p)!;
    b.orders += x.orders;
    b.sessions += x.sessions;
    a.orders += y.orders;
    a.sessions += y.sessions;
    pairs.push(d);
  }
  const value = (s: { orders: number; sessions: number }) => (s.sessions > 0 ? s.orders / s.sessions : null);
  const out = {
    before: { value: value(a), orders: a.orders, sessions: a.sessions, from: pairs.length ? addDays(pairs[0], -7) : addDays(goLive, -7), to: pairs.length ? addDays(pairs[pairs.length - 1], -7) : addDays(goLive, -1), label: "same weekdays a week earlier" },
    after: { value: value(b), orders: b.orders, sessions: b.sessions, from: pairs[0] ?? goLive, to: pairs[pairs.length - 1] ?? goLive, days: pairs.length },
    excluded,
  };
  const rel = a.sessions && b.sessions && a.orders ? (b.orders / b.sessions - a.orders / a.sessions) / (a.orders / a.sessions) : null;
  const jump = rawBefore ? rawAfter / rawBefore : 1;
  if (rawBefore && rawAfter && (jump > TRAFFIC_JUMP || jump < 1 / TRAFFIC_JUMP)) {
    return { ...out, rel, verdict: "unreliable", reason: `visits per day ${jump > 1 ? "jumped" : "fell"} ${Math.round(Math.abs(jump - 1) * 100)}% — a tracking change, not a conversion change` };
  }
  if (pairs.length < 3) {
    if (notYet) return { ...out, rel, verdict: "too early", reason: `only ${pairs.length} comparable day${pairs.length === 1 ? "" : "s"} so far (needs 3)` };
    if (!byDay.size || !usualSessions) return { ...out, rel, verdict: "no data" };
    return { ...out, rel, verdict: "unreliable", reason: "too many days with incomplete data, sales or traffic spikes to compare" };
  }
  if (!a.orders || rel == null) return { ...out, rel, verdict: "no data" };
  const ci95 = newcombeDiff(a.orders, a.sessions, b.orders, b.sessions);
  const ci80 = newcombeDiff(a.orders, a.sessions, b.orders, b.sessions, 1.2816);
  const excludes = (ci: [number, number] | null) => Boolean(ci && (ci[0] > 0 || ci[1] < 0));
  const verdict = excludes(ci95) ? (rel > 0 ? "better" : "worse") : excludes(ci80) ? (rel > 0 ? "likely better" : "likely worse") : "no clear change";
  return { ...out, rel, verdict };
}

/**
 * Change in conversion (orders ÷ non-bounce sessions) after a release vs before it, inside the selected
 * range (before = range start → day before go-live; comparison period when < 3 days precede go-live).
 * "Clear" = the 95% interval of the difference (Newcombe/Wilson) excludes zero. Never a causal claim.
 */
/** Scorecard scopes: whole platforms plus mobile web on its own (rows carry device = "mobile" | "desktop" for web). */
export type ImpactScope = "web" | "web_mobile" | "ios" | "android";
const inScope = (r: DailyRow, scope: ImpactScope) => (scope === "web_mobile" ? r.platform === "web" && r.device === "mobile" : r.platform === scope);

export function conversionImpact(rows: DailyRow[], goLive: string, scope: ImpactScope, range: Win, cmp: Win, markets: Market[], windowDays?: number): ConversionImpact {
  // fixed windows: the N days after go-live, each matched with the same weekday a week earlier
  if (windowDays) return matchedImpact(rows, goLive, scope, markets, windowDays);
  const after: Win = { from: goLive > range.from ? goLive : range.from, to: range.to };
  const pre: Win = { from: range.from, to: addDays(goLive, -1) };
  const useCmp = goLive <= range.from || daysBetween(pre.from, pre.to) + 1 < 3;
  const before: Win & { label: string } = useCmp ? { ...cmp, label: "comparison period" } : { ...pre, label: "before go-live" };
  const sum = (w: Win) => {
    let orders = 0,
      sessions = 0;
    const days = new Set<string>();
    for (const r of rows) {
      if (r.day < w.from || r.day > w.to || !inScope(r, scope) || !markets.includes(r.market) || r.total <= 0) continue;
      orders += r.e_orders ?? r.s_orders ?? 0;
      sessions += r.nb;
      days.add(r.day);
    }
    return { orders, sessions, days: days.size, value: sessions > 0 ? orders / sessions : null };
  };
  const a = sum(before);
  const b = sum(after);
  const out = {
    before: { value: a.value, orders: a.orders, sessions: a.sessions, from: before.from, to: before.to, label: before.label },
    after: { value: b.value, orders: b.orders, sessions: b.sessions, from: after.from, to: after.to, days: b.days },
  };
  if (a.value == null || b.value == null || a.value === 0) return { ...out, rel: null, verdict: b.days === 0 ? "too early" : "no data" };
  const rel = (b.value - a.value) / a.value;
  if (b.days < 3) return { ...out, rel, verdict: "too early" };
  const ci = newcombeDiff(a.orders, a.sessions, b.orders, b.sessions);
  const clear = ci && (ci[0] > 0 || ci[1] < 0);
  return { ...out, rel, verdict: clear ? (rel > 0 ? "better" : "worse") : "no clear change" };
}

export interface SectionImpact {
  section: SectionId;
  scope: "web" | "ios" | "android";
  metric: SectionMetricId;
  before: { from: string; to: string; value: number | null; days: number; label: string };
  after: { from: string; to: string; value: number | null; days: number };
  diff: number | null;
  ci: [number, number] | null;
  verdict: "better" | "worse" | "no clear change" | "not enough days" | "no data";
}

type Win = { from: string; to: string };
function daily(rows: DailyRow[], w: Win, scope: "web" | "ios" | "android", markets: Market[], m: SectionMetricId) {
  const def = SECTION_METRIC[m];
  const byDay = new Map<string, { num: number; den: number }>();
  for (const r of rows) {
    if (r.day < w.from || r.day > w.to || r.platform !== scope || !markets.includes(r.market) || r.total <= 0) continue;
    const n = def.num(r);
    const d = def.den(r);
    if (n == null || d == null) continue;
    const x = byDay.get(r.day) ?? { num: 0, den: 0 };
    x.num += n;
    x.den += d;
    byDay.set(r.day, x);
  }
  const days = [...byDay.values()];
  const num = days.reduce((a, x) => a + x.num, 0);
  const den = days.reduce((a, x) => a + x.den, 0);
  return { days, value: den > 0 ? num / den : null };
}

/**
 * Impact of a release on one section metric, driven by the selected range:
 * after = go-live → range end; before = range start → day before go-live, or the comparison
 * period when the range has fewer than 3 days before go-live. Change vs before, never causal.
 */
export function sectionImpact(rows: DailyRow[], goLive: string, section: SectionId, scope: "web" | "ios" | "android", range: Win, cmp: Win, markets: Market[]): SectionImpact {
  const metric = BY_ID[section].metric;
  const after: Win = { from: goLive > range.from ? goLive : range.from, to: range.to };
  const inRangeBefore: Win = { from: range.from, to: addDays(goLive, -1) };
  const useCmp = goLive <= range.from || daysBetween(inRangeBefore.from, inRangeBefore.to) + 1 < 3;
  const before: Win & { label: string } = useCmp ? { ...cmp, label: "comparison period" } : { ...inRangeBefore, label: "range before go-live" };
  const a = daily(rows, before, scope, markets, metric);
  const b = daily(rows, after, scope, markets, metric);
  const base = { section, scope, metric, before: { ...before, value: a.value, days: a.days.length }, after: { ...after, value: b.value, days: b.days.length } };
  if (a.value == null || b.value == null) return { ...base, diff: null, ci: null, verdict: "no data" };
  const diff = b.value - a.value;
  if (a.days.length < 3 || b.days.length < 3) return { ...base, diff, ci: null, verdict: "not enough days" };
  const ci = bootstrapRatioDiff(a.days, b.days);
  const good = SECTION_METRIC[metric].good;
  const clear = ci && (ci[0] > 0 || ci[1] < 0);
  const better = good === "up" ? diff > 0 : diff < 0;
  return { ...base, diff, ci, verdict: clear ? (better ? "better" : "worse") : "no clear change" };
}

// ---------- shared scorecard rows (used by the release scorecard and the period summary) ----------
export type ScorePlat = ImpactScope;
export const SCORE_PLATS: { key: ScorePlat; label: string }[] = [
  { key: "web", label: "Web (all)" },
  { key: "web_mobile", label: "Web mobile" },
  { key: "ios", label: "iOS" },
  { key: "android", label: "Android" },
];
export const SHIPS_TO: Record<string, { label: string; ships: ScorePlat[] }> = {
  web: { label: "Web app", ships: ["web", "web_mobile"] },
  ios: { label: "iOS app", ships: ["ios"] },
  android: { label: "Android app", ships: ["android"] },
  backend: { label: "All platforms (API)", ships: ["web", "web_mobile", "ios", "android"] },
};
export const SCORE_WINDOW = 7;

type ScoreRelease = { id: string; repo: string; release_id: string | null; platform: string; bangkok_date: string; go_live_at: string | null; prs: { number: number; title: string; dirs: string[] }[] };
export interface ScoreRow<R extends ScoreRelease = ScoreRelease> {
  r: R;
  ids: string[];
  releases: number;
  prs: { number: number; title: string; sections: SectionId[] }[];
  name: string;
  where: { label: string; ships: ScorePlat[] };
  cells: Record<ScorePlat, ConversionImpact | null>;
}

/** One row per go-live day × platform (same-day releases share a window), newest first. */
export function scoreReleases<R extends ScoreRelease>(releases: R[], daily: DailyRow[], range: Win, cmp: Win, markets: Market[]): ScoreRow<R>[] {
  const groups = new Map<string, R[]>();
  for (const r of releases.filter((x) => x.bangkok_date >= range.from && x.bangkok_date <= range.to)) {
    const k = `${r.bangkok_date}|${r.platform}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()]
    .map((list) => {
      const r = list[0];
      const prs = list.flatMap((x) => x.prs).map((p) => ({ number: p.number, title: p.title, sections: classifyPr(p.title, p.dirs) }));
      const counts = new Map<SectionId, number>();
      for (const p of prs) for (const s of p.sections) counts.set(s, (counts.get(s) ?? 0) + 1);
      const sections = SECTIONS.filter((s) => counts.has(s.id)).map((s) => ({ id: s.id, prs: counts.get(s.id)! }));
      const where = SHIPS_TO[r.platform] ?? SHIPS_TO.backend;
      const cells = Object.fromEntries(SCORE_PLATS.map((p) => [p.key, where.ships.includes(p.key) ? conversionImpact(daily, r.bangkok_date, p.key, range, cmp, markets, SCORE_WINDOW) : null])) as Record<ScorePlat, ConversionImpact | null>;
      return { r, ids: list.map((x) => `${x.repo} ${x.release_id}`), releases: list.length, prs, name: releaseName(sections), where, cells };
    })
    .sort((a, b) => (b.r.go_live_at ?? b.r.bangkok_date).localeCompare(a.r.go_live_at ?? a.r.bangkok_date));
}
