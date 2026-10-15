"use client";

import { useMemo, useState } from "react";
import { addDays, fmtDate, fmtInt, fmtPct, fmtUsd, METRICS, MetricKey, mondayOf } from "@/lib/compute";
import { CEO_MARKET_LABEL, CeoPeriod, ceoByMarket, ceoJourney, ceoReleases, ceoScorecard, ceoTrend, ceoVerdict, ceoWeeks, rangeAgg, ScorecardTile, TILE_DEF, TrendPoint, weekAgg } from "@/lib/ceo";
import { Market, MARKETS, METRIC_DEFS } from "@/server/metrics/definitions";
import { compareFor, DateRangeControls, endOf, startOf } from "./FilterBar";
import { Tip, tipLeft } from "./viz";
import type { Filters, PanelProps } from "./types";

const CHANNEL_LABEL: Record<Filters["ceoChannel"], string> = { all: "Website + app", web: "Website", app: "App" };
const RESULT_CLASS: Record<string, string> = { Helped: "good", Hurt: "bad", "No clear effect": "flat", "Too early to tell": "muted" };

/**
 * CEO weekly view: a plain-English readout for one period at a time. Reads the same `cur`/`cmp`
 * ResolvedRange every other panel gets (built from f.from/f.to/f.cfrom/f.cto/f.compare — the date
 * range is shared with the Analyst view by design) through lib/ceo.ts — no number is computed
 * differently here. Only Channel and Market are CEO-view-only filters.
 */
export default function SimpleView(props: PanelProps & { set: (p: Partial<Filters>) => void }) {
  const { api, f, cur, cmp, set, reduced } = props;
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("revenue");

  const { weeks, partial } = useMemo(() => ceoWeeks(api.data.calendar.weeks, api.data.calendar.days), [api.data.calendar.weeks, api.data.calendar.days]);
  const allWeeks = useMemo(() => (partial ? [...weeks, partial.week] : weeks), [weeks, partial]);

  // Does the selected date range exactly match one calendar week (complete or the trailing partial one)?
  const weekMatch = useMemo(() => allWeeks.find((w) => cur.from === w && cur.to === addDays(w, 6)) ?? null, [allWeeks, cur.from, cur.to]);
  const period: CeoPeriod = weekMatch ? { kind: "week", week: weekMatch } : { kind: "range", from: cur.from, to: cur.to };
  const isPartialWeek = Boolean(partial && weekMatch === partial.week);
  // Journey/by-market/releases are inherently weekly concepts: snap to the matched week, or best-effort to the range's own week.
  const sectionWeek = weekMatch ?? mondayOf(cur.from);
  const prevSectionWeek = addDays(sectionWeek, -7);

  const marketsForAgg = useMemo<Market[]>(() => (f.ceoMarket === "all" ? (MARKETS.map((m) => m.id) as Market[]) : [f.ceoMarket]), [f.ceoMarket]);
  const curAgg = useMemo(() => rangeAgg(cur.rows, f.ceoChannel, marketsForAgg, f.orders), [cur.rows, f.ceoChannel, marketsForAgg, f.orders]);
  const prevAgg = useMemo(() => (cmp.daysWithData ? rangeAgg(cmp.rows, f.ceoChannel, marketsForAgg, f.orders) : null), [cmp.rows, cmp.daysWithData, f.ceoChannel, marketsForAgg, f.orders]);
  const noPriorData = !cmp.daysWithData;

  const [verdict1, verdict2] = ceoVerdict({ channel: f.ceoChannel, market: f.ceoMarket, period, cur: curAgg, prev: prevAgg, isPartial: isPartialWeek });
  const series = useMemo(() => allWeeks.map((w) => weekAgg(api.data.daily, w, f.ceoChannel, marketsForAgg, f.orders)), [allWeeks, api.data.daily, f.ceoChannel, marketsForAgg, f.orders]);
  const tiles = useMemo(() => ceoScorecard(curAgg, prevAgg, isPartialWeek, noPriorData, series, period.kind === "week"), [curAgg, prevAgg, isPartialWeek, noPriorData, series, period.kind]);
  const trendWeeks = useMemo(() => allWeeks.map((w) => ({ week: w, partial: partial?.week === w })), [allWeeks, partial]);
  const trend = useMemo(() => ceoTrend(trendWeeks, selectedMetric, series), [trendWeeks, selectedMetric, series]);

  const byMarket = useMemo(() => ceoByMarket(api.data.daily, sectionWeek, f.ceoChannel, prevSectionWeek, f.orders), [api.data.daily, sectionWeek, f.ceoChannel, prevSectionWeek, f.orders]);
  const journey = useMemo(() => ceoJourney(api.data.funnel, sectionWeek, f.ceoChannel), [api.data.funnel, sectionWeek, f.ceoChannel]);
  const prevJourney = useMemo(() => ceoJourney(api.data.funnel, prevSectionWeek, f.ceoChannel), [api.data.funnel, prevSectionWeek, f.ceoChannel]);
  const releaseRows = useMemo(() => ceoReleases(api.data.releases, api.data.daily, sectionWeek, prevSectionWeek), [api.data.releases, api.data.daily, sectionWeek, prevSectionWeek]);
  const releaseCounts = useMemo(() => {
    const out: Record<string, number> = { Helped: 0, Hurt: 0, "No clear effect": 0, "Too early to tell": 0 };
    for (const r of releaseRows) out[r.result]++;
    return out;
  }, [releaseRows]);

  const selectWeek = (monday: string) => {
    const from = startOf(monday);
    const to = endOf(addDays(monday, 6));
    set({ from, to, compare: "prior", ...compareFor({ from, to, compare: "prior", cfrom: f.cfrom, cto: f.cto }) });
  };
  const reset = () => {
    const w = weeks[weeks.length - 1] ?? mondayOf(cur.from);
    const from = startOf(w);
    const to = endOf(addDays(w, 6));
    set({ from, to, compare: "prior", ...compareFor({ from, to, compare: "prior", cfrom: f.cfrom, cto: f.cto }), ceoChannel: "all", ceoMarket: "all" });
  };

  return (
    <div className="ceo">
      <div className="ceo-controls">
        <div className="week-pills" role="group" aria-label="Week">
          {weeks.map((w) => (
            <button key={w} type="button" className="pill" aria-pressed={weekMatch === w} onClick={() => selectWeek(w)}>
              {fmtDate(w)}
            </button>
          ))}
          {partial && (
            <button key={partial.week} type="button" className="pill pill-partial" aria-pressed={weekMatch === partial.week} onClick={() => selectWeek(partial!.week)}>
              {fmtDate(partial.week)} (so far)
            </button>
          )}
        </div>
        <DateRangeControls f={f} set={set} api={api} />
        <span className="seg" role="group" aria-label="Channel">
          {(["all", "web", "app"] as const).map((c) => (
            <button key={c} type="button" aria-pressed={f.ceoChannel === c} onClick={() => set({ ceoChannel: c })}>
              {CHANNEL_LABEL[c]}
            </button>
          ))}
        </span>
        <label className="inline">
          Market
          <select value={f.ceoMarket} onChange={(e) => set({ ceoMarket: e.target.value as Filters["ceoMarket"] })}>
            <option value="all">All</option>
            {MARKETS.map((m) => (
              <option key={m.id} value={m.id}>
                {CEO_MARKET_LABEL[m.id]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="linklike" onClick={reset}>
          Reset
        </button>
      </div>

      <section className="ceo-verdict" aria-live="polite">
        <p className="ceo-verdict-text">{verdict1}</p>
        <p className="ceo-verdict-text">{verdict2}</p>
      </section>

      {isPartialWeek && partial && (
        <div className="field-warn" role="status">
          This week is still in progress: {partial.daysIn} of 7 days are in. Totals aren&apos;t compared with full weeks, but conversion and bounce rate are.
        </div>
      )}

      <div className="scorecard-strip" role="group" aria-label="Key metrics">
        {tiles.map((t) => (
          <ScorecardTileButton key={t.key} tile={t} selected={selectedMetric === t.key} onSelect={() => setSelectedMetric(t.key)} />
        ))}
      </div>

      <section className="panel">
        <h2>{METRICS[selectedMetric].label} by week</h2>
        <TrendChart trend={trend} metricKey={selectedMetric} selectedWeek={weekMatch} onSelectWeek={selectWeek} reduced={reduced} />
      </section>

      <div className="two" style={{ marginTop: 12 }}>
        <section className="panel">
          <h2>By market</h2>
          <div className="sub">
            Week of {fmtDate(sectionWeek)} · {CHANNEL_LABEL[f.ceoChannel]}
          </div>
          <table className="scroll by-market">
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Sales</th>
                <th scope="col">Orders</th>
                <th scope="col">Orders vs week before</th>
                <th scope="col">Conversion</th>
                <th scope="col">Bounce rate</th>
              </tr>
            </thead>
            <tbody>
              {byMarket.map((r) => {
                const top = byMarket[0]?.sales || 1;
                return (
                  <tr key={r.market} className={f.ceoMarket === r.market ? "selected" : undefined}>
                    <th scope="row">
                      <button type="button" className="linklike" onClick={() => set({ ceoMarket: f.ceoMarket === r.market ? "all" : r.market })}>
                        {r.label}
                      </button>
                    </th>
                    <td>
                      <span className="bar-track" aria-hidden>
                        <span className="bar-fill" style={{ width: `${Math.max(2, (r.sales / top) * 100)}%`, background: "var(--web)" }} />
                      </span>
                      {fmtUsd(r.sales)}
                    </td>
                    <td>{fmtInt(r.orders)}</td>
                    <td>{r.ordersDeltaPct == null ? "—" : `${r.ordersDeltaPct >= 0 ? "+" : "−"}${Math.abs(r.ordersDeltaPct * 100).toFixed(1)}%`}</td>
                    <td>{r.conversion == null ? "—" : fmtPct(r.conversion, 2)}</td>
                    <td>{r.bounce == null ? "—" : fmtPct(r.bounce, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Shopping journey</h2>
          <div className="sub">
            Week of {fmtDate(sectionWeek)} · {CHANNEL_LABEL[f.ceoChannel]} · previous week shown as the thin bar
          </div>
          {f.ceoMarket !== "all" && <p className="note">This journey isn&apos;t split by market — it covers all markets.</p>}
          {journey.minWeek && sectionWeek < journey.minWeek && <p className="note">Shopping-journey data starts the week of {fmtDate(journey.minWeek)}.</p>}
          <JourneyChart steps={journey.steps} prevSteps={prevJourney.steps} />
        </section>
      </div>

      <section className="panel" style={{ marginTop: 12 }}>
        <h2>Did this week&apos;s releases help?</h2>
        <p className="sub">We compare conversion after a release with before. Helped/Hurt only when the change is too big to be normal ups and downs. Timing, not proof of cause. Covers all markets.</p>
        <div className="chips" style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "8px 0" }}>
          {(["Helped", "Hurt", "No clear effect", "Too early to tell"] as const).map((k) => (
            <span key={k} className={`badge b-${RESULT_CLASS[k] === "good" ? "High" : RESULT_CLASS[k] === "bad" ? "Low" : "Medium"}`}>
              {k}: {releaseCounts[k]}
            </span>
          ))}
        </div>
        {releaseRows.length ? (
          <table className="scroll">
            <thead>
              <tr>
                <th scope="col">What shipped</th>
                <th scope="col">Went live</th>
                <th scope="col">Measured on</th>
                <th scope="col">Result</th>
                <th scope="col">Conversion before</th>
                <th scope="col">After</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {releaseRows.map((r) => (
                <tr key={r.key} title={`${r.ids.join(", ")}${r.prTitles.length ? " · " + r.prTitles.join("; ") : ""}`}>
                  <th scope="row">{r.what}</th>
                  <td>{r.wentLive}</td>
                  <td>{r.measuredOn}</td>
                  <td className={RESULT_CLASS[r.result]}>{r.result}</td>
                  <td>{r.before}</td>
                  <td>{r.after}</td>
                  <td>{r.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No releases went live the week before, so there&apos;s nothing to measure yet.</p>
        )}
      </section>

      <details className="glossary" style={{ marginTop: 12 }}>
        <summary>How to read this page</summary>
        <dl>
          <dt>Sales</dt>
          <dd>{TILE_DEF.revenue}</dd>
          <dt>Orders</dt>
          <dd>{TILE_DEF.orders}</dd>
          <dt>Conversion</dt>
          <dd>{METRIC_DEFS.nonbounce_cr.text}</dd>
          <dt>Visits</dt>
          <dd>{TILE_DEF.total}</dd>
          <dt>Bounce rate</dt>
          <dd>{METRIC_DEFS.bounce_rate.web} On the app, it&apos;s a single-screen session with no tracked interaction.</dd>
          <dt>Helped / Hurt / No clear effect / Too early to tell</dt>
          <dd>Whether conversion after a release changed by more than normal week-to-week ups and downs would explain — a timing comparison, not proof the release caused it.</dd>
        </dl>
      </details>
    </div>
  );
}

function ScorecardTileButton({ tile, selected, onSelect }: { tile: ScorecardTile; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`panel scorecard-tile ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
      <div className="sub">{tile.label}</div>
      <div className="simple-tile-value">{tile.value}</div>
      <Sparkline values={tile.spark} />
      <div className={`d ${tile.change.tone}`}>{tile.change.text}</div>
      <div className="tile-def">{tile.definition}</div>
    </button>
  );
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * 100;
  const y = (v: number) => 20 - (hi === lo ? 10 : ((v - lo) / (hi - lo)) * 18 + 1);
  const path = pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");
  return (
    <svg viewBox="0 0 100 22" width="100%" height="22" aria-hidden>
      <polyline points={path} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth="1.5" />
    </svg>
  );
}

function TrendChart({ trend, metricKey, selectedWeek, onSelectWeek, reduced }: { trend: TrendPoint[]; metricKey: MetricKey; selectedWeek: string | null; onSelectWeek: (week: string) => void; reduced: boolean }) {
  const m = METRICS[metricKey];
  const isRate = m.kind === "rate";
  const W = 680;
  const H = 180;
  const padL = 8;
  const padB = 24;
  const col = (W - padL) / Math.max(1, trend.length);
  const [hover, setHover] = useState<number | null>(null);
  const vals = trend.map((t) => t.value).filter((v): v is number => v != null);
  const hi = Math.max(1e-9, ...vals);
  const lo = isRate ? Math.min(0, ...vals) : 0;
  const yOf = (v: number) => H - padB - ((v - lo) / Math.max(1e-9, hi - lo)) * (H - padB - 16);
  return (
    <div className="viz">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${m.label} by week`}>
        <line x1={padL} x2={W} y1={H - padB} y2={H - padB} stroke="var(--line)" />
        {trend.map((t, i) => {
          const cx = padL + i * col + col / 2;
          const isSelected = t.week === selectedWeek;
          return (
            <g key={t.week}>
              <rect
                x={padL + i * col}
                y={0}
                width={col}
                height={H - padB}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onClick={() => onSelectWeek(t.week)}
                style={{ cursor: "pointer" }}
              />
              {!isRate && t.value != null && (
                <rect
                  x={cx - col * 0.3}
                  y={yOf(t.value)}
                  width={col * 0.6}
                  height={Math.max(1, H - padB - yOf(t.value))}
                  fill={t.partial ? "var(--cmp)" : isSelected ? "var(--web)" : "var(--ink)"}
                  opacity={t.partial ? 0.55 : isSelected ? 1 : 0.4}
                  strokeDasharray={t.partial ? "3 3" : undefined}
                  stroke={t.partial ? "var(--muted)" : undefined}
                />
              )}
              {isRate && t.value != null && (
                <circle cx={cx} cy={yOf(t.value)} r={t.partial || isSelected ? 4 : 3} fill={t.partial ? "var(--cmp)" : isSelected ? "var(--web)" : "var(--ink)"} opacity={isSelected || t.partial ? 1 : 0.45} />
              )}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fontWeight={isSelected ? 700 : 400} fill={isSelected ? "var(--ink)" : "var(--muted)"}>
                {fmtDate(t.week)}
              </text>
              {isSelected && t.value != null && (
                <text x={cx} y={Math.max(12, yOf(t.value) - 6)} textAnchor="middle" fontSize="11" fontWeight={700} fill="var(--ink)">
                  {m.fmt(t.value)}
                </text>
              )}
            </g>
          );
        })}
        {isRate &&
          !reduced &&
          trend.slice(1).map((t, k) => {
            const i = k + 1;
            const a = trend[i - 1];
            if (a.value == null || t.value == null) return null;
            return (
              <line key={`seg-${t.week}`} x1={padL + (i - 1) * col + col / 2} y1={yOf(a.value)} x2={padL + i * col + col / 2} y2={yOf(t.value)} stroke="var(--line)" strokeWidth={1.5} />
            );
          })}
      </svg>
      {hover != null && trend[hover] && (
        <Tip
          x={tipLeft((hover / Math.max(1, trend.length - 1)) * 100, 220)}
          y={8}
          title={`Week of ${fmtDate(trend[hover].week)} – ${fmtDate(addDays(trend[hover].week, 6))}`}
          rows={[
            { key: "value", value: trend[hover].value == null ? "—" : m.fmt(trend[hover].value), label: m.label },
            { key: "orders", value: fmtInt(trend[hover].agg.orders), label: "orders" },
            { key: "visits", value: fmtInt(trend[hover].agg.total), label: "visits" },
          ]}
          foot={trend[hover].partial ? "Week in progress" : undefined}
          width={220}
        />
      )}
    </div>
  );
}

function JourneyChart({ steps, prevSteps }: { steps: { label: string; sessions: number }[]; prevSteps: { label: string; sessions: number }[] }) {
  const top = Math.max(1, steps[0]?.sessions ?? 1);
  const carries = steps.map((s, i) => (i === 0 ? null : steps[i - 1].sessions ? s.sessions / steps[i - 1].sessions : null));
  const worst = carries.reduce<number>((wi, c, i) => (i > 0 && c != null && (carries[wi] == null || c < (carries[wi] as number)) ? i : wi), 1);
  return (
    <div className="journey">
      {steps.map((s, i) => {
        const pct = (s.sessions / top) * 100;
        const prevPct = prevSteps[0]?.sessions ? (prevSteps[i]?.sessions ?? 0) / prevSteps[0].sessions : null;
        const carry = carries[i];
        const isWorst = i === worst && steps.length > 2;
        return (
          <div key={s.label} className="journey-step">
            {i > 0 && carry != null && (
              <div className={`journey-carry ${isWorst ? "down" : ""}`}>
                {fmtPct(carry, 0)} carried on{isWorst ? " · biggest drop-off" : ""}
              </div>
            )}
            <div className="journey-label">
              {s.label} <span className="muted">· {fmtInt(s.sessions)}</span>
            </div>
            <span className="bar-track" aria-hidden>
              <span className="bar-fill" style={{ width: `${Math.max(1, pct)}%`, background: "var(--web)" }} />
            </span>
            {prevPct != null && (
              <span className="bar-track thin" aria-hidden>
                <span className="bar-fill" style={{ width: `${Math.max(1, prevPct * 100)}%`, background: "var(--cmp)" }} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
