// Export the local cache as compact documents for the Artifact database:
//   artifact/seed/<collection>/<doc_id>.json   (each a JSON object, well under 256 KiB)
// Run: npx tsx scripts/export-artifact-seed.ts   (aggregates only — no customer or order identifiers)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mondayOf } from "../lib/compute";
import { getDb } from "../server/cache/db";

const OUT = path.join(process.cwd(), "artifact", "seed");
rmSync(OUT, { recursive: true, force: true });
const db = getDb();
type Rec = Record<string, unknown>;
const all = (sql: string) => db.prepare(sql).all() as Rec[];
const n = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);

const docs: { collection: string; id: string; body: Rec }[] = [];
function group<K extends string>(rows: Rec[], key: (r: Rec) => K, enc: (r: Rec) => unknown[]) {
  const m = new Map<K, unknown[][]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), enc(r)]);
  return m;
}

for (const [week, rows] of group(all("SELECT * FROM traffic_daily WHERE total_sessions > 0"), (r) => mondayOf(String(r.day)), (r) => [r.day, r.platform, r.device, r.market, r.total_sessions, r.bounces, r.non_bounces, n(r.orders), n(r.revenue_usd), n(r.product_views), n(r.added_to_bag), n(r.list_views), n(r.product_clicks), n(r.searches)]))
  docs.push({ collection: "daily", id: week, body: { rows } });
for (const [week, rows] of group(all("SELECT * FROM orders_daily"), (r) => mondayOf(String(r.day)), (r) => [r.day, r.platform, r.device, r.market, n(r.orders), n(r.revenue_usd)]))
  docs.push({ collection: "orders", id: week, body: { rows } });
for (const [day, rows] of group(all("SELECT * FROM traffic_hourly"), (r) => String(r.day), (r) => [r.hour, r.platform, r.device, r.market, r.total_sessions, r.bounces, r.non_bounces, n(r.orders), n(r.revenue_usd)]))
  docs.push({ collection: "hourly", id: day, body: { rows } });
for (const [day, rows] of group(all("SELECT * FROM orders_hourly"), (r) => String(r.day), (r) => [r.hour, r.platform, r.device, r.market, n(r.orders), n(r.revenue_usd)]))
  docs.push({ collection: "hourly_orders", id: day, body: { rows } });
for (const [week, rows] of group(all("SELECT * FROM traffic_mix_weekly"), (r) => String(r.week), (r) => [r.week, r.platform, r.device, r.market, r.channel, r.customer_type, r.total_sessions, r.bounces, r.non_bounces, n(r.orders), n(r.revenue_usd)]))
  docs.push({ collection: "mix", id: week, body: { rows } });
for (const [week, rows] of group(all("SELECT * FROM app_version_weekly"), (r) => String(r.week), (r) => [r.week, r.platform, r.version, r.total_sessions, r.bounces, r.non_bounces, n(r.orders)]))
  docs.push({ collection: "appver", id: week, body: { rows } });
for (const [week, rows] of group(all("SELECT * FROM funnel_transitions"), (r) => String(r.week), (r) => [r.platform, r.source, r.target, r.source_stage, r.target_stage, r.sessions]))
  docs.push({ collection: "transitions", id: week, body: { rows } });
for (const [week, rows] of group(all("SELECT * FROM session_flags_weekly"), (r) => String(r.week), (r) => [r.platform, r.market, r.signed_in, r.atc, r.purchase, r.sessions]))
  docs.push({ collection: "flags", id: week, body: { rows } });
for (const [week, rows] of group(all("SELECT * FROM user_funnel_weekly"), (r) => String(r.week), (r) => [r.platform, r.market, r.signed_in, r.users, r.list_viewed, r.product_click, r.added_to_bag]))
  docs.push({ collection: "ufunnel", id: week, body: { rows } });
for (const [week, rows] of group(all("SELECT * FROM cart_purchase_weekly"), (r) => String(r.week), (r) => [r.platform, r.market, r.signed_in, r.purchase, r.users_added_to_bag]))
  docs.push({ collection: "cartp", id: week, body: { rows } });
docs.push({ collection: "funnel", id: "all", body: { rows: all("SELECT * FROM funnel_weekly ORDER BY week, platform, stage_order").map((r) => [r.week, r.platform, r.stage, r.stage_order, r.sessions]) } });
docs.push({ collection: "releases", id: "all", body: { rows: all("SELECT id, repo, platform, release_id, go_live_at, bangkok_date, signal, pr_count, confounded, note, source FROM releases") } });
for (const [repo, rows] of group(all("SELECT p.*, r.repo FROM release_prs p JOIN releases r ON r.id = p.release_key"), (r) => String(r.repo), (r) => {
  const { repo: _repo, ...rest } = r;
  void _repo;
  return rest as unknown as unknown[];
}))
  docs.push({ collection: "prs", id: repo, body: { rows } });

const sync = all("SELECT job, status, finished_at, rows, message FROM sync_runs WHERE id IN (SELECT MAX(id) FROM sync_runs GROUP BY job)");
const src = (all("SELECT source FROM traffic_daily ORDER BY day DESC LIMIT 1")[0]?.source as string) ?? "";
docs.push({
  collection: "meta",
  id: "info",
  body: { as_of: new Date().toISOString(), traffic_source: `Superset dataset 63 (Cube segment_session), seeded from the local cache · ${src.slice(0, 160)}`, sync: [{ job: "seed-from-local-cache", status: "ok", finished_at: new Date().toISOString(), rows: docs.length, message: "initial load" }, ...sync] },
});

let biggest = 0;
for (const d of docs) {
  const dir = path.join(OUT, d.collection);
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(d.body);
  biggest = Math.max(biggest, json.length);
  if (json.length > 250_000) throw new Error(`${d.collection}/${d.id} is ${json.length} bytes — over the 256 KiB document cap`);
  writeFileSync(path.join(dir, `${d.id}.json`), json);
}
const counts: Record<string, number> = {};
for (const d of docs) counts[d.collection] = (counts[d.collection] ?? 0) + 1;
console.log(JSON.stringify({ documents: docs.length, counts, largest_bytes: biggest }));
