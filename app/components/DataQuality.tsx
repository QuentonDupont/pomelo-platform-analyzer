"use client";

import { addDays, aggregate, filterRows, fmtInt, fmtPct } from "@/lib/compute";
import { Market, MARKETS, MIN_ORDERS, MIN_SESSIONS } from "@/server/metrics/definitions";
import { Panel } from "./shared";
import type { PanelProps } from "./types";

const ALL = MARKETS.map((m) => m.id) as Market[];
// CEO brief (7 Oct 2026): non-bounce sessions and eligible orders, weeks of 14 Sep and 28 Sep.
const BRIEF = [
  { label: "App (iOS + Android)", platform: "app" as const, markets: ALL, w1: [13615, 174], w2: [12510, 163] },
  { label: "Web 5 markets", platform: "web" as const, markets: ALL, w1: [6317, 33], w2: [6014, 28] },
  { label: "Thailand web", platform: "web" as const, markets: ["TH"] as Market[], w1: [4255, 21], w2: [3890, 21] },
];

export default function DataQuality(props: PanelProps) {
  const { api, f, cur } = props;
  const daily = api.data.daily;
  const wk = (w: string, b: (typeof BRIEF)[number], src: "backend" | "session") => aggregate(filterRows(daily, { from: w, to: addDays(w, 6), platform: b.platform, markets: b.markets, device: "all" }), src);
  const sel = filterRows(cur.rows, { from: cur.from, to: cur.to, platform: f.platform, markets: f.markets, device: f.platform === "web" ? f.device : "all" });
  const suppressed = sel.filter((r) => r.total < MIN_SESSIONS || (f.orders === "backend" ? r.e_orders ?? 0 : r.s_orders ?? 0) < MIN_ORDERS).length;
  const cell = (got: number, want: number) => (
    <td className={got === want ? "up" : "down"}>
      {fmtInt(got)} {got === want ? "✓" : `(${got - want >= 0 ? "+" : ""}${fmtInt(got - want)})`}
    </td>
  );
  return (
    <>
      <Panel id="panel-quality" title="Reconciliation vs CEO brief" sub="Live from the cache. ✓ = exact match; differences are shown, not hidden (late cancellations and attribution rules can differ). Details: docs/RECONCILIATION.md.">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Scope · week</th>
                <th>NB sessions (brief)</th>
                <th>NB sessions (cache)</th>
                <th>Orders (brief)</th>
                <th>Backend eligible</th>
                <th>Session-attributed</th>
              </tr>
            </thead>
            <tbody>
              {BRIEF.flatMap((b) =>
                (
                  [
                    ["2026-09-14", b.w1],
                    ["2026-09-28", b.w2],
                  ] as const
                ).map(([w, want]) => {
                  const be = wk(w, b, "backend");
                  const se = wk(w, b, "session");
                  return (
                    <tr key={b.label + w}>
                      <td>
                        {b.label} · {w}
                      </td>
                      <td>{fmtInt(want[0])}</td>
                      {be.days ? cell(be.nb, want[0]) : <td className="muted">not in cache</td>}
                      <td>{want[1]}</td>
                      {be.days && be.orders_known ? cell(be.orders, want[1]) : <td className="muted">not in cache</td>}
                      {se.days && se.orders_known ? cell(se.orders, want[1]) : <td className="muted">—</td>}
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="grid two">
        <Panel id="panel-coverage" title="Coverage & suppression">
          <table className="kv">
            <tbody>
              <tr>
                <td>Unknown / unmapped platform</td>
                <td>
                  {fmtInt(api.coverage.unknown_platform_sessions)} sessions ({fmtPct(api.coverage.unknown_platform_share, 1)}) — own bucket, never folded into Web or App
                </td>
              </tr>
              <tr>
                <td>Backend orders with no tracked sessions (same day/platform/market)</td>
                <td>{fmtInt(api.coverage.orders_without_tracked_sessions)}</td>
              </tr>
              <tr>
                <td>Suppressed cells in current view</td>
                <td>
                  {suppressed} of {sel.length} day×platform×device×market cells (&lt;{MIN_SESSIONS} sessions or &lt;{MIN_ORDERS} orders)
                </td>
              </tr>
              <tr>
                <td>Hour precision for this range</td>
                <td>{cur.partialDays.length ? cur.partialDays.map((p) => `${p.day}: ${p.precision}${p.orders === "unavailable" ? " (orders not hourly)" : ""}`).join("; ") : "whole days only"}</td>
              </tr>
              <tr>
                <td>Bounce definition</td>
                <td className="pending">Cube measure — exact rule pending (Cube model not visible)</td>
              </tr>
              <tr>
                <td>Site section</td>
                <td className="pending">not evidenced — no page/path column</td>
              </tr>
              <tr>
                <td>Market mapping</td>
                <td>1 TH · 2 SG · 4 Global USD · 12 HK · 10 AU (assumed, pending)</td>
              </tr>
            </tbody>
          </table>
        </Panel>
        <Panel id="panel-sources" title="Sources & sync">
          <table className="kv">
            <tbody>
              {Object.entries(api.source).map(([k, v]) => (
                <tr key={k}>
                  <td>{k.replace(/_/g, " ")}</td>
                  <td style={{ whiteSpace: "normal", textAlign: "left" }} className={/not connected|none/.test(v) ? "pending" : ""}>
                    {v}
                  </td>
                </tr>
              ))}
              {api.data.sync.map((s) => (
                <tr key={s.job}>
                  <td>{s.job}</td>
                  <td style={{ whiteSpace: "normal", textAlign: "left" }} className={s.status === "error" ? "down" : s.status === "skipped" ? "pending" : "up"}>
                    {s.status} · {s.finished_at ? new Date(s.finished_at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }) : "—"} ICT · {s.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">Definition version {api.definition_version}.</div>
        </Panel>
      </div>
    </>
  );
}
