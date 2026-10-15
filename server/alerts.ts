// D10 alerts: evaluated after each sync, stored in the dashboard's own cache, shown in-dashboard.
// Never fire on immature or suppressed data. Slack delivery is opt-in (config/alerts.yml + SLACK_WEBHOOK_URL).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { AlertRule, evaluateAlertRules } from "@/lib/payload";
import { getDb } from "./cache/db";
import { loadDaily, loadReleases } from "./data";

export function alertRules(): { slack_enabled: boolean; rules: AlertRule[] } {
  return parse(readFileSync(path.join(process.cwd(), "config/alerts.yml"), "utf8"));
}

export function evaluateAlerts() {
  const { rules } = alertRules();
  const rows = loadDaily();
  const fired = evaluateAlertRules(rows, loadReleases(rows, "backend"), rules);
  const ins = getDb().prepare("INSERT OR IGNORE INTO alert_events (id, rule, fired_at, severity, message, sample, panel) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const a of fired) ins.run(a.id, a.rule, new Date().toISOString(), a.severity, a.message, a.sample, a.panel);
  return fired;
}
