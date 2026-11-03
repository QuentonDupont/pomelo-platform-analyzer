#!/usr/bin/env node
// Build the Platform Changes Tracker's `daily_platform` CSV from the Analyzer cache, keeping history as-is.
//
//   export-tracker-csv.mjs --cache <cache.sqlite> --existing <current.csv> --out <new.csv> [--from YYYY-MM-DD] [--include-today]
//
// One row per day x platform x device (markets summed, platform "unknown" left out); orders and revenue are the
// backend (eligible) orders. Rows before --from (default: today - 14, Bangkok) are copied from the existing file
// untouched; rows from --from on are regenerated from the cache, up to the last COMPLETE Bangkok day (a partial
// day would pull the daily averages down) unless --include-today. CRLF line endings, like the existing file.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
const [cachePath, existingPath, outPath] = [arg("cache"), arg("existing"), arg("out")];
if (!cachePath || !existingPath || !outPath) throw new Error("--cache, --existing and --out are required");
const from = arg("from", addDays(today, -14));
const last = process.argv.includes("--include-today") ? today : addDays(today, -1);

const db = new DatabaseSync(cachePath, { readOnly: true });
const traffic = db
  .prepare(
    `SELECT day, platform, device, SUM(total_sessions) sessions, SUM(bounces) bounces, SUM(non_bounces) non_bounces,
            SUM(product_views) product_views, SUM(added_to_bag) added_to_bag, SUM(list_views) list_views, SUM(product_clicks) product_clicks
     FROM traffic_daily WHERE platform != 'unknown' AND day >= ? AND day <= ? AND total_sessions > 0 GROUP BY day, platform, device`,
  )
  .all(from, last);
const orders = new Map(
  db
    .prepare(`SELECT day, platform, device, SUM(orders) orders, SUM(revenue_usd) revenue FROM orders_daily WHERE platform != 'unknown' AND day >= ? AND day <= ? GROUP BY day, platform, device`)
    .all(from, last)
    .map((r) => [`${r.day}|${r.platform}|${r.device}`, r]),
);
const int = (v) => String(Math.round(Number(v ?? 0)));
const money = (v) => {
  const x = Math.round(Number(v ?? 0) * 100) / 100;
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
};

const old = fs.readFileSync(existingPath, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
const header = old[0];
const kept = old.slice(1).filter((l) => l.split(",")[0] < from);
const fresh = traffic
  .sort((a, b) => a.day.localeCompare(b.day) || a.platform.localeCompare(b.platform) || a.device.localeCompare(b.device))
  .map((r) => {
    const o = orders.get(`${r.day}|${r.platform}|${r.device}`);
    return [r.day, r.platform, r.device, int(r.sessions), int(r.bounces), int(r.non_bounces), int(r.product_views), int(r.added_to_bag), int(r.list_views), int(r.product_clicks), int(o?.orders), money(o?.revenue)].join(",");
  });
const all = [...kept, ...fresh];
fs.writeFileSync(outPath, [header, ...all].join("\r\n") + "\r\n");

const perDay = {};
all.forEach((l) => (perDay[l.split(",")[0]] = (perDay[l.split(",")[0]] ?? 0) + 1));
const days = Object.keys(perDay).sort();
const odd = days.filter((d) => perDay[d] !== 4);
console.log(JSON.stringify({ out: outPath, rows: all.length, days: days.length, first: days[0], last: days[days.length - 1], kept_rows: kept.length, regenerated_rows: fresh.length, from, days_without_4_rows: odd }));
if (odd.length) {
  console.error("WARNING: days without exactly 4 platform/device rows: " + odd.join(", "));
  process.exit(2);
}
