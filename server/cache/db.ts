// Local aggregate cache (SQLite via Node's built-in node:sqlite — no extra infrastructure).
// Holds aggregates only: day/week x platform x device x market (x channel/customer/version).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS traffic_daily (
  day TEXT NOT NULL, platform TEXT NOT NULL, device TEXT NOT NULL, market TEXT NOT NULL,
  total_sessions INTEGER NOT NULL, bounces INTEGER NOT NULL, non_bounces INTEGER NOT NULL,
  orders REAL, revenue_usd REAL, product_views REAL, added_to_bag REAL, checkout REAL, payment REAL,
  source TEXT NOT NULL,
  PRIMARY KEY (day, platform, device, market)
);
CREATE TABLE IF NOT EXISTS traffic_hourly (
  day TEXT NOT NULL, hour INTEGER NOT NULL, platform TEXT NOT NULL, device TEXT NOT NULL, market TEXT NOT NULL,
  total_sessions INTEGER NOT NULL, bounces INTEGER NOT NULL, non_bounces INTEGER NOT NULL,
  orders REAL, revenue_usd REAL, source TEXT NOT NULL,
  PRIMARY KEY (day, hour, platform, device, market)
);
CREATE TABLE IF NOT EXISTS orders_hourly (
  day TEXT NOT NULL, hour INTEGER NOT NULL, platform TEXT NOT NULL, device TEXT NOT NULL, market TEXT NOT NULL,
  orders REAL NOT NULL, revenue_usd REAL, source TEXT NOT NULL,
  PRIMARY KEY (day, hour, platform, device, market)
);
CREATE TABLE IF NOT EXISTS traffic_mix_weekly (
  week TEXT NOT NULL, platform TEXT NOT NULL, device TEXT NOT NULL, market TEXT NOT NULL,
  channel TEXT NOT NULL, customer_type TEXT NOT NULL,
  total_sessions INTEGER NOT NULL, bounces INTEGER NOT NULL, non_bounces INTEGER NOT NULL,
  orders REAL, revenue_usd REAL, source TEXT NOT NULL,
  PRIMARY KEY (week, platform, device, market, channel, customer_type)
);
CREATE TABLE IF NOT EXISTS app_version_weekly (
  week TEXT NOT NULL, platform TEXT NOT NULL, version TEXT NOT NULL,
  total_sessions INTEGER NOT NULL, bounces INTEGER NOT NULL, non_bounces INTEGER NOT NULL,
  orders REAL, source TEXT NOT NULL,
  PRIMARY KEY (week, platform, version)
);
CREATE TABLE IF NOT EXISTS orders_daily (
  day TEXT NOT NULL, platform TEXT NOT NULL, device TEXT NOT NULL, market TEXT NOT NULL,
  orders REAL NOT NULL, revenue_usd REAL, source TEXT NOT NULL,
  PRIMARY KEY (day, platform, device, market)
);
CREATE TABLE IF NOT EXISTS funnel_weekly (
  week TEXT NOT NULL, platform TEXT NOT NULL, stage TEXT NOT NULL, stage_order INTEGER NOT NULL,
  sessions REAL NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (week, platform, stage)
);
CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY, repo TEXT NOT NULL, platform TEXT NOT NULL, release_id TEXT,
  go_live_at TEXT, bangkok_date TEXT NOT NULL, signal TEXT, pr_count INTEGER, confounded INTEGER,
  note TEXT, source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS release_prs (
  release_key TEXT NOT NULL, number INTEGER NOT NULL, title TEXT, merged_at TEXT, author TEXT,
  labels TEXT, dirs TEXT, success_metric TEXT, surface TEXT, expected_direction TEXT,
  metric_source TEXT, decision_ids TEXT,
  PRIMARY KEY (release_key, number)
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL, decided_on TEXT NOT NULL, decision TEXT NOT NULL, owner TEXT NOT NULL,
  opportunity_key TEXT, release_ids TEXT, hypothesis TEXT, success_metric TEXT, target TEXT,
  review_date TEXT, outcome TEXT NOT NULL DEFAULT 'Pending', notes TEXT
);
CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY, rule TEXT NOT NULL, fired_at TEXT NOT NULL, severity TEXT NOT NULL,
  message TEXT NOT NULL, sample TEXT, panel TEXT, acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT, status TEXT NOT NULL, rows INTEGER, message TEXT
);
`;

let db: DatabaseSync | null = null;

export function cachePath() {
  return process.env.CACHE_PATH ?? path.join(process.cwd(), "data", "cache.sqlite");
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const p = cachePath();
  if (p !== ":memory:") mkdirSync(path.dirname(p), { recursive: true });
  db = new DatabaseSync(p);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

/** For tests: swap in a fresh in-memory database. */
export function resetDbForTests() {
  db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return db;
}

export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function recordRun(job: string, status: "ok" | "error" | "skipped", rows: number, message: string, startedAt: string) {
  getDb()
    .prepare("INSERT INTO sync_runs (job, started_at, finished_at, status, rows, message) VALUES (?, ?, ?, ?, ?, ?)")
    .run(job, startedAt, new Date().toISOString(), status, rows, message);
}
