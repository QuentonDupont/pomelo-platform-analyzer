import { describe, expect, it } from "vitest";
import { addDays, DailyRow } from "../lib/compute";
import { ceoByMarket, ceoJourney, ceoReleases, ceoScorecard, ceoVerdict, ceoWeeks, FunnelLike, ReleaseLike, weekAgg } from "../lib/ceo";

// Two consecutive weeks reproducing the exact reference numbers (all channels, all markets):
//   week of 2026-09-28: visits 64,839, bounces 46,315 (71.43%), non-bounce 18,524, orders 191, revenue $10,520.63
//   week of 2026-09-21: visits 91,392, bounces 71,015, non-bounce 20,377, orders 195, revenue $13,382.79
// By channel, week of 2026-09-28: App non-bounce 12,510 / orders 163; Web non-bounce 6,014 / orders 28.
// One row per channel per week is enough — aggregate() only sums whatever rows fall in [from, to].
function salesFixture(): DailyRow[] {
  const row = (day: string, platform: DailyRow["platform"], total: number, bounces: number, nb: number, orders: number, revenue: number): DailyRow => ({
    day,
    platform,
    device: platform === "web" ? "mobile" : "app",
    market: "TH",
    total,
    bounces,
    nb,
    s_orders: orders,
    s_revenue: revenue,
    e_orders: orders,
    e_revenue: revenue,
  });
  return [
    row("2026-09-28", "ios", 20916, 8406, 12510, 163, 10520.63),
    row("2026-09-28", "web", 43923, 37909, 6014, 28, 0),
    row("2026-09-21", "web", 91392, 71015, 20377, 195, 13382.79),
  ];
}

describe("ceoWeeks", () => {
  it("returns the complete weeks plus a trailing partial week", () => {
    const { weeks, partial } = ceoWeeks(["2026-09-14", "2026-09-21"], ["2026-09-14", "2026-09-15", "2026-09-28", "2026-09-29"]);
    expect(weeks).toEqual(["2026-09-14", "2026-09-21"]);
    expect(partial).toEqual({ week: "2026-09-28", daysIn: 2 });
  });
  it("has no partial week when the latest day's Monday is already complete", () => {
    const { partial } = ceoWeeks(["2026-09-14", "2026-09-21"], ["2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(partial).toBeNull();
  });
});

describe("week-over-week numbers (all channels, all markets)", () => {
  const rows = salesFixture();
  const cur = weekAgg(rows, "2026-09-28", "all", ["TH", "SG", "HK", "GL", "AU"], "backend");
  const prev = weekAgg(rows, "2026-09-21", "all", ["TH", "SG", "HK", "GL", "AU"], "backend");

  it("matches the reference totals exactly", () => {
    expect(cur.total).toBe(64839);
    expect(cur.bounces).toBe(46315);
    expect(cur.nb).toBe(18524);
    expect(cur.orders).toBe(191);
    expect(cur.revenue).toBeCloseTo(10520.63, 2);
    expect(prev.total).toBe(91392);
    expect(prev.orders).toBe(195);
    expect(prev.revenue).toBeCloseTo(13382.79, 2);
  });

  it("matches the reference deltas", () => {
    expect(((cur.revenue - prev.revenue) / prev.revenue) * 100).toBeCloseTo(-21.4, 1);
    expect(((cur.orders - prev.orders) / prev.orders) * 100).toBeCloseTo(-2.1, 1);
    expect(((cur.total - prev.total) / prev.total) * 100).toBeCloseTo(-29.1, 1);
    const bouncePts = (cur.bounces / cur.total - prev.bounces / prev.total) * 100;
    expect(bouncePts).toBeCloseTo(-6.27, 2);
    const convPts = (cur.orders / cur.nb - prev.orders / prev.nb) * 100;
    expect(convPts).toBeCloseTo(0.07, 2);
  });

  it("the verdict sentence reflects the real/not-real split and the right directions", () => {
    const [line1, line2] = ceoVerdict({ channel: "all", market: "all", period: { kind: "week", week: "2026-09-28" }, cur, prev, isPartial: false });
    expect(line1).toContain("$10,520.63");
    expect(line1).toContain("191 orders");
    expect(line1).toContain("down 21.4%");
    expect(line2).toMatch(/1\.031%/);
    expect(line2).toContain("within normal ups and downs"); // conversion +0.07 pts is not real
    expect(line2).not.toMatch(/a real (rise|drop)/);
    expect(line2).toContain("fewer than the week before"); // bounce rate dropped and is real
  });

  it("the scorecard tiles carry the right change + real flag", () => {
    const tiles = ceoScorecard(cur, prev, false, false, [prev, cur]);
    const bounce = tiles.find((t) => t.key === "bounce_rate")!;
    expect(bounce.change.tone).toBe("good"); // bounce down is good
    expect(bounce.change.text).not.toContain("normal ups and downs");
    const conv = tiles.find((t) => t.key === "nonbounce_cr")!;
    expect(conv.change.tone).toBe("flat");
    expect(conv.change.text).toContain("normal ups and downs");
    const sales = tiles.find((t) => t.key === "revenue")!;
    expect(sales.change.tone).toBe("bad"); // sales down, "up" is good for revenue
    expect(sales.change.text).toContain("21.4%");
  });

  it("omits count deltas for a partial week or the first week", () => {
    const partial = ceoScorecard(cur, prev, true, false, [prev, cur]);
    expect(partial.find((t) => t.key === "revenue")!.change.text).toBe("Week in progress");
    const first = ceoScorecard(cur, null, false, true, [cur]);
    expect(first.find((t) => t.key === "orders")!.change.text).toBe("No week before to compare");
  });

  it("splits by channel into the exact App/Web non-bounce and order counts", () => {
    const app = weekAgg(rows, "2026-09-28", "app", ["TH", "SG", "HK", "GL", "AU"], "backend");
    const web = weekAgg(rows, "2026-09-28", "web", ["TH", "SG", "HK", "GL", "AU"], "backend");
    expect(app.nb).toBe(12510);
    expect(app.orders).toBe(163);
    expect(web.nb).toBe(6014);
    expect(web.orders).toBe(28);
  });

  it("by-market breakdown sums back to the channel total", () => {
    const byMarket = ceoByMarket(rows, "2026-09-28", "all", "2026-09-21", "backend");
    const salesSum = byMarket.reduce((a, r) => a + r.sales, 0);
    expect(salesSum).toBeCloseTo(10520.63, 2);
  });
});

describe("ceoJourney", () => {
  function funnelFixture(): FunnelLike[] {
    return [
      { week: "2026-08-31", platform: "web", stage_order: 3, sessions: 1 }, // earliest week, for the "starts" caveat
      { week: "2026-09-28", platform: "web", stage_order: 3, sessions: 7000 },
      { week: "2026-09-28", platform: "web", stage_order: 4, sessions: 6500 },
      { week: "2026-09-28", platform: "web", stage_order: 6, sessions: 1000 },
      { week: "2026-09-28", platform: "web", stage_order: 12, sessions: 140 },
      { week: "2026-09-28", platform: "ios", stage_order: 3, sessions: 2472 },
      { week: "2026-09-28", platform: "ios", stage_order: 4, sessions: 2119 },
      { week: "2026-09-28", platform: "ios", stage_order: 6, sessions: 412 },
      { week: "2026-09-28", platform: "ios", stage_order: 12, sessions: 56 },
      { week: "2026-09-28", platform: "android", stage_order: 3, sessions: 1000 },
      { week: "2026-09-28", platform: "android", stage_order: 4, sessions: 1000 },
      { week: "2026-09-28", platform: "android", stage_order: 6, sessions: 100 },
      { week: "2026-09-28", platform: "android", stage_order: 12, sessions: 10 },
    ];
  }
  const week = (w: string) => ({ from: w, to: addDays(w, 6) });
  it("sums Browsed/Opened/Added/Placed across all channels for the week", () => {
    const { steps, weeks, minWeek } = ceoJourney(funnelFixture(), week("2026-09-28"), "all");
    expect(steps.map((s) => s.sessions)).toEqual([10472, 9619, 1512, 206]);
    expect(steps.map((s) => s.label)).toEqual(["Browsed products", "Opened a product", "Added to bag", "Placed an order"]);
    expect(weeks).toEqual(["2026-09-28"]);
    expect(minWeek).toBe("2026-08-31");
  });
  it("filters to one channel's platforms", () => {
    const { steps } = ceoJourney(funnelFixture(), week("2026-09-28"), "web");
    expect(steps[0].sessions).toBe(7000);
  });
  it("sums every week that overlaps a multi-week range", () => {
    const { steps, weeks } = ceoJourney(funnelFixture(), { from: "2026-09-01", to: "2026-09-30" }, "web");
    expect(weeks).toEqual(["2026-08-31", "2026-09-28"]);
    expect(steps[0].sessions).toBe(7001);
  });
  it("leaves out weeks outside the range", () => {
    const { steps, weeks } = ceoJourney(funnelFixture(), { from: "2026-09-07", to: "2026-09-20" }, "all");
    expect(weeks).toEqual([]);
    expect(steps.every((s) => s.sessions === 0)).toBe(true);
  });
});

describe("ceoReleases", () => {
  // android: flat 2% conversion all through -> every android release this week is "no clear change".
  // web: flat 2% conversion (device=mobile only, so web_mobile always matches web and gets deduped).
  // ios: low (1%) Sep14-20 -> high (15%) Sep21-26 -> low (1%) Sep27-Oct3: a release dated 21/22/23 sees a
  // clear rise (Helped); a release dated 27 sees a clear drop back to low (Hurt).
  function row(day: string, platform: DailyRow["platform"], device: DailyRow["device"], nb: number, orders: number): DailyRow {
    return { day, platform, device, market: "TH", total: nb, bounces: 0, nb, s_orders: orders, s_revenue: orders * 50, e_orders: orders, e_revenue: orders * 50 };
  }
  function fixture(): { daily: DailyRow[]; releases: ReleaseLike[] } {
    const daily: DailyRow[] = [];
    for (let d = "2026-09-01"; d <= "2026-10-15"; d = addDays(d, 1)) {
      daily.push(row(d, "android", "app", 1000, 20));
      daily.push(row(d, "web", "mobile", 800, 16));
    }
    for (let d = "2026-09-14"; d <= "2026-09-20"; d = addDays(d, 1)) daily.push(row(d, "ios", "app", 1000, 10));
    for (let d = "2026-09-21"; d <= "2026-09-26"; d = addDays(d, 1)) daily.push(row(d, "ios", "app", 1000, 150));
    for (let d = "2026-09-27"; d <= "2026-10-03"; d = addDays(d, 1)) daily.push(row(d, "ios", "app", 1000, 10));

    let n = 0;
    const mk = (date: string, platform: string): ReleaseLike => ({ id: `r${++n}`, repo: "pomelofashion/test", release_id: String(n), platform, bangkok_date: date, go_live_at: null, prs: [{ number: n, title: "chore: test release", dirs: [] }] });
    const releases: ReleaseLike[] = [];
    for (let i = 0; i < 7; i++) releases.push(mk(addDays("2026-09-21", i), "android")); // 7 no-clear
    for (let i = 0; i < 6; i++) releases.push(mk(addDays("2026-09-21", i), "web")); // 6 no-clear (13 total)
    for (const d of ["2026-09-21", "2026-09-22", "2026-09-23"]) releases.push(mk(d, "ios")); // 3 helped
    releases.push(mk("2026-09-27", "ios")); // 1 hurt
    return { daily, releases };
  }

  it("buckets verdicts into Helped/Hurt/No clear effect in the expected counts", () => {
    const { daily, releases } = fixture();
    const rows = ceoReleases(releases, daily, { from: "2026-09-21", to: "2026-09-27" }, { from: "2026-09-14", to: "2026-09-20" });
    expect(rows.length).toBe(17);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.result] = (counts[r.result] ?? 0) + 1;
    expect(counts["Helped"]).toBe(3);
    expect(counts["Hurt"]).toBe(1);
    expect(counts["No clear effect"]).toBe(13);
  });
  it("follows the selected range, not just its first week", () => {
    const { daily, releases } = fixture();
    const firstWeekOnly = ceoReleases(releases, daily, { from: "2026-09-21", to: "2026-09-24" }, { from: "2026-09-17", to: "2026-09-20" });
    expect(new Set(firstWeekOnly.map((r) => r.wentLive))).toEqual(new Set(["21 Sept", "22 Sept", "23 Sept", "24 Sept"]));
    const lateRange = ceoReleases(releases, daily, { from: "2026-09-26", to: "2026-09-30" }, { from: "2026-09-21", to: "2026-09-25" });
    expect(new Set(lateRange.map((r) => r.wentLive))).toEqual(new Set(["26 Sept", "27 Sept"]));
  });
});
