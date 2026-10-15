"use client";

import { useState } from "react";
import { getClient } from "../client";
import { Panel, PendingBadge } from "../shared";
import type { PanelProps } from "../types";

const RULES = ["th_web_bounce_up", "web_cr_down", "app_bounce_up", "release_wrong_way"];

const ict = (iso: string) =>
  `${new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} ICT`;

export default function D10Alerts(props: PanelProps & { onChange?: () => void }) {
  const { api, onChange } = props;
  const [msg, setMsg] = useState<string | null>(null);
  const alerts = api.data.alerts;
  const active = alerts.filter((a) => !a.acknowledged);
  const fired = [...new Set(alerts.map((a) => a.rule))];

  async function ack(id: string) {
    try {
      await getClient().ackAlert(id);
      setMsg("Alert acknowledged.");
    } catch (e) {
      setMsg(`Could not acknowledge the alert${e instanceof Error ? `: ${e.message}` : ""}.`);
    }
    onChange?.();
  }

  return (
    <Panel
      id="panel-alerts"
      title="D10 · Alerts"
      badge={active.length ? <PendingBadge text={`${active.length} active`} /> : undefined}
      sub="Evaluated after every sync against complete, mature weeks with sufficient sample. Shown in-dashboard only."
    >
      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}
      {alerts.length === 0 ? (
        <p className="muted">No alerts fired. Alerts never fire on immature (&lt; 7 days) or suppressed data.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {alerts.map((a) => (
            <li key={a.id} className="alert-item" style={{ opacity: a.acknowledged ? 0.55 : 1, borderLeft: `3px solid ${a.severity === "warning" ? "var(--amber)" : "var(--web)"}`, paddingLeft: 10 }}>
              <div>
                <span className={`badge ${a.severity === "warning" ? "b-Medium" : "b-Low"}`}>{a.severity}</span> {a.message}
              </div>
              <div className="sub">
                {a.sample ?? "sample size n/a"} · fired {ict(a.fired_at)} · rule {a.rule}
                {a.panel && (
                  <>
                    {" "}
                    · <a href={`#panel-${a.panel}`}>open panel</a>
                  </>
                )}
                {a.acknowledged ? (
                  " · acknowledged"
                ) : (
                  <>
                    {" "}
                    ·{" "}
                    <button className="no-print" onClick={() => ack(a.id)} style={{ padding: "1px 8px", fontSize: 11.5 }}>
                      Acknowledge
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="note">
        Rules (config/alerts.yml): {RULES.join(", ")}
        {fired.length ? `; fired so far: ${fired.join(", ")}` : ""}. Slack delivery: off (needs team confirmation + SLACK_WEBHOOK_URL).
      </p>
    </Panel>
  );
}
