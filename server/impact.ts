// Release impact: change vs baseline with intervals and sample sizes. Never a causal claim.
import { addDays, aggregate, DailyRow, daysBetween, filterRows, OrdersSource, rates } from "@/lib/compute";
import { bootstrapRatioDiff, Market, newcombeDiff } from "./metrics/definitions";
import { MetricId } from "./metrics/release-metric";

export interface ReleaseRow {
  id: string;
  repo: string;
  platform: "web" | "ios" | "android" | "backend";
  release_id: string | null;
  go_live_at: string | null;
  bangkok_date: string;
  signal: string;
  pr_count: number;
  confounded: number;
  note: string | null;
  source: string;
}
export interface PrRow {
  release_key: string;
  number: number;
  title: string;
  merged_at: string | null;
  author: string | null;
  dirs: string;
  success_metric: MetricId;
  surface: string;
  expected_direction: "up" | "down";
  metric_source: string;
  decision_ids: string;
}

export interface Impact {
  scope: "web" | "app";
  metric: MetricId;
  computable: boolean;
  reason?: string;
  baseline: { from: string; to: string; value: number | null; n: number; days: number };
  post: { from: string; to: string; value: number | null; n: number; days: number };
  diff: number | null;
  ci: [number, number] | null;
  ci_method: string;
  maturity: "immature" | "partial" | "complete";
  verdict: "moved as expected" | "moved opposite" | "no clear change" | "not computable" | "immature";
}

const RATE_METRICS: MetricId[] = ["bounce_rate", "nonbounce_cr"];
const BOOT_METRICS: MetricId[] = ["aov", "rev_per_nb_session"];

export function releaseMetric(prs: PrRow[]): { metric: MetricId; direction: "up" | "down"; source: string; surface: string } {
  const declared = prs.find((p) => p.metric_source === "declared");
  if (declared) return { metric: declared.success_metric, direction: declared.expected_direction, source: "declared", surface: declared.surface };
  const counts = new Map<string, number>();
  for (const p of prs) counts.set(`${p.success_metric}|${p.expected_direction}|${p.surface}`, (counts.get(`${p.success_metric}|${p.expected_direction}|${p.surface}`) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return { metric: "nonbounce_cr", direction: "up", source: "default", surface: "platform" };
  const [metric, direction, surface] = best.split("|");
  return { metric: metric as MetricId, direction: direction as "up" | "down", source: "inferred", surface };
}

export function computeImpact(
  rows: DailyRow[],
  scope: "web" | "app",
  goLive: string,
  metric: MetricId,
  direction: "up" | "down",
  markets: Market[],
  today: string,
  src: OrdersSource,
): Impact {
  const latest = rows.reduce((m, r) => (r.day > m ? r.day : m), "");
  const base = { from: addDays(goLive, -14), to: addDays(goLive, -1) };
  const postTo = [addDays(goLive, 13), latest, addDays(today, -1)].sort()[0];
  const post = { from: goLive, to: postTo };
  const postDays = Math.max(0, daysBetween(post.from, post.to) + 1);
  const maturity: Impact["maturity"] = postDays < 7 ? "immature" : postDays < 14 ? "partial" : "complete";
  const f = (w: { from: string; to: string }) => filterRows(rows, { from: w.from, to: w.to, platform: scope, markets, device: "all" });
  const bRows = f(base);
  const pRows = f(post);
  const a = aggregate(bRows, src);
  const b = aggregate(pRows, src);
  const empty = (why: string): Impact => ({
    scope,
    metric,
    computable: false,
    reason: why,
    baseline: { ...base, value: null, n: a.total, days: a.days },
    post: { ...post, value: null, n: b.total, days: b.days },
    diff: null,
    ci: null,
    ci_method: "—",
    maturity,
    verdict: "not computable",
  });
  if (!RATE_METRICS.includes(metric) && !BOOT_METRICS.includes(metric))
    return empty("funnel-step data is not available at daily grain yet (needs RudderStack session events)");
  if (a.days < 7) return empty("fewer than 7 baseline days in the cache");
  if (b.days === 0) return empty("no post-release days in the cache yet");

  let bv: number | null = null,
    pv: number | null = null,
    ci: [number, number] | null = null,
    method = "";
  let bn = a.total,
    pn = b.total;
  if (metric === "bounce_rate") {
    bv = rates(a).bounce_rate;
    pv = rates(b).bounce_rate;
    ci = newcombeDiff(a.bounces, a.total, b.bounces, b.total);
    method = "Newcombe (Wilson) 95%";
  } else if (metric === "nonbounce_cr") {
    if (!a.orders_known || !b.orders_known) return empty("orders not available for this window");
    bv = rates(a).nonbounce_cr;
    pv = rates(b).nonbounce_cr;
    ci = newcombeDiff(a.orders, a.nb, b.orders, b.nb);
    method = "Newcombe (Wilson) 95%";
    bn = a.nb;
    pn = b.nb;
  } else {
    const byDay = (rs: DailyRow[]) => {
      const m = new Map<string, { num: number; den: number }>();
      for (const r of rs) {
        const x = m.get(r.day) ?? { num: 0, den: 0 };
        x.num += (src === "backend" ? r.e_revenue : r.s_revenue) ?? 0;
        x.den += metric === "aov" ? (src === "backend" ? r.e_orders : r.s_orders) ?? 0 : r.nb;
        m.set(r.day, x);
      }
      return [...m.values()];
    };
    bv = metric === "aov" ? rates(a).aov : rates(a).rev_per_nb;
    pv = metric === "aov" ? rates(b).aov : rates(b).rev_per_nb;
    ci = bootstrapRatioDiff(byDay(bRows), byDay(pRows));
    method = "bootstrap over days, 95%";
    if (metric === "aov") {
      bn = a.orders;
      pn = b.orders;
    }
  }
  const diff = bv != null && pv != null ? pv - bv : null;
  let verdict: Impact["verdict"] = "no clear change";
  if (maturity === "immature") verdict = "immature";
  else if (ci && (ci[0] > 0 || ci[1] < 0)) {
    const up = ci[0] > 0;
    verdict = (up && direction === "up") || (!up && direction === "down") ? "moved as expected" : "moved opposite";
  }
  return {
    scope,
    metric,
    computable: true,
    baseline: { ...base, value: bv, n: bn, days: a.days },
    post: { ...post, value: pv, n: pn, days: b.days },
    diff,
    ci,
    ci_method: method,
    maturity,
    verdict,
  };
}

/** Other releases whose go-live falls inside the baseline+post window on an overlapping surface. */
export function confounders(all: ReleaseRow[], r: ReleaseRow) {
  const from = addDays(r.bangkok_date, -14);
  const to = addDays(r.bangkok_date, 13);
  const overlaps = (p: string) => p === r.platform || p === "backend" || r.platform === "backend";
  return all.filter((x) => x.id !== r.id && x.bangkok_date >= from && x.bangkok_date <= to && overlaps(x.platform)).map((x) => ({ id: x.id, repo: x.repo, date: x.bangkok_date }));
}
