// D6 Core Web Vitals from the Chrome UX Report API (origin + representative URLs per section).
// Field data, 28-day rolling, p75. Requires CRUX_API_KEY; otherwise the panel shows "source not connected".
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export function cruxConfigured() {
  return Boolean(process.env.CRUX_API_KEY);
}

type Metric = "largest_contentful_paint" | "interaction_to_next_paint" | "cumulative_layout_shift";
export type Vitals = { key: string; label: string; formFactor: "PHONE" | "DESKTOP"; lcp: number | null; inp: number | null; cls: number | null; status: "ok" | "no data" };

let cache: { at: number; data: Vitals[] } | null = null;

async function query(body: Record<string, unknown>) {
  const r = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${process.env.CRUX_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"] }),
  });
  if (r.status === 404) return null; // not enough traffic for CrUX
  if (!r.ok) throw new Error(`CrUX ${r.status}`);
  const j = await r.json();
  const p75 = (m: Metric) => {
    const v = j.record?.metrics?.[m]?.percentiles?.p75;
    return v == null ? null : Number(v);
  };
  return { lcp: p75("largest_contentful_paint"), inp: p75("interaction_to_next_paint"), cls: p75("cumulative_layout_shift") };
}

export async function fetchVitals(): Promise<Vitals[]> {
  if (!cruxConfigured()) return [];
  if (cache && Date.now() - cache.at < 6 * 3600_000) return cache.data;
  const cfg = parse(readFileSync(path.join(process.cwd(), "config/sections.yml"), "utf8")) as { origin: string; crux_urls: Record<string, string> };
  const out: Vitals[] = [];
  const targets: [string, string, Record<string, string>][] = [["origin", "Whole origin", { origin: cfg.origin }]];
  for (const [section, url] of Object.entries(cfg.crux_urls ?? {})) targets.push([section, section, { url }]);
  for (const [key, label, target] of targets) {
    for (const formFactor of ["PHONE", "DESKTOP"] as const) {
      const v = await query({ ...target, formFactor });
      out.push({ key, label, formFactor, lcp: v?.lcp ?? null, inp: v?.inp ?? null, cls: v?.cls ?? null, status: v ? "ok" : "no data" });
    }
  }
  cache = { at: Date.now(), data: out };
  return out;
}
