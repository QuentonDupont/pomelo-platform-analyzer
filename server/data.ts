// Read model over the SQLite cache. Pure building logic lives in lib/payload.ts (shared with the Artifact).
import { DailyRow, HourlyRow, OrdersSource } from "@/lib/compute";
import { availableWeeks, buildReleases, coverage, deliveryHealth, mergeDaily, mergeHourly, ReleaseView } from "@/lib/payload";
import { toDropoffData } from "@/lib/dropoffs";
import { getDb } from "./cache/db";
import type { PrRow, ReleaseRow } from "./impact";

export { availableWeeks, coverage, deliveryHealth };
export type { ReleaseView };

type Rec = Record<string, unknown>;

export function loadTable<T>(sql: string): T[] {
  return getDb().prepare(sql).all() as T[];
}

export function loadDaily(): DailyRow[] {
  return mergeDaily(loadTable<Rec>("SELECT * FROM traffic_daily"), loadTable<Rec>("SELECT * FROM orders_daily"));
}

export function loadHourly(): HourlyRow[] {
  return mergeHourly(loadTable<Rec>("SELECT * FROM traffic_hourly"), loadTable<Rec>("SELECT * FROM orders_hourly"));
}

export function loadDropoffs() {
  return toDropoffData(loadTable<Rec>("SELECT * FROM funnel_transitions"), loadTable<Rec>("SELECT * FROM session_flags_weekly"), loadTable<Rec>("SELECT * FROM user_funnel_weekly"), loadTable<Rec>("SELECT * FROM cart_purchase_weekly"));
}

export function loadReleases(rows: DailyRow[], src: OrdersSource): ReleaseView[] {
  return buildReleases(loadTable<ReleaseRow>("SELECT * FROM releases"), loadTable<PrRow>("SELECT * FROM release_prs"), rows, src);
}
