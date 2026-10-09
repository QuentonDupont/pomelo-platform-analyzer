import { NextResponse } from "next/server";
import { OrdersSource } from "@/lib/compute";
import { getDb } from "@/server/cache/db";
import { availableWeeks, coverage, deliveryHealth, loadDaily, loadDropoffs, loadHourly, loadReleases, loadTable } from "@/server/data";
import { importIfChanged } from "@/server/jobs/run";
import { ELIGIBLE_ORDER_RULE_STATUS } from "@/server/jobs/order-eligibility";
import { DEFINITION_VERSION } from "@/server/metrics/definitions";
import { supersetTransport } from "@/server/adapters/superset";
import { githubConfigured } from "@/server/adapters/github";
import { cruxConfigured } from "@/server/adapters/crux";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  importIfChanged(); // cheap no-op unless discovery snapshots changed
  const url = new URL(req.url);
  const daily = loadDaily();
  const hasBackendOrders = daily.some((r) => r.e_orders != null);
  const src = (url.searchParams.get("orders") as OrdersSource) ?? (hasBackendOrders ? "backend" : "session");
  const releases = loadReleases(daily, src);
  const db = getDb();
  const runs = db.prepare("SELECT job, status, finished_at, rows, message FROM sync_runs WHERE id IN (SELECT MAX(id) FROM sync_runs GROUP BY job)").all();
  const lastOk = db.prepare("SELECT MAX(finished_at) t FROM sync_runs WHERE status = 'ok'").get() as { t: string | null };
  const sourceRow = db.prepare("SELECT source FROM traffic_daily ORDER BY day DESC LIMIT 1").get() as { source: string } | undefined;
  return NextResponse.json({
    data: {
      daily,
      hourly: loadHourly(),
      mix: loadTable("SELECT * FROM traffic_mix_weekly"),
      app_versions: loadTable("SELECT * FROM app_version_weekly"),
      funnel: loadTable("SELECT * FROM funnel_weekly ORDER BY week, platform, stage_order"),
      dropoffs: loadDropoffs(),
      releases,
      health: deliveryHealth(releases),
      alerts: loadTable("SELECT * FROM alert_events ORDER BY fired_at DESC LIMIT 50"),
      decisions: loadTable("SELECT * FROM decisions ORDER BY decided_on DESC, id DESC"),
      calendar: availableWeeks(daily),
      orders_source: src,
      has_backend_orders: hasBackendOrders,
      sync: runs,
    },
    as_of: lastOk.t,
    source: {
      traffic: daily.length ? sourceRow?.source ?? "cache" : "none — run `npm run sync`",
      live_superset: supersetTransport() ?? "not connected",
      live_github: githubConfigured() ? "connected" : "not connected (snapshot history only)",
      vitals: cruxConfigured() ? "CrUX API" : "not connected (CRUX_API_KEY)",
      orders_rule: ELIGIBLE_ORDER_RULE_STATUS,
      warehouse: "not connected (RudderStack tables on Superset 'PostgreSQL' DB are not exposed as datasets)",
    },
    definition_version: DEFINITION_VERSION,
    coverage: coverage(daily),
  });
}
