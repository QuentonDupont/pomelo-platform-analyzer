// CSV export of aggregates for the selected range. Cells below the sample thresholds are flagged, not hidden.
import { aggregate, OrdersSource, rates } from "@/lib/compute";
import { loadDaily } from "@/server/data";
import { Market, MARKETS, MIN_ORDERS, MIN_SESSIONS, PlatformFilter } from "@/server/metrics/definitions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return new Response("from and to must be YYYY-MM-DD", { status: 400 });
  const valid = MARKETS.map((m) => m.id) as string[];
  const markets = (q.get("m") ?? valid.join(",")).split(",").filter((m) => valid.includes(m)) as Market[];
  const src = (q.get("orders") === "session" ? "session" : "backend") as OrdersSource;
  const rows = loadDaily();
  const lines = ["day,platform,device,market,total_sessions,bounce_sessions,non_bounce_sessions,bounce_rate,orders,booked_revenue_usd,nonbounce_cr,suppressed"];
  const platforms: (PlatformFilter | "unknown")[] = ["web", "ios", "android", "unknown"];
  const days = [...new Set(rows.filter((r) => r.day >= from && r.day <= to).map((r) => r.day))].sort();
  for (const day of days)
    for (const p of platforms)
      for (const m of markets)
        for (const dev of ["desktop", "mobile", "app", "unknown"] as const) {
          const sel = rows.filter((r) => r.day === day && r.platform === p && r.market === m && r.device === dev);
          if (!sel.length) continue;
          const a = aggregate(sel, src);
          const rt = rates(a);
          const suppressed = a.total < MIN_SESSIONS || a.orders < MIN_ORDERS;
          lines.push([day, p, dev, m, a.total, a.bounces, a.nb, rt.bounce_rate?.toFixed(4) ?? "", a.orders_known ? a.orders : "", a.revenue.toFixed(2), rt.nonbounce_cr?.toFixed(5) ?? "", suppressed ? "insufficient sample" : ""].join(","));
        }
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="pomelo-aggregates-${from}-to-${to}.csv"` },
  });
}
