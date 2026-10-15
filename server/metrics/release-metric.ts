// Per-release success metric: declared in the PR body, else inferred from changed paths.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export { METRIC_LABEL } from "./metric-labels";
export type { Direction, MetricId } from "./metric-labels";
import type { Direction, MetricId } from "./metric-labels";

export interface DeclaredMetric {
  metric: MetricId | null;
  raw: string;
  surface: string | null;
  platform: string | null;
  direction: Direction | null;
  decisionIds: string[];
}

const METRIC_KEYWORDS: [RegExp, MetricId][] = [
  [/bounce/i, "bounce_rate"],
  [/pdp.*(atb|add)|add[- ]?to[- ]?(bag|cart)/i, "pdp_to_atb"],
  [/checkout.*pay|payment/i, "checkout_to_payment"],
  [/(atb|bag|cart).*checkout|checkout start/i, "atb_to_checkout"],
  [/aov|basket|order value/i, "aov"],
  [/revenue per|rev\/|rps/i, "rev_per_nb_session"],
  [/conversion|\bcr\b|cvr/i, "nonbounce_cr"],
];

/** Parse `Success metric: <metric> | Surface: <section> | Platform: <p> | Expected direction: up/down` and DEC-n ids. */
export function parsePrBody(body: string | null | undefined): DeclaredMetric | null {
  const text = body ?? "";
  const decisionIds = [...new Set([...text.matchAll(/\bDEC-(\d+)\b/gi)].map((m) => `DEC-${m[1]}`))];
  const line = text.split(/\r?\n/).find((l) => /success metric\s*:/i.test(l));
  if (!line) return decisionIds.length ? { metric: null, raw: "", surface: null, platform: null, direction: null, decisionIds } : null;
  const field = (name: string) => {
    const m = line.match(new RegExp(`${name}\\s*:\\s*([^|]+)`, "i"));
    return m ? m[1].trim() : null;
  };
  const raw = field("success metric") ?? "";
  const dir = (field("expected direction") ?? "").toLowerCase();
  const metric = METRIC_KEYWORDS.find(([re]) => re.test(raw))?.[1] ?? null;
  return {
    metric,
    raw,
    surface: field("surface")?.toLowerCase() ?? null,
    platform: field("platform")?.toLowerCase() ?? null,
    direction: dir.startsWith("up") ? "up" : dir.startsWith("down") ? "down" : null,
    decisionIds,
  };
}

type PathMap = {
  rules: { pattern: string; surface: string }[];
  surface_metrics: Record<string, { metric: MetricId; direction: Direction }>;
};
let cached: PathMap | null = null;
export function pathMap(): PathMap {
  if (!cached) cached = parse(readFileSync(path.join(process.cwd(), "config/path-map.yml"), "utf8")) as PathMap;
  return cached;
}

/** Most frequent surface across changed paths; "platform" when nothing matches. */
export function inferSurface(paths: string[], map: PathMap = pathMap()): string {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const lower = p.toLowerCase();
    const rule = map.rules.find((r) => new RegExp(r.pattern).test(lower));
    if (rule) counts.set(rule.surface, (counts.get(rule.surface) ?? 0) + 1);
  }
  let best = "platform";
  let n = 0;
  for (const [s, c] of counts) if (c > n) [best, n] = [s, c];
  return best;
}

export function defaultMetricFor(surface: string, map: PathMap = pathMap()) {
  return map.surface_metrics[surface] ?? map.surface_metrics.platform;
}
