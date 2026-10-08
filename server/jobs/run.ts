import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getDb } from "../cache/db";
import { evaluateAlerts } from "../alerts";
import { importSnapshots } from "./import-snapshots";
import { syncGithub } from "./sync-github";
import { syncSuperset } from "./sync-superset";

/** Newest mtime across discovery snapshot files. */
function snapshotMtime(): number {
  const root = path.join(process.cwd(), "discovery");
  const files = [path.join(root, "github_releases.json")];
  const snaps = path.join(root, "snapshots");
  if (existsSync(snaps)) for (const f of readdirSync(snaps)) if (f.endsWith(".json")) files.push(path.join(snaps, f));
  return Math.max(0, ...files.filter(existsSync).map((f) => statSync(f).mtimeMs));
}

/** Import snapshots only when they changed since the last import (so a live sync is not overwritten by an older file). */
export function importIfChanged() {
  const last = getDb().prepare("SELECT started_at FROM sync_runs WHERE job = 'import-snapshots' AND status = 'ok' ORDER BY id DESC LIMIT 1").get() as
    | { started_at: string }
    | undefined;
  if (last && new Date(last.started_at).getTime() >= snapshotMtime()) return null;
  return importSnapshots();
}

let running = false;
export async function runAll() {
  if (running) return { skipped: "already running" };
  running = true;
  try {
    const imported = importIfChanged();
    const superset = await syncSuperset();
    const github = await syncGithub();
    const alerts = evaluateAlerts();
    return { imported, superset, github, alerts: alerts.length };
  } finally {
    running = false;
  }
}

export function refreshMinutes() {
  const m = Number(process.env.REFRESH_INTERVAL_MINUTES ?? 10);
  return Number.isFinite(m) && m >= 5 && m <= 60 ? m : 10;
}

export function startScheduler() {
  const g = globalThis as unknown as { __pomeloScheduler?: NodeJS.Timeout };
  if (g.__pomeloScheduler) return;
  const tick = () => runAll().catch((e) => console.error("[sync] failed:", e instanceof Error ? e.message : e));
  tick();
  g.__pomeloScheduler = setInterval(tick, refreshMinutes() * 60_000);
  console.log(`[sync] scheduler started, every ${refreshMinutes()} min`);
}
