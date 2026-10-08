// "Eligible order" filters for online_sales (dataset 33). The CEO brief's exact rule is still an
// open question (OPEN_QUESTIONS #4); these are the evidenced candidates, kept in one place so the
// reconciliation result can change them without touching the sync code.
import type { Filter } from "../adapters/superset";

export const ELIGIBLE_ORDER_FILTERS: Filter[] = [
  { column: "is_billable_order", operator: "eq", value: true },
  { column: "test", operator: "eq", value: false },
  { column: "is_fraud_customer", operator: "eq", value: false },
  { column: "platform", operator: "neq", value: "Apollo" },
];

export const ELIGIBLE_ORDER_RULE_STATUS = "candidate — pending confirmation of the CEO brief's 'eligible' rule";
