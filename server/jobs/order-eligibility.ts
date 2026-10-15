// "Eligible order" filters for online_sales (dataset 33). This combination reproduces the CEO brief
// (Phase 2 reconciliation, 2026-10-08): 970 vs 971 eligible orders 7 Sep–6 Oct; App 175/163 vs 174/163;
// Web 33/28 exact. ±1 is consistent with orders whose status changed after the brief was produced.
// Includes site-to-store (S2S); no staff/influencer or fraud exclusion (see OPEN_QUESTIONS "Phase 2 data pull").
import type { Filter } from "../adapters/superset";

export const ELIGIBLE_ORDER_FILTERS: Filter[] = [
  { column: "is_billable_order", operator: "eq", value: true },
  { column: "platform", operator: "neq", value: "Apollo" },
  { column: "simple_order_status", operator: "neq", value: "Cancelled" },
];

export const ELIGIBLE_ORDER_RULE_STATUS = "reconciled to the CEO brief (970 vs 971 orders, 7 Sep–6 Oct) — billable, non-Apollo, not cancelled, incl. S2S";
