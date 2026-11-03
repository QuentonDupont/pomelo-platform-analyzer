import { describe, expect, it } from "vitest";
import { featureName, prFeature, releaseFeatures } from "../lib/features";

describe("release feature names", () => {
  it("names the specific feature a PR touched, before the broad area", () => {
    expect(prFeature("feat(): [guest_checkout] added guest checkout feature")).toBe("Guest checkout");
    expect(prFeature("fix(cart): [TECH-29] prioritise sign in over guest checkout in the bag")).toBe("Guest checkout");
    expect(prFeature("fix(cart): confirm vouchers and retain them across bag edits")).toBe("Vouchers & discounts");
    expect(prFeature("fix(pdp): restore size guides for partially measured products")).toBe("Size guide");
    expect(prFeature("fix(auth): [TECH-26] show social login errors and make success path reliable")).toBe("Sign-in & sign-up");
  });
  it("uses the PR's own scope for broad areas", () => {
    expect(prFeature("fix(home): [TECH-11] restore banner video delivery origin")).toBe("Home page");
    expect(prFeature("fix(account): cancel stale order and returns searches")).toBe("Account & orders");
    expect(prFeature("fix: [AND-000] banner content text not displaying in category pages")).toBe("Category pages");
  });
  it("leaves out housekeeping", () => {
    for (const t of ["ci(jira): onboard api to the TECH AI PR pilot", "fix(deploy): [PRDT-000] guest checkout", 'Revert "fix(seo): serve Google verification file at site root"', "feat(guest-checkout): [PRDT-000] add logs", "chore: [AND-000] R8 optimisation"]) {
      expect(prFeature(t)).toBeNull();
    }
  });
  it("lists up to three features by number of PRs, then +N more", () => {
    const titles = [
      "feat(guest-checkout): [PRDT-11590] mark the customer as guest",
      "feat(guest-checkout): [PRDT-11589] Password reset email",
      "feat(preorder): [BUSK-2807] Disable TTB and COD on pre-order carts",
      "fix(cart): confirm vouchers and retain them across bag edits",
      "fix(home): remove mobile banner Shop Now button",
      "ci(jira): onboard api",
    ];
    expect(featureName(titles, "fallback")).toBe("Guest checkout · Pre-orders · Vouchers & discounts +1 more");
    expect(featureName(["ci(jira): onboard api"], "Behind-the-scenes fixes")).toBe("Behind-the-scenes fixes");
  });
  it("puts a new specific feature ahead of a pile of broad-area fixes", () => {
    const titles = ["fix: keep shopping bag visible during cart refreshes", "fix: prevent duplicate bag rows and overlapping summary", "feat(cart): simplify bag purchase hierarchy", "feat(): [guest_checkout] added guest checkout feature"];
    expect(releaseFeatures(titles)).toEqual(["Guest checkout", "Bag"]);
  });
  it("drops a PR that was reverted in the same release", () => {
    const titles = [
      "feat(pdp): compact model-size guidance and delivery estimates",
      'Revert "feat(pdp): compact model-size guidance and delivery estimates"',
      "perf(cart): [PRDT-000] Remove blocking third-party calls from cart endpoints",
      'revert: [PRDT-000] Revert "Remove blocking third-party calls from cart endpoints" (#6071)',
      "fix(search): let shoppers retry failed product searches",
    ];
    expect(releaseFeatures(titles)).toEqual(["Search"]);
  });
});
