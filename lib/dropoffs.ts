// Funnel drop-off table: the 12 flows the business asked for, each step measured from the best
// read-only source and labelled with how it was measured. Pure and browser-safe.
import { addDays } from "@/lib/compute";
import { Market, wilson } from "@/server/metrics/definitions";

export type FPlatform = "web" | "ios" | "android";
export interface TransitionRow {
  week: string;
  platform: FPlatform;
  source: string;
  target: string;
  source_stage: number;
  target_stage: number;
  sessions: number;
}
export interface SessionFlagRow {
  week: string;
  platform: string; // web | ios | android | unknown
  market: Market;
  signed_in: boolean | null;
  atc: boolean | null;
  purchase: boolean | null;
  sessions: number;
}
export interface UserFunnelRow {
  week: string;
  platform: string;
  market: Market;
  signed_in: boolean | null;
  users: number;
  list_viewed: number;
  product_click: number;
  added_to_bag: number;
}
export interface CartPurchaseRow {
  week: string;
  platform: string;
  market: Market;
  signed_in: boolean | null;
  purchase: boolean | null;
  users_added_to_bag: number;
}
export interface DropoffData {
  transitions: TransitionRow[];
  flags: SessionFlagRow[];
  users: UserFunnelRow[];
  cart: CartPurchaseRow[];
}

/** How a step is measured. */
export type Method =
  | "session_flags" // exact: session-level flags in the Cube session table
  | "user_purchase" // users who added to bag, split by whether a purchase was made (Cube session table)
  | "user_counts" // distinct users per week × platform × market group
  | "arrivals" // estimate: sessions that reached the step from an earlier step (event funnel)
  | "next_step" // only the split of sessions that moved on; exits are not recorded
  | "not_evidenced";

export interface StepDef {
  from: string;
  to: string;
  method: Method;
  /** event names in the Sankey event funnel (stage-ordered) */
  fromEvents?: string[];
  toEvents?: string[];
  /** user_counts method: which distinct-user counts form the base and the continuation */
  userFrom?: "list_viewed" | "product_click";
  userTo?: "product_click" | "added_to_bag";
  /** platforms where the tracked event does not mean what the business term means → shown as n/a with the reason */
  unsupported?: Partial<Record<FPlatform, string>>;
  note?: string;
}
export interface FlowDef {
  id: string;
  label: string;
  guest?: boolean;
  steps: StepDef[];
  mapping?: string; // how business terms map to tracked events (and whether that is confirmed)
}

// Business terms → tracked events (RudderStack, via Superset Sankey datasets 284/285/286).
export const EVENTS = {
  productList: ["navigation", "category", "search", "searchbox", "best_sellers", "lookbook", "lookbook_shop_look", "skinny_banner", "full_screen_banner", "landing_page", "external", "pdp_just_for_you", "pdp_similar_products", "pdp_manufacturer", "category_similar_products", "zero_search_result", "Hero Banner", "app_feed", "home_slider", "special_awareness", "undefined", "null", "error_page", "broken_deeplink"],
  pdp: ["Product Viewed"],
  addToCart: ["Product Added", "Quick Add to Cart"],
  cartView: ["Cart Viewed"],
  address: ["Shipping Address Selected"],
  payment: ["Payment Method Selected"],
  order: ["Order Completed"],
  login: ["Login", "Email Login", "Facebook Login", "Google Login", "Line Login", "Phone Login", "apple Login", "email Login", "facebook Login", "google Login", "line Login", "phone Login"],
  homeFeed: ["app_feed"],
  heroBanner: ["Hero Banner"],
  specialShowcase: ["special_awareness"],
};

const LIST_TO_LIST = "Both steps are product-list views (same funnel stage); the event funnel cannot link one list view to another. Needs the per-session funnel dataset (docs/FUNNEL_DATASET.sql).";

export const FLOWS: FlowDef[] = [
  { id: "list-pdp", label: "Product list → PDP", steps: [{ from: "Product list", to: "PDP", method: "user_counts", userFrom: "list_viewed", userTo: "product_click", note: "Users who viewed a product list vs users who clicked a product. Distinct users per week × platform × market group, summed across groups." }] },
  {
    id: "pdp-atc-cart",
    label: "PDP → Add to cart → Cart view",
    steps: [
      { from: "PDP", to: "Add to cart", method: "user_counts", userFrom: "product_click", userTo: "added_to_bag", note: "Users who clicked through to a product vs users who added to bag, per week × platform × market (users who landed directly on a PDP and added to bag can make this look better than it is)." },
      { from: "Add to cart", to: "Cart view", method: "arrivals", fromEvents: EVENTS.addToCart, toEvents: EVENTS.cartView },
    ],
  },
  {
    id: "cart-address-payment",
    label: "Cart view → Add address → Add payment",
    steps: [
      { from: "Cart view", to: "Add address", method: "arrivals", fromEvents: EVENTS.cartView, toEvents: EVENTS.address },
      { from: "Add address", to: "Add payment", method: "arrivals", fromEvents: EVENTS.address, toEvents: [...EVENTS.payment, "Payment Methods Viewed"], note: "Apps log 'Payment Methods Viewed' between address and payment; it counts as reaching the payment step." },
    ],
  },
  { id: "payment-order", label: "Add payment → Order complete", steps: [{ from: "Add payment", to: "Order complete", method: "arrivals", fromEvents: EVENTS.payment, toEvents: EVENTS.order }] },
  { id: "cart-order", label: "Cart → Order complete", steps: [{ from: "Cart (added to bag)", to: "Order complete", method: "user_purchase", note: "Users who added to bag, and of those, users in sessions where a purchase was made (any path to order). The session-level add-to-cart flag is not queryable in Superset (HTTP 400)." }] },
  { id: "guest-cart-order", label: "Guest session: Cart → Order complete", guest: true, steps: [{ from: "Cart (added to bag)", to: "Order complete", method: "user_purchase", note: "Guest = session not signed in (was_signed_in = false). Guest checkout is not live in production, so a guest who buys signs in first and that session counts as signed-in: a 100% drop-off here means no purchase was made without signing in." }] },
  { id: "login-feed", label: "Login → Home feed", mapping: "Home feed = product list opened from the app feed (ref_type app_feed)", steps: [{ from: "Login", to: "Home feed", method: "next_step", fromEvents: EVENTS.login, toEvents: EVENTS.homeFeed }] },
  { id: "feed-pdp", label: "Home feed → PDP", mapping: "Home feed = ref_type app_feed", steps: [{ from: "Home feed", to: "PDP", method: "next_step", fromEvents: EVENTS.homeFeed, toEvents: EVENTS.pdp }] },
  { id: "feed-list", label: "Home feed → Product list", steps: [{ from: "Home feed", to: "Product list", method: "not_evidenced", note: LIST_TO_LIST }] },
  {
    id: "hero-list-pdp",
    label: "Hero Banner → Product list → PDP",
    mapping: "Hero Banner = product list opened from a banner (the list view itself), so Banner → List is one event",
    steps: [
      { from: "Hero Banner", to: "Product list", method: "not_evidenced", note: "The banner click and the list view are the same tracked event (product_list_viewed with a banner ref_type)." },
      {
        from: "Product list (from banner)",
        to: "PDP",
        method: "next_step",
        fromEvents: EVENTS.heroBanner,
        toEvents: EVENTS.pdp,
        unsupported: { web: "On web the event funnel labels every list source except home slider, navigation and app feed as 'Hero Banner', so it is not a banner signal." },
        note: "App: list views linked to CMS hero/banner feed items (a lower bound — a session's first list view is labelled either by its ref_type or as Hero Banner).",
      },
    ],
  },
  { id: "showcase-pdp", label: "Special Showcase → PDP", mapping: "Special Showcase = ref_type special_awareness (unconfirmed — no 'showcase' value exists in the data)", steps: [{ from: "Special Showcase", to: "PDP", method: "next_step", fromEvents: EVENTS.specialShowcase, toEvents: EVENTS.pdp, note: "Web counts are partial: on web a special_awareness list view can also be labelled 'Hero Banner'." }] },
  { id: "showcase-list", label: "Special Showcase → Product list", steps: [{ from: "Special Showcase", to: "Product list", method: "not_evidenced", note: LIST_TO_LIST }] },
];

export const METHOD_LABEL: Record<Method, { label: string; tone: "High" | "Medium" | "Low" }> = {
  session_flags: { label: "exact (session flags)", tone: "High" },
  user_counts: { label: "user-level", tone: "Medium" },
  user_purchase: { label: "user-level", tone: "Medium" },
  arrivals: { label: "estimate (arrivals)", tone: "Medium" },
  next_step: { label: "next-step split only", tone: "Low" },
  not_evidenced: { label: "not measurable yet", tone: "Low" },
};

export interface StepResult {
  base: number | null; // sessions/users at the step
  continued: number | null; // of those, reached the next step
  dropoff: number | null; // 1 - continued/base
  ci: [number, number] | null; // 95% Wilson interval on the drop-off
  /** next_step method only: share of sessions that moved on from the step whose next step was the target */
  nextShare: number | null;
  movedOn: number | null;
  /** the "continued" count exceeds the step count, so these counts do not measure this transition here */
  inconsistent?: boolean;
}

const triBool = (v: unknown): boolean | null => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);

/** Map stored rows (SQLite tables or Artifact docs) into the typed drop-off inputs. */
export function toDropoffData(t: Record<string, unknown>[], f: Record<string, unknown>[], u: Record<string, unknown>[], c: Record<string, unknown>[] = []): DropoffData {
  return {
    transitions: t.map((r) => ({ week: String(r.week), platform: r.platform as FPlatform, source: String(r.source), target: String(r.target), source_stage: Number(r.source_stage), target_stage: Number(r.target_stage), sessions: Number(r.sessions) })),
    flags: f.map((r) => ({ week: String(r.week), platform: String(r.platform), market: r.market as Market, signed_in: triBool(r.signed_in), atc: triBool(r.atc), purchase: triBool(r.purchase), sessions: Number(r.sessions) })),
    users: u.map((r) => ({ week: String(r.week), platform: String(r.platform), market: r.market as Market, signed_in: triBool(r.signed_in), users: Number(r.users ?? 0), list_viewed: Number(r.list_viewed ?? 0), product_click: Number(r.product_click ?? 0), added_to_bag: Number(r.added_to_bag ?? 0) })),
    cart: c.map((r) => ({ week: String(r.week), platform: String(r.platform), market: r.market as Market, signed_in: triBool(r.signed_in), purchase: triBool(r.purchase), users_added_to_bag: Number(r.users_added_to_bag ?? 0) })),
  };
}

/** Weeks (Mondays) whose Mon–Sun span overlaps [from, to]. */
export function weeksOverlapping(weeks: string[], from: string, to: string) {
  return [...new Set(weeks)].filter((w) => w <= to && addDays(w, 6) >= from).sort();
}

const inPlat = (p: string, plats: FPlatform[]) => plats.includes(p as FPlatform);
const empty: StepResult = { base: null, continued: null, dropoff: null, ci: null, nextShare: null, movedOn: null };

function finish(base: number, continued: number): StepResult {
  if (base <= 0) return { ...empty, base, continued };
  // more "continued" than "at step" means the two counts are not a funnel on this platform: never cap to a fake 0%
  if (continued > base * 1.02) return { ...empty, base, continued, inconsistent: true };
  const c = Math.min(continued, base);
  const drop = base - c;
  return { base, continued: c, dropoff: drop / base, ci: wilson(drop, base), nextShare: null, movedOn: null };
}

export function computeStep(step: StepDef, flow: FlowDef, d: DropoffData, weeks: string[], plats: FPlatform[], markets: Market[]): StepResult {
  const ws = new Set(weeks);
  if (step.method === "not_evidenced") return empty;
  if (step.method === "session_flags") {
    const rows = d.flags.filter((r) => ws.has(r.week) && inPlat(r.platform, plats) && markets.includes(r.market) && r.atc === true && (!flow.guest || r.signed_in === false));
    if (!rows.length) return empty;
    return finish(
      rows.reduce((a, r) => a + r.sessions, 0),
      rows.filter((r) => r.purchase === true).reduce((a, r) => a + r.sessions, 0),
    );
  }
  if (step.method === "user_purchase") {
    const rows = d.cart.filter((r) => ws.has(r.week) && inPlat(r.platform, plats) && markets.includes(r.market) && (!flow.guest || r.signed_in === false));
    if (!rows.length) return empty;
    return finish(
      rows.reduce((a, r) => a + r.users_added_to_bag, 0),
      rows.filter((r) => r.purchase === true).reduce((a, r) => a + r.users_added_to_bag, 0),
    );
  }
  if (step.method === "user_counts") {
    const rows = d.users.filter((r) => ws.has(r.week) && inPlat(r.platform, plats) && markets.includes(r.market) && (!flow.guest || r.signed_in === false));
    if (!rows.length) return empty;
    const f = step.userFrom ?? "list_viewed";
    const t = step.userTo ?? "product_click";
    return finish(
      rows.reduce((a, r) => a + r[f], 0),
      rows.reduce((a, r) => a + r[t], 0),
    );
  }
  const from = new Set(step.fromEvents ?? []);
  const to = new Set(step.toEvents ?? []);
  const tr = d.transitions.filter((r) => ws.has(r.week) && inPlat(r.platform, plats));
  if (!tr.length) return empty;
  const continued = tr.filter((r) => from.has(r.source) && to.has(r.target)).reduce((a, r) => a + r.sessions, 0);
  if (step.method === "arrivals") {
    const arrivals = tr.filter((r) => from.has(r.target)).reduce((a, r) => a + r.sessions, 0);
    // continuation counted only for sessions that arrived from an earlier step would be ideal; the
    // event funnel does not carry that, so cap at arrivals and label the row as an estimate
    return finish(arrivals, continued);
  }
  // next_step: exits are not recorded, so only the split among sessions that moved on is known
  const movedOn = tr.filter((r) => from.has(r.source)).reduce((a, r) => a + r.sessions, 0);
  return { ...empty, continued, movedOn, nextShare: movedOn ? continued / movedOn : null };
}
