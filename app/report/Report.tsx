"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  aggregate,
  Agg,
  DailyRow,
  Filter,
  filterRows,
  fmtDate,
  fmtInt,
  fmtPct,
  fmtPp,
  fmtUsd,
  funnelOpportunities,
  FunnelStage,
  mondayOf,
  OrdersSource,
  priorWindow,
  rankOpportunities,
  rates,
  resolveRange,
  ResolvedRange,
  revenueDecomposition,
  webOpportunities,
} from "@/lib/compute";
import { bangkokToday, DEFINITION_VERSION, Market, MARKETS, METRIC_DEFS, MIN_ORDERS, MIN_SESSIONS, PlatformFilter } from "@/lib/metrics";
import type { Api, FunnelRow } from "../components/types";
import { getClient } from "../components/client";

export type Params = { from: string; to: string; cfrom: string; cto: string; p: PlatformFilter | "all"; m: Market[]; d: "all" | "desktop" | "mobile"; o: OrdersSource | null };

const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ALL_MARKETS = MARKETS.map((m) => m.id) as Market[];

function readParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const dt = (k: string) => {
    const v = q.get(k) ?? "";
    return DT.test(v) ? v : "";
  };
  const m = (q.get("m") ?? "").split(",").filter((x): x is Market => (ALL_MARKETS as string[]).includes(x));
  const p = q.get("p");
  const d = q.get("d");
  const o = q.get("o");
  return {
    from: dt("from"),
    to: dt("to"),
    cfrom: dt("cfrom"),
    cto: dt("cto"),
    p: p === "web" || p === "app" || p === "ios" || p === "android" ? p : "all",
    m: m.length ? m : ALL_MARKETS,
    d: d === "desktop" || d === "mobile" ? d : "all",
    o: o === "backend" || o === "session" ? o : null,
  };
}

const fmtDT = (dt: string) => {
  const [d, t] = dt.split("T");
  return `${fmtDate(d)} ${t}`;
};

function scopeAgg(rows: DailyRow[], r: ResolvedRange, platform: Filter["platform"], markets: Market[], device: Filter["device"], src: OrdersSource): Agg {
  return aggregate(filterRows(rows, { from: r.from, to: r.to, platform, markets, device }), src);
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="panel report-section" style={{ breakInside: "avoid", marginTop: 12 }}>
      <h2>
        {n}. {title}
      </h2>
      <div style={{ marginTop: 6 }}>{children}</div>
    </section>
  );
}

function stagesFor(funnel: FunnelRow[], r: ResolvedRange, platforms: string[]): FunnelStage[] {
  const from = mondayOf(r.from);
  const acc = new Map<string, FunnelStage>();
  for (const x of funnel) {
    if (x.week < from || x.week > r.to || !platforms.includes(x.platform)) continue;
    const s = acc.get(x.stage) ?? { stage: x.stage, stage_order: x.stage_order, sessions: 0 };
    s.sessions += x.sessions;
    acc.set(x.stage, s);
  }
  return [...acc.values()].sort((a, b) => a.stage_order - b.stage_order);
}

/** Standalone page (reads URL params, loads its own data) or embedded in the dashboard (props). */
export default function Report(props: { embedded?: boolean; api?: Api; params?: Params } = {}) {
  const [params, setParams] = useState<Params | null>(props.params ?? null);
  const [api, setApi] = useState<Api | null>(props.api ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const client = getClient();

  useEffect(() => {
    if (props.embedded) {
      setApi(props.api ?? null);
      setParams(props.params ?? null);
      return;
    }
    const p = readParams();
    setParams(p);
    fetch(`/api/metrics${p.o ? `?orders=${p.o}` : ""}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setApi(await r.json());
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "load failed"));
  }, [props.embedded, props.api, props.params]);

  const model = useMemo(() => {
    if (!api || !params) return null;
    const weeks = api.data.calendar.weeks;
    const lw = weeks[weeks.length - 1];
    const from = params.from || (lw ? `${lw}T00:00` : `${api.data.calendar.latest ?? bangkokToday()}T00:00`);
    const to = params.to || (lw ? `${addDays(lw, 6)}T23:00` : `${api.data.calendar.latest ?? bangkokToday()}T23:00`);
    const prior = priorWindow(from, to);
    const cfrom = params.cfrom || prior.from;
    const cto = params.cto || prior.to;
    // only days with tracked sessions count (orders on untracked days would inflate CR)
    const tracked = new Set(api.data.calendar.days);
    const daily = api.data.daily.filter((r) => tracked.has(r.day));
    const hourly = api.data.hourly.filter((r) => tracked.has(r.day));
    const cur = resolveRange(daily, hourly, from, to);
    const cmp = resolveRange(daily, hourly, cfrom, cto);
    return { from, to, cfrom, cto, cur, cmp, src: api.data.orders_source };
  }, [api, params]);

  if (err) return <div className="wrap" style={{ paddingTop: 32 }}><p className="down">Could not load report data: {err}</p></div>;
  if (!api || !params || !model) return <div className="wrap" style={{ paddingTop: 32 }}><p className="muted">Building report…</p></div>;

  const { cur, cmp, src } = model;
  const markets = params.m;
  const today = bangkokToday();
  const noOrders = cur.ordersUnavailable || cmp.ordersUnavailable;
  const hasData = cur.rows.length > 0;

  // 1. executive summary scopes (fixed CEO scopes; market filter applies except Thailand web)
  const scopes: { label: string; platform: Filter["platform"]; markets: Market[]; device: Filter["device"] }[] = [
    { label: "App (iOS + Android)", platform: "app", markets, device: "all" },
    { label: "iOS", platform: "ios", markets, device: "all" },
    { label: "Android", platform: "android", markets, device: "all" },
    { label: "Web", platform: "web", markets, device: params.d },
    { label: "Thailand web", platform: "web", markets: ["TH"], device: params.d },
  ];
  const summary = scopes.map((s) => {
    const a = scopeAgg(cur.rows, cur, s.platform, s.markets, s.device, src);
    const b = scopeAgg(cmp.rows, cmp, s.platform, s.markets, s.device, src);
    return { ...s, a, b, ra: rates(a), rb: rates(b) };
  });

  // 2. bounce movers by platform x market (x device for web)
  type Mover = { label: string; cur: number | null; prev: number | null; diff: number | null; n: number };
  const movers: Mover[] = [];
  for (const m of markets) {
    const segs: [string, Filter["platform"], Filter["device"]][] = [
      [`${m} · Web mobile`, "web", "mobile"],
      [`${m} · Web desktop`, "web", "desktop"],
      [`${m} · iOS`, "ios", "all"],
      [`${m} · Android`, "android", "all"],
    ];
    for (const [label, p, d] of segs) {
      const a = scopeAgg(cur.rows, cur, p, [m], d, src);
      const b = scopeAgg(cmp.rows, cmp, p, [m], d, src);
      const ca = rates(a).bounce_rate;
      const cb = rates(b).bounce_rate;
      if (a.total < MIN_SESSIONS || b.total < MIN_SESSIONS) continue;
      movers.push({ label, cur: ca, prev: cb, diff: ca != null && cb != null ? ca - cb : null, n: a.total });
    }
  }
  movers.sort((x, y) => Math.abs(y.diff ?? 0) - Math.abs(x.diff ?? 0));

  // 3. funnel
  const webStages = stagesFor(api.data.funnel, cur, ["web"]);
  const appStages = stagesFor(api.data.funnel, cur, ["ios", "android"]);
  const drops = webStages.slice(1).map((s, i) => ({ from: webStages[i].stage, to: s.stage, n: webStages[i].sessions, rate: webStages[i].sessions ? s.sessions / webStages[i].sessions : null }));
  const evidencedDrops = drops.filter((d) => d.n >= MIN_SESSIONS && d.rate != null);
  const largestDrop = evidencedDrops.sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1))[0];
  const appRate = (from: string, to: string) => {
    const a = appStages.find((s) => s.stage === from)?.sessions;
    const b = appStages.find((s) => s.stage === to)?.sessions;
    return a && b != null ? b / a : null;
  };

  // 4. decomposition + gaps
  const webA = scopeAgg(cmp.rows, cmp, "web", markets, params.d, src);
  const webB = scopeAgg(cur.rows, cur, "web", markets, params.d, src);
  const appB = scopeAgg(cur.rows, cur, "app", markets, "all", src);
  const decomp = noOrders ? null : revenueDecomposition(webA, webB);

  // 5. opportunities
  const filt: Filter = { from: cur.from, to: cur.to, platform: "web", markets, device: "all" };
  const opps = rankOpportunities([
    ...webOpportunities(cur.rows, filt, "app", src),
    ...(webStages.length && appStages.length
      ? funnelOpportunities(webStages, appStages, webB.orders, rates(webB).aov ?? 0, Math.max(1, Math.round((cur.rows.length ? new Set(cur.rows.map((r) => r.day)).size : 7) / 7)))
      : []),
  ]).slice(0, 5);
  const topEvidenced = opps.find((o) => o.evidenced && o.conf !== "Low");

  // 6. releases
  const rels = api.data.releases.filter((r) => r.bangkok_date >= cur.from && r.bangkok_date <= cur.to);

  // 7. decisions
  const decisionsInRange = api.data.decisions.filter((d) => d.decided_on >= cur.from && d.decided_on <= cur.to);
  const due = api.data.decisions.filter((d) => d.outcome === "Pending" && d.review_date && d.review_date <= addDays(today, 7));

  const orderCell = (v: string) => (noOrders ? <span className="pending">n/a at hour precision</span> : v);
  const low = (a: Agg) => a.orders < MIN_ORDERS;

  return (
    <div className="wrap report">
      <header className="top">
        <div>
          <h1>Performance report</h1>
          <div className="sub">
            {fmtDT(model.from)} → {fmtDT(model.to)} (ICT) vs {fmtDT(model.cfrom)} → {fmtDT(model.cto)} · markets {markets.join(", ")} · web device {params.d} ·
            orders: {src === "backend" ? "backend eligible orders (order date)" : "session-attributed orders"} · definitions {DEFINITION_VERSION}
          </div>
        </div>
        <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {client.canPrint && <button onClick={() => window.print()}>Download PDF</button>}
          <button
            type="button"
            onClick={() =>
              client
                .exportCsv({ from: cur.from, to: cur.to, markets, orders: src })
                .then(() => setCsvMsg(null))
                .catch((e) => setCsvMsg(e instanceof Error ? e.message : "CSV download was not completed."))
            }
          >
            Download CSV
          </button>
          {!props.embedded && (
            <button
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true));
              }}
            >
              {copied ? "Link copied" : "Copy share link"}
            </button>
          )}
          {csvMsg && <span className="field-warn">{csvMsg}</span>}
        </div>
      </header>

      {!hasData && <p className="pending">No cached data in this range. Run a sync or choose a range inside {api.data.calendar.earliest ?? "?"} – {api.data.calendar.latest ?? "?"}.</p>}

      <Section n={1} title="Executive summary">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Total sessions</th>
                <th>Bounce rate</th>
                <th>Non-bounce sessions</th>
                <th>Non-bounce CR</th>
                <th>AOV</th>
                <th>Rev / NB session</th>
                <th>Booked revenue</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.label}>
                  <td>
                    <strong>{s.label}</strong>
                  </td>
                  <td>{fmtInt(s.a.total)}</td>
                  <td>
                    {s.a.total < MIN_SESSIONS ? "insufficient sample" : fmtPct(s.ra.bounce_rate, 1)}
                    <div className="sub">{fmtPp(s.ra.bounce_rate != null && s.rb.bounce_rate != null ? s.ra.bounce_rate - s.rb.bounce_rate : null)}</div>
                  </td>
                  <td>{fmtInt(s.a.nb)}</td>
                  <td>
                    {orderCell(low(s.a) ? "insufficient sample" : fmtPct(s.ra.nonbounce_cr, 3))}
                    {!noOrders && <div className="sub">{s.a.orders} orders vs {s.b.orders}</div>}
                  </td>
                  <td>{orderCell(low(s.a) ? "insufficient sample" : fmtUsd(s.ra.aov, 2))}</td>
                  <td>{orderCell(low(s.a) ? "insufficient sample" : fmtUsd(s.ra.rev_per_nb, 3))}</td>
                  <td>{orderCell(fmtUsd(s.a.revenue))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Comparison period shown as change in bounce rate (pp). Figures describe what happened in each window; they do not attribute causes. App = iOS + Android
          combined; unknown-platform sessions are excluded from every scope and reported in section 9.
        </p>
      </Section>

      <Section n={2} title="Bounce by market, device & platform — largest movers">
        {movers.length ? (
          <table>
            <thead>
              <tr>
                <th>Segment</th>
                <th>Bounce rate</th>
                <th>Comparison</th>
                <th>Change</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {movers.slice(0, 10).map((m) => (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  <td>{fmtPct(m.cur, 1)}</td>
                  <td className="muted">{fmtPct(m.prev, 1)}</td>
                  <td className={(m.diff ?? 0) > 0 ? "down" : "up"}>{fmtPp(m.diff)}</td>
                  <td>{fmtInt(m.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No segment has ≥ {MIN_SESSIONS} sessions in both windows.</p>
        )}
        <p className="note">
          Site-section breakdown: <span className="pending">not evidenced</span> — Superset dataset 63 has no page/section column; needs RudderStack page/screen
          events. iOS/Android rows use the app-bounce definition and are not on the same scale as web bounce.
        </p>
      </Section>

      <Section n={3} title="Funnel & largest evidenced drop-off">
        {webStages.length ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Web sessions</th>
                  <th>Web step rate</th>
                  <th>App step rate</th>
                </tr>
              </thead>
              <tbody>
                {webStages.map((s, i) => {
                  const d = i ? drops[i - 1] : null;
                  const isLargest = d && largestDrop && d.from === largestDrop.from && d.to === largestDrop.to;
                  return (
                    <tr key={s.stage} style={isLargest ? { outline: "2px solid var(--amber)" } : undefined}>
                      <td>
                        {s.stage} {isLargest && <span className="badge b-Medium">largest evidenced drop-off</span>}
                      </td>
                      <td>{fmtInt(s.sessions)}</td>
                      <td>{d ? fmtPct(d.rate, 1) : "—"}</td>
                      <td className="muted">{d ? fmtPct(appRate(d.from, d.to), 1) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="note">Weekly funnel (weeks overlapping the range) from the RudderStack sankey datasets; step rate = sessions reaching the step ÷ previous step.</p>
          </>
        ) : (
          <p className="muted">
            Funnel: <span className="pending">not evidenced</span> for this range — needs RudderStack session funnel data (sankey datasets 276–286 snapshot).
          </p>
        )}
      </Section>

      <Section n={4} title="Web revenue decomposition & Web vs App gaps">
        {decomp ? (
          <table>
            <tbody>
              <tr>
                <td>Booked revenue change (web)</td>
                <td>
                  <strong>{fmtUsd(decomp.total)}</strong> ({fmtUsd(webA.revenue)} → {fmtUsd(webB.revenue)})
                </td>
              </tr>
              <tr>
                <td>Traffic effect (non-bounce sessions)</td>
                <td>{fmtUsd(decomp.traffic)}</td>
              </tr>
              <tr>
                <td>Conversion effect (non-bounce CR)</td>
                <td>{fmtUsd(decomp.conversion)}</td>
              </tr>
              <tr>
                <td>AOV effect (basket size)</td>
                <td>{fmtUsd(decomp.aov)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="muted">Decomposition not computable for these windows (needs orders and revenue in both windows{noOrders ? "; orders are not available at hour precision" : ""}).</p>
        )}
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Web</th>
              <th>App (iOS + Android)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Bounce rate (app-bounce for App)</td>
              <td>{fmtPct(rates(webB).bounce_rate, 1)}</td>
              <td>{fmtPct(rates(appB).bounce_rate, 1)}</td>
            </tr>
            <tr>
              <td>Non-bounce CR</td>
              <td>{orderCell(fmtPct(rates(webB).nonbounce_cr, 3))}</td>
              <td>{orderCell(fmtPct(rates(appB).nonbounce_cr, 3))}</td>
            </tr>
            <tr>
              <td>AOV</td>
              <td>{orderCell(fmtUsd(rates(webB).aov, 2))}</td>
              <td>{orderCell(fmtUsd(rates(appB).aov, 2))}</td>
            </tr>
            <tr>
              <td>Revenue per non-bounce session</td>
              <td>{orderCell(fmtUsd(rates(webB).rev_per_nb, 3))}</td>
              <td>{orderCell(fmtUsd(rates(appB).rev_per_nb, 3))}</td>
            </tr>
          </tbody>
        </table>
        <p className="note">LMDI decomposition: the three effects sum exactly to the total change.</p>
      </Section>

      <Section n={5} title="Top 5 web opportunities by revenue at stake">
        {opps.length ? (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Opportunity</th>
                <th>Current</th>
                <th>Benchmark</th>
                <th>Revenue at stake / wk</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {opps.map((o, i) => (
                <tr key={o.key} className={o.conf === "Low" || !o.evidenced ? "low" : ""}>
                  <td>{i + 1}</td>
                  <td>
                    {o.label}
                    <div className="sub">hypothesis — needs test: {o.hypothesis}</div>
                  </td>
                  <td>{fmtPct(o.current, 1)}</td>
                  <td>
                    {fmtPct(o.benchmark, 1)}
                    <div className="sub">{o.benchLabel}</div>
                  </td>
                  <td>{noOrders ? "n/a" : fmtUsd(o.ras)}</td>
                  <td>
                    <span className={`badge b-${o.conf}`}>{o.conf}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No web segments with data in this range.</p>
        )}
      </Section>

      <Section n={6} title="Releases in range & delivery health">
        {rels.length ? (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Go-live (ICT)</th>
                  <th>Release</th>
                  <th>PRs</th>
                  <th>Success metric</th>
                  <th>Change vs baseline</th>
                  <th>Confounders</th>
                </tr>
              </thead>
              <tbody>
                {rels.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.bangkok_date)}</td>
                    <td>
                      {r.repo} {r.release_id}
                      <div className="sub">{r.platform}{r.confounded ? " · bundled (deploy-level attribution)" : ""}</div>
                    </td>
                    <td>{r.prs.length}</td>
                    <td>
                      {r.metric.label} {r.metric.direction === "up" ? "↑" : "↓"}
                      <div className="sub">{r.metric.source}</div>
                    </td>
                    <td className="hyp">
                      {r.impacts.map((i) => {
                        const rate = i.metric === "bounce_rate" || i.metric === "nonbounce_cr";
                        const f = (x: number | null) => (rate ? fmtPp(x) : fmtUsd(x, 2));
                        return (
                          <div key={i.scope}>
                            {i.scope}: {i.computable ? `${f(i.diff)} [${i.ci ? `${f(i.ci[0])}, ${f(i.ci[1])}` : "no CI"}] · n ${fmtInt(i.baseline.n)} → ${fmtInt(i.post.n)} · ${i.verdict}${i.verdict === "moved as expected" ? " (not causal)" : ""}` : `not computable — ${i.reason}`}
                          </div>
                        );
                      })}
                    </td>
                    <td>{r.confounders.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No production releases in this range.</p>
        )}
        <p className="note">
          Delivery health:{" "}
          {api.data.health
            .map((h) => `${h.platform} ${h.releases} releases, ${fmtPct(h.declared_share, 0)} with declared metric, ${h.judged ? `${fmtPct(h.moved_expected_share, 0)} of ${h.judged} judged moved as expected` : "none judged"}, ${h.hotfix_within_7d} hotfix/rollback ≤7d`)
            .join("; ")}
          .
        </p>
      </Section>

      <Section n={7} title="Decisions & outcomes">
        {decisionsInRange.length || due.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {decisionsInRange.map((d) => (
              <li key={d.id}>
                DEC-{d.id} ({fmtDate(d.decided_on)}, {d.owner}): {d.decision} — outcome: <strong>{d.outcome}</strong>
              </li>
            ))}
            {due
              .filter((d) => !decisionsInRange.includes(d))
              .map((d) => (
                <li key={`due-${d.id}`}>
                  DEC-{d.id}: {d.decision} — review {d.review_date && d.review_date < today ? "overdue" : "due"} {d.review_date ? fmtDate(d.review_date) : ""}
                </li>
              ))}
          </ul>
        ) : (
          <p className="muted">No decisions logged in this range and none due for review.</p>
        )}
      </Section>

      <Section n={8} title="Recommended next actions">
        <p>
          <span className="badge b-Medium">Recommendation — for the team to decide</span>
        </p>
        {topEvidenced && topEvidenced.current != null && topEvidenced.benchmark != null ? (
          (() => {
            const gap = topEvidenced.benchmark - topEvidenced.current;
            const target = topEvidenced.current + gap * 0.25;
            return (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  <strong>Next test:</strong> {topEvidenced.hypothesis} ({topEvidenced.label}).
                </li>
                <li>
                  <strong>Success measure:</strong> {topEvidenced.metric}.
                </li>
                <li>
                  <strong>Target:</strong> close 25% of the gap to the benchmark — from {fmtPct(topEvidenced.current, 1)} to {fmtPct(target, 1)} ({topEvidenced.benchLabel} is{" "}
                  {fmtPct(topEvidenced.benchmark, 1)}), measured over complete Mon–Sun weeks.
                </li>
                <li>
                  <strong>Review date:</strong> {fmtDate(addDays(today, 14))} (two weeks from today; the first 7 days after go-live are immature).
                </li>
                <li>Prefer a controlled test (feature flag split) so the outcome can be attributed; a before/after comparison cannot.</li>
              </ul>
            );
          })()
        ) : (
          <p className="muted">No opportunity has enough evidence (Medium or High confidence) to recommend a test in this range.</p>
        )}
      </Section>

      <Section n={9} title="Scope, definitions, data limits & reconciliation">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Dates: Bangkok business dates (Asia/Bangkok, UTC+7); hours are Bangkok local hours of session start.</li>
          <li>Markets: owned app/web in Thailand, Singapore, Hong Kong, Global USD and Australia (shop 10 = AU is an assumption pending confirmation). Marketplaces, Indonesia, Malaysia and Cambodia excluded.</li>
          <li>Traffic: Superset dataset 63 (Cube-PROD segment_session), bot_flag = false (note: the flag is never true in the source).</li>
          <li>Bounce: {METRIC_DEFS.bounce_rate.web} <span className="pending">The exact rule lives in the Cube model — definition pending.</span> App uses app-bounce.</li>
          <li>Non-bounce CR: {METRIC_DEFS.nonbounce_cr.text}</li>
          <li>Booked revenue: {METRIC_DEFS.booked_revenue.text}</li>
          <li>
            Orders in this report: {src === "backend" ? "backend eligible orders by order date (dataset 33; eligibility rule is a candidate pending confirmation)" : "session-attributed gross_orders (dataset 63)"}. The CEO brief&apos;s order counts are not yet reproduced exactly (see docs/RECONCILIATION.md); non-bounce sessions are.
          </li>
          <li>Cells with &lt; {MIN_SESSIONS} sessions or &lt; {MIN_ORDERS} orders are shown as &ldquo;insufficient sample&rdquo;.</li>
          <li>
            Unknown / unmapped platform: {fmtInt(api.coverage.unknown_platform_sessions)} sessions ({fmtPct(api.coverage.unknown_platform_share, 1)}) in the cache, kept as their own bucket.
          </li>
          {[...cur.partialDays.map((p) => ({ ...p, w: "range" })), ...cmp.partialDays.map((p) => ({ ...p, w: "comparison" }))].map((p) => (
            <li key={`${p.w}-${p.day}`}>
              Partial day ({p.w}) {fmtDate(p.day)} {String(p.fromHour).padStart(2, "0")}:00–{String(p.toHour).padStart(2, "0")}:59:{" "}
              {p.precision === "hour" ? "hour-precise" : <span className="pending">hourly data unavailable — rounded to the whole day</span>}
              {p.orders === "unavailable" && <span className="pending"> · orders not available at hour precision</span>}
            </li>
          ))}
          <li>Release go-live = successful production deploy run (www deploy.yml, api deploy-production.yml, iOS ci-production.yaml); Android from git tags (weak signal).</li>
          <li>Data as of {api.as_of ? new Date(api.as_of).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }) + " ICT" : "unknown"}; source: {api.source.traffic}.</li>
        </ul>
      </Section>
    </div>
  );
}
