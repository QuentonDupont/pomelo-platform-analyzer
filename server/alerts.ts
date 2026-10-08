// D10 alerts: evaluated after each sync, stored in the dashboard's own cache, shown in-dashboard.
// Never fire on immature or suppressed data. Slack delivery is opt-in (config/alerts.yml + SLACK_WEBHOOK_URL).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { addDays, aggregate, completeWeeks, filterRows, rates } from "@/lib/compute";
import { getDb } from "./cache/db";
import { loadDaily, loadReleases } from "./data";
import { bangkokToday, Market, newcombeDiff, PlatformFilter } from "./metrics/definitions";

type Rule = {
  id: string;
  label: string;
  scope?: { platform: PlatformFilter; markets: Market[] };
  metric: "bounce_rate" | "nonbounce_cr" | "release";
  threshold_pp?: number;
  min_sessions?: number;
  min_orders?: number;
  panel: string;
};

export function alertRules(): { slack_enabled: boolean; rules: Rule[] } {
  return parse(readFileSync(path.join(process.cwd(), "config/alerts.yml"), "utf8"));
}

export function evaluateAlerts() {
  const { rules } = alertRules();
  const rows = loadDaily();
  if (!rows.length) return [];
  const today = bangkokToday();
  const weeks = completeWeeks([...new Set(rows.map((r) => r.day))].sort(), today);
  // latest complete week that is also mature (ended >= 7 days ago)
  const mature = weeks.filter((w) => addDays(w, 6) <= addDays(today, -7));
  const fired: { id: string; rule: string; severity: string; message: string; sample: string; panel: string }[] = [];
  const latest = mature[mature.length - 1];
  for (const r of rules) {
    if (r.metric === "release") continue;
    if (!latest || !r.scope) continue;
    const trailing = mature.slice(-5, -1);
    if (trailing.length < 2) continue;
    const f = (from: string, to: string) => aggregate(filterRows(rows, { from, to, platform: r.scope!.platform, markets: r.scope!.markets, device: "all" }), "backend");
    const cur = f(latest, addDays(latest, 6));
    const base = f(trailing[0], addDays(trailing[trailing.length - 1], 6));
    if (r.metric === "bounce_rate") {
      if (cur.total < (r.min_sessions ?? 1000)) continue;
      const d = (rates(cur).bounce_rate ?? 0) - (rates(base).bounce_rate ?? 0);
      const ci = newcombeDiff(base.bounces, base.total, cur.bounces, cur.total);
      if (d * 100 > (r.threshold_pp ?? 3) && ci && ci[0] > 0)
        fired.push({ id: `${r.id}:${latest}`, rule: r.id, severity: "warning", message: `${r.label}: ${(rates(cur).bounce_rate! * 100).toFixed(1)}% in week of ${latest} vs ${(rates(base).bounce_rate! * 100).toFixed(1)}% trailing (${(d * 100).toFixed(1)} pp, 95% CI ${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)} pp)`, sample: `n=${cur.total.toLocaleString()} sessions vs ${base.total.toLocaleString()}`, panel: r.panel });
    } else if (r.metric === "nonbounce_cr") {
      if (!cur.orders_known || cur.orders < (r.min_orders ?? 20)) continue;
      const d = (rates(cur).nonbounce_cr ?? 0) - (rates(base).nonbounce_cr ?? 0);
      const ci = newcombeDiff(base.orders, base.nb, cur.orders, cur.nb);
      if (-d * 100 > (r.threshold_pp ?? 0.15) && ci && ci[1] < 0)
        fired.push({ id: `${r.id}:${latest}`, rule: r.id, severity: "warning", message: `${r.label}: ${(rates(cur).nonbounce_cr! * 100).toFixed(3)}% vs ${(rates(base).nonbounce_cr! * 100).toFixed(3)}% trailing`, sample: `${cur.orders} orders / ${cur.nb.toLocaleString()} non-bounce sessions`, panel: r.panel });
    }
  }
  if (rules.some((r) => r.metric === "release")) {
    for (const rel of loadReleases(rows, "backend")) {
      for (const i of rel.impacts) {
        if (i.verdict === "moved opposite" && i.post.days >= 7)
          fired.push({ id: `release_wrong_way:${rel.id}:${i.scope}`, rule: "release_wrong_way", severity: "info", message: `${rel.repo} ${rel.release_id} (${rel.bangkok_date}): ${rel.metric.label} moved opposite to expected on ${i.scope} (change vs baseline, not causal)`, sample: `n=${i.baseline.n.toLocaleString()} → ${i.post.n.toLocaleString()}`, panel: "releases" });
      }
    }
  }
  const db = getDb();
  const ins = db.prepare("INSERT OR IGNORE INTO alert_events (id, rule, fired_at, severity, message, sample, panel) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const a of fired) ins.run(a.id, a.rule, new Date().toISOString(), a.severity, a.message, a.sample, a.panel);
  return fired;
}
