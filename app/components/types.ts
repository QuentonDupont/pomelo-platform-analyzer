import type { DailyRow, HourlyRow, OrdersSource } from "@/lib/compute";
import type { Market, PlatformFilter } from "@/server/metrics/definitions";
import type { ReleaseView } from "@/lib/payload";
import type { DropoffData } from "@/lib/dropoffs";

export type { DailyRow, HourlyRow, OrdersSource, Market, PlatformFilter, ReleaseView };

export interface MixRow {
  week: string;
  platform: string;
  device: string;
  market: Market;
  channel: string;
  customer_type: string;
  total_sessions: number;
  bounces: number;
  non_bounces: number;
  orders: number | null;
  revenue_usd: number | null;
}
export interface AppVersionRow {
  week: string;
  platform: "ios" | "android";
  version: string;
  total_sessions: number;
  bounces: number;
  non_bounces: number;
  orders: number | null;
}
export interface FunnelRow {
  week: string;
  platform: "web" | "ios" | "android";
  stage: string;
  stage_order: number;
  sessions: number;
  source: string;
}
export interface AlertRow {
  id: string;
  rule: string;
  fired_at: string;
  severity: string;
  message: string;
  sample: string | null;
  panel: string | null;
  acknowledged: number;
}
export interface DecisionRow {
  id: number;
  created_at: string;
  decided_on: string;
  decision: string;
  owner: string;
  opportunity_key: string | null;
  release_ids: string | null;
  hypothesis: string | null;
  success_metric: string | null;
  target: string | null;
  review_date: string | null;
  outcome: string;
  notes: string | null;
}
export interface HealthRow {
  platform: "web" | "ios" | "android" | "backend";
  releases: number;
  prs: number;
  per_week: { week: string; deploys: number }[];
  declared_share: number | null;
  judged: number;
  moved_expected_share: number | null;
  hotfix_within_7d: number;
  confounded_share: number | null;
}
export interface SyncRun {
  job: string;
  status: string;
  finished_at: string | null;
  rows: number | null;
  message: string | null;
}

export interface Api {
  data: {
    daily: DailyRow[];
    hourly: HourlyRow[];
    mix: MixRow[];
    app_versions: AppVersionRow[];
    funnel: FunnelRow[];
    dropoffs: DropoffData;
    releases: ReleaseView[];
    health: HealthRow[];
    alerts: AlertRow[];
    decisions: DecisionRow[];
    calendar: { days: string[]; weeks: string[]; latest: string | null; earliest: string | null };
    orders_source: OrdersSource;
    has_backend_orders: boolean;
    sync: SyncRun[];
  };
  as_of: string | null;
  source: Record<string, string>;
  definition_version: string;
  coverage: { total_sessions: number; unknown_platform_sessions: number; unknown_platform_share: number; orders_without_tracked_sessions: number };
}

/** Global filter state. from/to are Bangkok local "YYYY-MM-DDTHH:mm" (hour precision, To hour inclusive). */
export interface Filters {
  from: string;
  to: string;
  cfrom: string;
  cto: string;
  compare: "prior" | "week" | "custom";
  platform: PlatformFilter;
  markets: Market[];
  device: "all" | "desktop" | "mobile";
  orders: OrdersSource;
  tab: "numbers" | "dropoffs" | "decisions" | "overview" | "releases" | "quality";
  split: boolean;
  lanes: "market" | "device";
  /** metric shown in the Numbers tab charts (trend, bridge, matrix) */
  metric: import("@/lib/compute").MetricKey;
}

/** What every panel receives. `cur`/`cmp` are already resolved to the chosen From/To (hour-precise where data allows). */
export interface PanelProps {
  api: Api;
  f: Filters;
  cur: import("@/lib/compute").ResolvedRange;
  cmp: import("@/lib/compute").ResolvedRange;
  reduced: boolean;
}
