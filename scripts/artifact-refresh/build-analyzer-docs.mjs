#!/usr/bin/env node
// Build the Pomelo Bounce & Release Impact artifact's data documents from the Analyzer cache.
//
//   build:   build-analyzer-docs.mjs --cache <cache.sqlite> --current <dir> --out <dir> [--from YYYY-MM-DD] [--note "text"]
//   verify:  build-analyzer-docs.mjs --verify <dir> --cache <cache.sqlite> [--from YYYY-MM-DD]
//
// <dir> for --current / --verify is where ArtifactData `list ... out_dir` saved the artifact's current documents
// (daily/<monday>.json, orders/<monday>.json, meta/info.json). Rows use the artifact's compact encoding.
// Days >= --from (default: today - 14, Bangkok) are replaced from the cache; earlier rows are kept as they are.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (d) => {
  const t = new Date(d + "T00:00:00Z");
  return addDays(d, -((t.getUTCDay() + 6) % 7));
};
const n = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const from = arg("from", addDays(today, -14));
const cachePath = arg("cache");
if (!cachePath) throw new Error("--cache <cache.sqlite> is required");
const db = new DatabaseSync(cachePath, { readOnly: true });

if (arg("verify")) {
  const dir = arg("verify");
  const sums = { daily: {}, orders: {} };
  for (const col of ["daily", "orders"]) {
    const d = path.join(dir, col);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      for (const r of JSON.parse(fs.readFileSync(path.join(d, f), "utf8")).rows ?? []) {
        if (r[0] < from) continue;
        sums[col][r[0]] = (sums[col][r[0]] ?? 0) + Number(r[4]);
      }
    }
  }
  const cacheTraffic = Object.fromEntries(db.prepare("SELECT day, SUM(total_sessions) v FROM traffic_daily WHERE day >= ? AND total_sessions > 0 GROUP BY day").all(from).map((r) => [r.day, Number(r.v)]));
  const cacheOrders = Object.fromEntries(db.prepare("SELECT day, SUM(orders) v FROM orders_daily WHERE day >= ? GROUP BY day").all(from).map((r) => [r.day, Number(r.v)]));
  const bad = [];
  for (const [label, got, want] of [["sessions", sums.daily, cacheTraffic], ["orders", sums.orders, cacheOrders]]) {
    for (const day of new Set([...Object.keys(got), ...Object.keys(want)])) {
      if (Math.abs((got[day] ?? 0) - (want[day] ?? 0)) > 0.01) bad.push(`${day} ${label}: artifact ${got[day] ?? 0} vs cache ${want[day] ?? 0}`);
    }
  }
  console.log(JSON.stringify({ verified_from: from, days: Object.keys(cacheTraffic).length, mismatches: bad.length }));
  bad.forEach((b) => console.log("MISMATCH " + b));
  process.exit(bad.length ? 1 : 0);
}

const curDir = arg("current");
const outDir = arg("out");
if (!curDir || !outDir) throw new Error("--current <dir> and --out <dir> are required");
fs.mkdirSync(outDir, { recursive: true });

const fresh = {
  daily: db
    .prepare("SELECT * FROM traffic_daily WHERE day >= ? AND total_sessions > 0 ORDER BY day")
    .all(from)
    .map((r) => [r.day, r.platform, r.device, r.market, r.total_sessions, r.bounces, r.non_bounces, n(r.orders), n(r.revenue_usd), n(r.product_views), n(r.added_to_bag), n(r.list_views), n(r.product_clicks), n(r.searches)]),
  orders: db
    .prepare("SELECT * FROM orders_daily WHERE day >= ? ORDER BY day")
    .all(from)
    .map((r) => [r.day, r.platform, r.device, r.market, n(r.orders), n(r.revenue_usd)]),
};
const manifest = [];
const summary = {};
for (const col of ["daily", "orders"]) {
  for (const week of [...new Set(fresh[col].map((r) => mondayOf(r[0])))].sort()) {
    const cur = path.join(curDir, col, `${week}.json`);
    const existing = fs.existsSync(cur) ? JSON.parse(fs.readFileSync(cur, "utf8")).rows ?? [] : [];
    const kept = existing.filter((r) => r[0] < from);
    const add = fresh[col].filter((r) => mondayOf(r[0]) === week);
    const rows = [...kept, ...add].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const json = JSON.stringify({ rows });
    if (json.length > 250000) throw new Error(`${col}/${week} is ${json.length} bytes, over the 256 KiB document cap`);
    const file = path.join(outDir, `${col}-${week}.json`);
    fs.writeFileSync(file, json);
    manifest.push({ collection: col, doc_id: week, file, exists: fs.existsSync(cur) });
    summary[`${col}/${week}`] = { existing: existing.length, kept: kept.length, fresh: add.length, total: rows.length };
  }
}

const metaPath = path.join(curDir, "meta", "info.json");
if (!fs.existsSync(metaPath)) throw new Error(`current meta/info.json not found at ${metaPath}`);
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const now = new Date().toISOString();
const entry = {
  job: "artifact-refresh",
  status: "ok",
  finished_at: now,
  rows: fresh.daily.length + fresh.orders.length,
  message: arg("note", `refreshed from the Pomelo Platform Analyzer cache (Superset): sessions and eligible orders ${from} → ${today}; hourly and releases not refreshed`),
};
const sync = [entry, ...(meta.sync ?? []).filter((s) => s.job !== "artifact-refresh")];
const metaFile = path.join(outDir, "meta-info.json");
fs.writeFileSync(metaFile, JSON.stringify({ ...meta, as_of: now, sync }));
manifest.push({ collection: "meta", doc_id: "info", file: metaFile, exists: true });
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify({ from, today, writes: manifest.length, summary }, null, 1));
