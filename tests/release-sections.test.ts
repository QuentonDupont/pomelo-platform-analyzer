import { describe, expect, it } from "vitest";
import { addDays, DailyRow } from "../lib/compute";
import { classifyPr, scopesFor, sectionImpact } from "../lib/release-sections";

describe("release → section mapping", () => {
  it("maps real PR titles to funnel sections", () => {
    expect(classifyPr("fix(navigation): [TECH-13] bypass retained catalog redirects", [])).toEqual(["product_list"]);
    expect(classifyPr("feat(pre-order): [BUSK-2838] Implement Pre-Order on product pages", [])).toEqual(["pdp"]);
    expect(classifyPr("fix(cart): [TECH-29] prioritise sign in over guest checkout in the bag", [])).toEqual(["cart", "checkout", "account"]);
    expect(classifyPr("[PRDT-11759] Restore full-width desktop homepage banner artwork", ["components/editorial"])).toEqual(["home_feed"]);
    expect(classifyPr("fix(kcg): Log kcg-order-sync errors on payment status", [])).toEqual(["checkout"]);
    expect(classifyPr("fix(best-sellers): [PRDT-000] Remove categories with <5 items", [])).toEqual(["product_list"]);
  });
  it("falls back to changed folders, then to platform", () => {
    expect(classifyPr("misc tidy-up", ["components/search"])).toEqual(["search"]);
    expect(classifyPr("fix(i18n): ship only the page language", ["lib/i18n"])).toEqual(["platform"]);
  });
  it("backend releases are measured on web and both apps", () => {
    expect(scopesFor("backend").map((s) => s.key)).toEqual(["web", "ios", "android"]);
    expect(scopesFor("ios").map((s) => s.key)).toEqual(["ios"]);
  });
});

// 20 days of web PDP traffic: add-to-bag rate 2% before 2026-09-11, 4% from then on
function rows(): DailyRow[] {
  const out: DailyRow[] = [];
  for (let i = 0; i < 20; i++) {
    const day = addDays("2026-09-01", i);
    const pdp = 1000 + (i % 3) * 10;
    const atb = Math.round(pdp * (day >= "2026-09-11" ? 0.04 : 0.02));
    out.push({ day, platform: "web", device: "mobile", market: "TH", total: 2000, bounces: 1500, nb: 500, s_orders: 5, s_revenue: 200, e_orders: 5, e_revenue: 200, pdp, atb, lists: 3000, clicks: 900, searches: 40 });
  }
  return out;
}

describe("range-driven release impact", () => {
  const range = { from: "2026-09-01", to: "2026-09-20" };
  const cmp = { from: "2026-08-12", to: "2026-08-31" };
  it("compares the range before go-live with the range after it", () => {
    const i = sectionImpact(rows(), "2026-09-11", "pdp", "web", range, cmp, ["TH"]);
    expect(i.before).toMatchObject({ from: "2026-09-01", to: "2026-09-10", days: 10, label: "range before go-live" });
    expect(i.after).toMatchObject({ from: "2026-09-11", to: "2026-09-20", days: 10 });
    expect(i.diff).toBeCloseTo(0.02, 3);
    expect(i.verdict).toBe("better");
  });
  it("changes when the date range changes", () => {
    const narrow = sectionImpact(rows(), "2026-09-11", "pdp", "web", { from: "2026-09-09", to: "2026-09-13" }, cmp, ["TH"]);
    expect(narrow.before.label).toBe("comparison period"); // fewer than 3 days before go-live in range
    expect(narrow.after).toMatchObject({ from: "2026-09-11", to: "2026-09-13", days: 3 });
  });
  it("reports missing data instead of inventing a change", () => {
    expect(sectionImpact(rows(), "2026-09-11", "pdp", "ios", range, cmp, ["TH"]).verdict).toBe("no data");
  });
});
