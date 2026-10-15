// Pure (browser-safe) release success-metric ids and labels.
export type MetricId =
  | "bounce_rate"
  | "nonbounce_cr"
  | "aov"
  | "rev_per_nb_session"
  | "pdp_to_atb"
  | "atb_to_checkout"
  | "checkout_to_payment";
export type Direction = "up" | "down";

export const METRIC_LABEL: Record<MetricId, string> = {
  bounce_rate: "Bounce rate",
  nonbounce_cr: "Non-bounce CR",
  aov: "AOV",
  rev_per_nb_session: "Revenue per non-bounce session",
  pdp_to_atb: "PDP → add-to-bag rate",
  atb_to_checkout: "Add-to-bag → checkout rate",
  checkout_to_payment: "Checkout → payment rate",
};
