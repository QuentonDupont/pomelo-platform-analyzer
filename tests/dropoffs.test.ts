import { describe, expect, it } from "vitest";
import { computeStep, DropoffData, FLOWS, toDropoffData, weeksOverlapping } from "../lib/dropoffs";

const W = "2026-09-28";
const data: DropoffData = toDropoffData(
  [
    // web: 1000 sessions arrive at Cart Viewed, 300 go next to address, 100 skip to payment
    { week: W, platform: "web", source: "Product Added", target: "Cart Viewed", source_stage: 6, target_stage: 7, sessions: 1000 },
    { week: W, platform: "web", source: "Cart Viewed", target: "Shipping Address Selected", source_stage: 7, target_stage: 9, sessions: 300 },
    { week: W, platform: "web", source: "Cart Viewed", target: "Payment Method Selected", source_stage: 7, target_stage: 11, sessions: 100 },
    { week: W, platform: "web", source: "Shipping Address Selected", target: "Payment Method Selected", source_stage: 9, target_stage: 11, sessions: 240 },
    { week: W, platform: "ios", source: "app_feed", target: "Product Viewed", source_stage: 3, target_stage: 4, sessions: 600 },
    { week: W, platform: "ios", source: "app_feed", target: "Cart Viewed", source_stage: 3, target_stage: 7, sessions: 200 },
  ],
  [
    { week: W, platform: "web", market: "TH", signed_in: "false", atc: "true", purchase: "true", sessions: 5 },
    { week: W, platform: "web", market: "TH", signed_in: "false", atc: "true", purchase: "false", sessions: 95 },
    { week: W, platform: "web", market: "TH", signed_in: "true", atc: "true", purchase: "true", sessions: 20 },
    { week: W, platform: "web", market: "TH", signed_in: "true", atc: "true", purchase: "false", sessions: 80 },
    { week: W, platform: "web", market: "SG", signed_in: "true", atc: "false", purchase: "false", sessions: 999 },
  ],
  [{ week: W, platform: "web", market: "TH", signed_in: "true", users: 900, list_viewed: 800, product_click: 200, added_to_bag: 50 }],
  [
    { week: W, platform: "web", market: "TH", signed_in: "false", purchase: "true", users_added_to_bag: 5 },
    { week: W, platform: "web", market: "TH", signed_in: "false", purchase: "false", users_added_to_bag: 95 },
    { week: W, platform: "web", market: "TH", signed_in: "true", purchase: "true", users_added_to_bag: 20 },
    { week: W, platform: "web", market: "TH", signed_in: "true", purchase: "false", users_added_to_bag: 80 },
  ],
);
const flow = (id: string) => FLOWS.find((f) => f.id === id)!;

describe("funnel drop-offs", () => {
  it("defines all 12 requested flows", () => {
    expect(FLOWS.map((f) => f.label)).toEqual([
      "Product list → PDP",
      "PDP → Add to cart → Cart view",
      "Cart view → Add address → Add payment",
      "Add payment → Order complete",
      "Cart → Order complete",
      "Guest session: Cart → Order complete",
      "Login → Home feed",
      "Home feed → PDP",
      "Home feed → Product list",
      "Hero Banner → Product list → PDP",
      "Special Showcase → PDP",
      "Special Showcase → Product list",
    ]);
  });
  it("user-level cart → order, all users and guests only", () => {
    const all = computeStep(flow("cart-order").steps[0], flow("cart-order"), data, [W], ["web"], ["TH", "SG"]);
    expect(all).toMatchObject({ base: 200, continued: 25 });
    expect(all.dropoff).toBeCloseTo(0.875);
    const guest = computeStep(flow("guest-cart-order").steps[0], flow("guest-cart-order"), data, [W], ["web"], ["TH"]);
    expect(guest).toMatchObject({ base: 100, continued: 5 });
    expect(guest.dropoff).toBeCloseTo(0.95);
    expect(guest.ci![0]).toBeLessThan(0.95);
  });
  it("user counts: list → PDP and PDP → add to cart", () => {
    const f = flow("pdp-atc-cart");
    expect(computeStep(flow("list-pdp").steps[0], flow("list-pdp"), data, [W], ["web"], ["TH"]).dropoff).toBeCloseTo(0.75);
    expect(computeStep(f.steps[0], f, data, [W], ["web"], ["TH"]).dropoff).toBeCloseTo(0.75);
  });
  it("arrivals estimate: cart view → address uses sessions arriving at cart view", () => {
    const f = flow("cart-address-payment");
    const r = computeStep(f.steps[0], f, data, [W], ["web"], ["TH"]);
    expect(r).toMatchObject({ base: 1000, continued: 300 });
    expect(r.dropoff).toBeCloseTo(0.7);
  });
  it("never caps a 'continued' count above the step count into a fake 0% drop-off", () => {
    const d2 = toDropoffData([], [], [{ week: W, platform: "web", market: "TH", signed_in: "true", users: 900, list_viewed: 100, product_click: 400, added_to_bag: 50 }]);
    const r = computeStep(flow("list-pdp").steps[0], flow("list-pdp"), d2, [W], ["web"], ["TH"]);
    expect(r.inconsistent).toBe(true);
    expect(r.dropoff).toBeNull();
  });
  it("hero banner on web is shown as unsupported, not measured", () => {
    const f = FLOWS.find((x) => x.id === "hero-list-pdp")!;
    expect(f.steps[1].unsupported?.web).toMatch(/not a banner signal/);
    expect(f.steps[1].unsupported?.ios).toBeUndefined();
  });
  it("next-step split never claims a drop-off %", () => {
    const f = flow("feed-pdp");
    const r = computeStep(f.steps[0], f, data, [W], ["ios"], ["TH"]);
    expect(r.dropoff).toBeNull();
    expect(r.nextShare).toBeCloseTo(0.75);
    expect(r.movedOn).toBe(800);
  });
  it("unmeasurable steps return no numbers", () => {
    const f = flow("feed-list");
    expect(computeStep(f.steps[0], f, data, [W], ["ios"], ["TH"])).toMatchObject({ base: null, dropoff: null });
  });
  it("weeks overlapping a range include partial weeks at both ends", () => {
    expect(weeksOverlapping(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"], "2026-09-24", "2026-09-30")).toEqual(["2026-09-21", "2026-09-28"]);
  });
});
