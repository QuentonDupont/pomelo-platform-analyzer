import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addDays,
  aggregate,
  completeWeeks,
  DailyRow,
  filterRows,
  funnelOpportunities,
  HourlyRow,
  mondayOf,
  priorWindow,
  rankOpportunities,
  rates,
  resolveRange,
  revenueDecomposition,
  webOpportunities,
} from "../lib/compute";
import { bootstrapRatioDiff, newcombeDiff, normalizePlatform } from "../server/metrics/definitions";
import { inferSurface, parsePrBody } from "../server/metrics/release-metric";
import { computeImpact } from "../server/impact";

const M = ["TH", "SG", "HK", "GL", "AU"] as const;
function row(day: string, platform: DailyRow["platform"], device: DailyRow["device"], market: DailyRow["market"], total: number, bounces: number, orders: number, revenue: number): DailyRow {
  return { day, platform, device, market, total, bounces, nb: total - bounces, s_orders: orders, s_revenue: revenue, e_orders: orders, e_revenue: revenue };
}
/** 35 days of deterministic synthetic aggregates. */
function fixture(): DailyRow[] {
  const out: DailyRow[] = [];
  for (let i = 0; i < 35; i++) {
    const d = addDays("2026-08-31", i);
    for (const m of M) {
      const k = m === "TH" ? 4 : 1;
      out.push(row(d, "web", "mobile", m, 400 * k, Math.round(400 * k * 0.8), k, 40 * k));
      out.push(row(d, "web", "desktop", m, 200 * k, Math.round(200 * k * 0.7), k, 45 * k));
      out.push(row(d, "ios", "app", m, 300 * k, Math.round(300 * k * 0.4), 2 * k, 90 * k));
      out.push(row(d, "android", "app", m, 100 * k, Math.round(100 * k * 0.42), k, 40 * k));
    }
    out.push(row(d, "unknown", "unknown", "TH", 20, 20, 0, 0));
  }
  return out;
}
const rows = fixture();

describe("App = iOS + Android (cache rows)", () => {
  it("holds for every metric over any range and market set", () => {
    for (const markets of [[...M], ["TH"], ["SG", "AU"]] as DailyRow["market"][][]) {
      const f = { from: "2026-09-01", to: "2026-09-20", markets, device: "all" as const };
      const app = aggregate(filterRows(rows, { ...f, platform: "app" }), "backend");
      const ios = aggregate(filterRows(rows, { ...f, platform: "ios" }), "backend");
      const and = aggregate(filterRows(rows, { ...f, platform: "android" }), "backend");
      for (const k of ["total", "bounces", "nb", "orders", "revenue"] as const) expect(app[k]).toBeCloseTo(ios[k] + and[k], 6);
    }
  });
  it("unknown platform stays out of Web and App", () => {
    const f = { from: "2026-09-01", to: "2026-09-01", markets: ["TH"] as DailyRow["market"][], device: "all" as const };
    const all = aggregate(filterRows(rows, { ...f, platform: "all" }), "backend").total;
    const web = aggregate(filterRows(rows, { ...f, platform: "web" }), "backend").total;
    const app = aggregate(filterRows(rows, { ...f, platform: "app" }), "backend").total;
    expect(all).toBe(web + app);
  });
});

describe("hour-precise ranges", () => {
  const hourly: HourlyRow[] = [];
  for (let h = 0; h < 24; h++) hourly.push({ ...row("2026-09-10", "web", "mobile", "TH", 10, 8, 0, 0), hour: h, e_orders: null, s_orders: null, e_revenue: null, s_revenue: null });
  it("whole days use daily totals", () => {
    const r = resolveRange(rows, hourly, "2026-09-08T00:00", "2026-09-09T23:00");
    expect(r.partialDays).toEqual([]);
    expect(aggregate(r.rows, "backend").total).toBe(aggregate(filterRows(rows, { from: "2026-09-08", to: "2026-09-09", platform: "all", markets: [...M], device: "all" }), "backend").total + 40);
  });
  it("partial days sum the chosen hours (To-hour inclusive)", () => {
    const r = resolveRange(rows, hourly, "2026-09-10T09:00", "2026-09-10T17:00");
    expect(r.partialDays[0]).toMatchObject({ day: "2026-09-10", fromHour: 9, toHour: 17, precision: "hour", orders: "unavailable" });
    expect(aggregate(r.rows, "backend").total).toBe(90);
    expect(r.ordersUnavailable).toBe(true);
  });
  it("partial day without hourly data is flagged rounded-to-day, never silently", () => {
    const r = resolveRange(rows, hourly, "2026-09-11T09:00", "2026-09-12T23:00");
    expect(r.partialDays[0]).toMatchObject({ day: "2026-09-11", precision: "rounded-to-day" });
  });
  it("prior window has the same length to the hour", () => {
    expect(priorWindow("2026-09-10T09:00", "2026-09-10T17:00")).toEqual({ from: "2026-09-10T00:00", to: "2026-09-10T08:00" });
    expect(priorWindow("2026-09-14T00:00", "2026-09-20T23:00")).toEqual({ from: "2026-09-07T00:00", to: "2026-09-13T23:00" });
  });
});

describe("weeks", () => {
  it("Monday of a date and complete weeks only", () => {
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    const days = [...new Set(rows.map((r) => r.day))].sort();
    expect(completeWeeks(days, "2026-10-08")).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(completeWeeks(days, "2026-10-04")).not.toContain("2026-09-28");
  });
});

describe("decision layer maths", () => {
  it("LMDI parts sum exactly to the revenue change", () => {
    const a = aggregate(filterRows(rows, { from: "2026-09-14", to: "2026-09-20", platform: "web", markets: [...M], device: "all" }), "backend");
    const b = { ...a, nb: a.nb * 0.9, orders: a.orders * 0.85, revenue: a.revenue * 0.7 };
    const d = revenueDecomposition(a, b)!;
    expect(d.traffic + d.conversion + d.aov).toBeCloseTo(d.total, 6);
    expect(Math.abs(d.aov)).toBeGreaterThan(0);
  });
  it("revenue at stake: web mobile vs app benchmark, scaled to a week", () => {
    const f = { from: "2026-09-14", to: "2026-09-20", platform: "web" as const, markets: ["TH"] as DailyRow["market"][], device: "all" as const };
    const opps = webOpportunities(rows, f, "app", "backend");
    const mob = opps.find((o) => o.key === "seg-TH-mobile")!;
    const appBr = rates(aggregate(filterRows(rows, { ...f, platform: "app" }), "backend")).bounce_rate!;
    const web = aggregate(filterRows(rows, f), "backend");
    const expected = 1600 * 7 * (0.8 - appBr) * (4 * 7) / (1600 * 7 * 0.2) * (rates(web).aov ?? 0);
    expect(mob.recoverable).toBeCloseTo(1600 * 7 * (0.8 - appBr), 3);
    expect(mob.ras).toBeCloseTo(expected, 3);
  });
  it("low-confidence items are never ranked first", () => {
    const base = { label: "", kind: "segment" as const, sessions: 1, current: 0, benchmark: 0, benchLabel: "", recoverable: 0, hypothesis: "", metric: "", evidenced: true };
    const ranked = rankOpportunities([
      { ...base, key: "low", ras: 1000, conf: "Low" },
      { ...base, key: "med", ras: 10, conf: "Medium" },
    ]);
    expect(ranked[0].key).toBe("med");
  });
  it("funnel step loss uses the app step rate as benchmark", () => {
    const web = [
      { stage: "PDP", stage_order: 1, sessions: 1000 },
      { stage: "ATB", stage_order: 2, sessions: 100 },
    ];
    const app = [
      { stage: "PDP", stage_order: 1, sessions: 1000 },
      { stage: "ATB", stage_order: 2, sessions: 200 },
    ];
    const [o] = funnelOpportunities(web, app, 10, 40, 1);
    expect(o.recoverable).toBeCloseTo(100);
    expect(o.ras).toBeCloseTo(100 * (10 / 100) * 40);
  });
});

describe("intervals", () => {
  it("Newcombe difference contains the point estimate and excludes 0 for a clear change", () => {
    const ci = newcombeDiff(500, 1000, 600, 1000)!;
    expect(ci[0]).toBeLessThan(0.1);
    expect(ci[1]).toBeGreaterThan(0.1);
    expect(ci[0]).toBeGreaterThan(0);
  });
  it("bootstrap is deterministic and brackets the true difference", () => {
    const before = Array.from({ length: 14 }, (_, i) => ({ num: 100 + (i % 3), den: 10 }));
    const after = Array.from({ length: 14 }, (_, i) => ({ num: 120 + (i % 3), den: 10 }));
    const a = bootstrapRatioDiff(before, after)!;
    expect(bootstrapRatioDiff(before, after)).toEqual(a);
    expect(a[0]).toBeLessThan(2.0001);
    expect(a[1]).toBeGreaterThan(1.9999);
  });
});

describe("release success metric", () => {
  it("parses the PR template line and decision ids", () => {
    const p = parsePrBody("Fixes stuff\nSuccess metric: PDP add to bag rate | Surface: pdp | Platform: web | Expected direction: up\nRefs DEC-12")!;
    expect(p).toMatchObject({ metric: "pdp_to_atb", surface: "pdp", platform: "web", direction: "up", decisionIds: ["DEC-12"] });
    expect(parsePrBody("no metric here")).toBeNull();
  });
  it("infers surface from changed paths", () => {
    expect(inferSurface(["components/pdp", "components/pdp", "lib/i18n"])).toBe("pdp");
    expect(inferSurface(["README.md"])).toBe("platform");
  });
  it("impact: clear bounce increase after go-live on web reads as moved opposite (down expected)", () => {
    const shifted = rows.map((r) => (r.platform === "web" && r.day >= "2026-09-21" ? { ...r, bounces: Math.min(r.total, Math.round(r.total * 0.9)), nb: r.total - Math.min(r.total, Math.round(r.total * 0.9)) } : r));
    const i = computeImpact(shifted, "web", "2026-09-21", "bounce_rate", "down", [...M], "2026-10-20", "backend");
    expect(i.computable).toBe(true);
    expect(i.verdict).toBe("moved opposite");
    expect(i.ci![0]).toBeGreaterThan(0);
    const young = computeImpact(shifted, "web", "2026-10-02", "bounce_rate", "down", [...M], "2026-10-05", "backend");
    expect(young.verdict).toBe("immature");
  });
});

describe("platform mapping", () => {
  it("maps source spellings and keeps unknown separate", () => {
    expect(normalizePlatform("Web Mobile")).toEqual({ platform: "web", device: "mobile" });
    expect(normalizePlatform("iOS")).toEqual({ platform: "ios", device: "app" });
    expect(normalizePlatform(null)).toEqual({ platform: "unknown", device: "unknown" });
  });
});

describe("snapshot import is idempotent", () => {
  it("re-importing the same snapshot does not double count", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ppa-"));
    mkdirSync(path.join(dir, "discovery/snapshots"), { recursive: true });
    writeFileSync(
      path.join(dir, "discovery/snapshots/traffic_daily.json"),
      JSON.stringify({ source: "test", as_of: "2026-10-08", rows: [{ day: "2026-09-01", platform: "iOS", id_shop: 1, total_sessions: 100, bounces: 40, non_bounces: 60, gross_orders: 2, revenue_usd: 80 }, { day: "2026-09-01", platform: "iOS", id_shop: 5, total_sessions: 9, bounces: 1, non_bounces: 8 }] }),
    );
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const { resetDbForTests } = await import("../server/cache/db");
      const db = resetDbForTests();
      const { importTrafficDaily } = await import("../server/jobs/import-snapshots");
      expect(importTrafficDaily()).toBe(1); // shop 5 (Indonesia) is out of scope and dropped
      importTrafficDaily();
      const r = db.prepare("SELECT COUNT(*) n, SUM(total_sessions) s FROM traffic_daily").get() as { n: number; s: number };
      expect(r).toEqual({ n: 1, s: 100 });
    } finally {
      process.chdir(cwd);
    }
  });
});
