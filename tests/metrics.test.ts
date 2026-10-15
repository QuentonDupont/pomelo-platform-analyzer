import { describe, expect, it } from "vitest";
import { derived, isImmature, lmdi, revenueAtStake, sum, wilson } from "../lib/metrics";
import { allocate, buildSample, CEO_BRIEF } from "../lib/sample";

const cells = buildSample();
const tot = (week: string, pred: (c: (typeof cells)[number]) => boolean) => sum(cells.filter((c) => c.week === week && pred(c)));

describe("fixture reconciles to CEO brief", () => {
  for (const w of ["2026-09-14", "2026-09-28"] as const) {
    it(`App (iOS+Android) ${w}`, () => {
      const t = tot(w, (c) => c.platform === "ios" || c.platform === "android");
      expect([t.nonbounce_sessions, t.orders]).toEqual([...CEO_BRIEF.app[w]]);
    });
    it(`Web 5 markets ${w}`, () => {
      const t = tot(w, (c) => c.platform === "web");
      expect([t.nonbounce_sessions, t.orders]).toEqual([...CEO_BRIEF.web[w]]);
    });
    it(`TH web ${w}`, () => {
      const t = tot(w, (c) => c.platform === "web" && c.market === "TH");
      expect([t.nonbounce_sessions, t.orders]).toEqual([...CEO_BRIEF.th_web[w]]);
    });
  }
  it("non-bounce CR matches brief (app 1.278%→1.303%, web 0.5224%→0.4656%, TH web 0.4935%→0.5398%)", () => {
    const cr = (w: string, p: (c: (typeof cells)[number]) => boolean) => derived(tot(w, p)).nonbounce_cr! * 100;
    const app = (c: (typeof cells)[number]) => c.platform === "ios" || c.platform === "android";
    expect(cr("2026-09-14", app)).toBeCloseTo(1.278, 3);
    expect(cr("2026-09-28", app)).toBeCloseTo(1.303, 3);
    expect(cr("2026-09-14", (c) => c.platform === "web")).toBeCloseTo(0.5224, 4);
    expect(cr("2026-09-28", (c) => c.platform === "web")).toBeCloseTo(0.4656, 4);
    expect(cr("2026-09-28", (c) => c.platform === "web" && c.market === "TH")).toBeCloseTo(0.5398, 4);
  });
});

describe("App = iOS + Android", () => {
  it("holds for every week and metric", () => {
    for (const w of ["2026-09-14", "2026-09-21", "2026-09-28"]) {
      const app = tot(w, (c) => c.platform === "ios" || c.platform === "android");
      const ios = tot(w, (c) => c.platform === "ios");
      const and = tot(w, (c) => c.platform === "android");
      for (const k of Object.keys(app) as (keyof typeof app)[]) expect(app[k]).toBeCloseTo(ios[k] + and[k], 6);
    }
  });
  it("unknown platform is its own bucket, not folded into App or Web", () => {
    expect(cells.some((c) => c.platform === "unknown")).toBe(true);
  });
});

describe("metric primitives", () => {
  it("allocate sums exactly", () => {
    expect(allocate(101, [1, 1, 1]).reduce((a, b) => a + b)).toBe(101);
  });
  it("wilson interval brackets p", () => {
    const [lo, hi] = wilson(40, 100)!;
    expect(lo).toBeLessThan(0.4);
    expect(hi).toBeGreaterThan(0.4);
    expect(lo).toBeCloseTo(0.3094, 3);
    expect(hi).toBeCloseTo(0.4980, 3);
  });
  it("revenue at stake formula", () => {
    const r = revenueAtStake({ total_sessions: 1000, bounce_rate: 0.6, benchmark_bounce_rate: 0.5, nonbounce_cr: 0.01, aov: 40 });
    expect(r.recoverable_sessions).toBeCloseTo(100);
    expect(r.revenue_at_stake).toBeCloseTo(40);
    expect(revenueAtStake({ total_sessions: 1000, bounce_rate: 0.4, benchmark_bounce_rate: 0.5, nonbounce_cr: 0.01, aov: 40 }).revenue_at_stake).toBe(0);
  });
  it("LMDI parts sum to total revenue change", () => {
    const d = lmdi({ sessions: 6317, orders: 33, revenue: 1353 }, { sessions: 6014, orders: 28, revenue: 1008 });
    expect(d.traffic + d.conversion + d.aov).toBeCloseTo(d.total, 6);
  });
  it("week ending < 7 days ago is immature", () => {
    expect(isImmature("2026-09-28", "2026-10-08")).toBe(true);
    expect(isImmature("2026-09-21", "2026-10-08")).toBe(false);
  });
});
