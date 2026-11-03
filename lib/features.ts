// Names a release by the customer-facing features its PRs touched ("Guest checkout · Vouchers & discounts · Bag"),
// read from each PR title. Specific features are matched on the whole title first (guest checkout before
// checkout, vouchers before bag); broad areas then go by the PR's own scope tag — fix(home) is the home page
// even when it mentions a video — and only then by the title's wording.

const SPECIFIC: { label: string; re: RegExp }[] = [
  { label: "Guest checkout", re: /guest[-_ ]?(checkout|profile)/i },
  { label: "Free gifts", re: /free[- ]?gift/i },
  { label: "Pre-orders", re: /pre-?order/i },
  { label: "Vouchers & discounts", re: /voucher|discount|diamond|price cut|promo code/i },
  { label: "Cookie consent & tracking", re: /consent|concent|\bgtm\b|tracking|meta advance|rudderstack/i },
  { label: "Payments", re: /adyen|payment|\bcc[- ]|credit card|\bttb\b|\bcod\b|merchant/i },
  { label: "Sign-in & sign-up", re: /sign[- ]?(in|up)|signup|log ?(in|out)|password|\btoken\b|verify customer|\(auth\)/i },
  { label: "Delivery & address", re: /shipping|\baddress\b|delivery(?! origin)|kerry|courier/i },
  { label: "Size guide", re: /size[- ]?guide|model-size|size buttons|measurement/i },
  { label: "Wishlist & waitlist", re: /wishlist|waitlist|saved items/i },
  { label: "Search", re: /\(search\)|product search|search navigation/i },
  { label: "Recommendations", re: /recommend|similar[- ]products|just for you|\bjfy\b|best[- ]sellers|customer favourites|get this look|recently viewed/i },
  { label: "Try-on", re: /try[- ]?on|\bvto\b/i },
  { label: "Loyalty & cashback", re: /cashback|loyalty|check-?in|store credit|\braf\b/i },
  { label: "App deep links", re: /deep ?link/i },
  { label: "Language & markets", re: /i18n|locale|language|\bkh shop\b/i },
];

const AREAS: { label: string; scope: RegExp; re: RegExp }[] = [
  { label: "Checkout", scope: /^(checkout|selectable)$/, re: /checkout|order complete|confirmation page/i },
  { label: "Bag", scope: /^(cart|carts|bag)$/, re: /\bcart\b|\bbag\b|add[- ]to[- ]bag/i },
  { label: "Category pages", scope: /^(category|category-related|navigation|products|discovery)$/, re: /categor|product listing|product list page|\bplp\b|catalog|navigation|storefront/i },
  { label: "Home page", scope: /^(home|homefeed|skinny-banner|header)$/, re: /\bhome|banner|hero|homefeed/i },
  { label: "Product page", scope: /^(pdp|product|images|video)$/, re: /\bpdp\b|product page|product photo|photo|gallery|video|purchase (flow|layout)|reviews|rating/i },
  { label: "Account & orders", scope: /^(account|my-account|account-details|returns|oakra-orders)$/, re: /account|returns|order (history|search)/i },
  { label: "App stability", scope: /^$/, re: /crash|\banr\b|firebase|crashlytics/i },
  { label: "Speed", scope: /^(perf|performance)$/, re: /^perf\b|speed|optimi[sz]|cache|startup|loading|waits|image cdn/i },
];

/** Housekeeping with no customer-facing change: left out of the name. */
const NOISE =
  /^(chore|ci|test|build|docs|style)\b|^"?revert|\((ci|cicd[-\w]*|deploy|deployment|action|flagsmith|build|feature-flag|layout|document|pims|oakra|kcg|carriers|error)\)|add logs|qa reported fixes|^fix: \[[^\]]*\] optimizations$|beanstalk|build (cache|files|run)|memory space|signkey|r8 optimi|sdk update|freshchat|klink|netcore|braze|\[(meta|events)\]|codex|franchise|img permissions|nfe case/i;

const scopeOf = (title: string) => /^\w+\(([^)]*)\)/.exec(title)?.[1]?.toLowerCase() ?? "";

/** Every feature, in priority order (used to break ties in the name). */
export const FEATURE_ORDER = [...SPECIFIC.map((f) => f.label), ...AREAS.map((f) => f.label)];

/** The feature a PR title belongs to, or null for housekeeping / unrecognised titles. */
export function prFeature(title: string): string | null {
  const t = title.trim();
  if (NOISE.test(t)) return null;
  const specific = SPECIFIC.find((f) => f.re.test(t));
  if (specific) return specific.label;
  const scope = scopeOf(t);
  return (scope && AREAS.find((f) => f.scope.test(scope))?.label) || AREAS.find((f) => f.re.test(t))?.label || null;
}

// tracking is matched early (so "track purchases after payment" isn't called Payments) but ranks with the broad areas
const SPECIFIC_LABELS = new Set(SPECIFIC.map((f) => f.label).filter((l) => l !== "Cookie consent & tracking"));
const REVERT = /^"?revert:?\s*(?:\[[^\]]*\]\s*)?(?:revert\s*)?"(.+?)"/i;

/**
 * Every customer-facing feature in a release, most telling first: specific features before broad areas,
 * then by weight (a new feature counts double a fix), ties in FEATURE_ORDER. A PR and its revert in the
 * same release cancel out.
 */
export function releaseFeatures(titles: string[]): string[] {
  const live = [...titles];
  for (const t of titles) {
    const m = REVERT.exec(t.trim());
    // the reverted title may be quoted in full or only its subject (without the type/ticket prefix)
    const i = m ? live.findIndex((x) => x !== t && x.includes(m[1])) : -1;
    if (i >= 0) live.splice(i, 1);
  }
  const weight = new Map<string, number>();
  for (const t of live) {
    const f = prFeature(t);
    if (f) weight.set(f, (weight.get(f) ?? 0) + (/^feat\b/i.test(t.trim()) ? 2 : 1));
  }
  return [...weight]
    .sort((a, b) => Number(SPECIFIC_LABELS.has(b[0])) - Number(SPECIFIC_LABELS.has(a[0])) || b[1] - a[1] || FEATURE_ORDER.indexOf(a[0]) - FEATURE_ORDER.indexOf(b[0]))
    .map(([f]) => f);
}

/** A short, specific release name: the first `max` features, then "+N more"; `fallback` when no PR is customer-facing. */
export function featureName(titles: string[], fallback: string, max = 3): string {
  const ranked = releaseFeatures(titles);
  if (!ranked.length) return fallback;
  const shown = ranked.slice(0, max).join(" · ");
  return ranked.length > max ? `${shown} +${ranked.length - max} more` : shown;
}
