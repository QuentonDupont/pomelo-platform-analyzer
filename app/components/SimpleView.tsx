"use client";

import { useMemo, useState } from "react";
import { addDays, fmtDate, fmtInt, fmtPct, fmtRange, fmtUsd, METRICS, MetricKey, mondayOf } from "@/lib/compute";
import { CEO_MARKET_LABEL, CeoPeriod, ceoByMarket, ceoJourney, ceoReleases, ceoReleaseSources, ceoScorecard, RELEASE_VERDICTS, ReleaseVerdict, ceoTrend, ceoVerdict, ceoWeeks, rangeAgg, ScorecardTile, TILE_DEF, TrendPoint, weekAgg } from "@/lib/ceo";
import { Market, MARKETS, METRIC_DEFS } from "@/server/metrics/definitions";
import { compareFor, DateRangeControls, endOf, startOf } from "./FilterBar";
import { Tip, tipLeft } from "./viz";
import type { Filters, PanelProps } from "./types";

const CHANNEL_LABEL: Record<Filters["ceoChannel"], string> = { all: "Website + app", web: "Website", app: "App" };
const RESULT_CLASS: Record<ReleaseVerdict, string> = { Helped: "up", "Likely helped": "up", "No clear effect": "flat", "Likely hurt": "down", Hurt: "down", "Can't compare": "flat", "Too early to tell": "flat" };
const RESULT_BADGE: Record<ReleaseVerdict, string> = { Helped: "b-High", "Likely helped": "b-High", "No clear effect": "b-Low", "Likely hurt": "b-bad", Hurt: "b-bad", "Can't compare": "b-Medium", "Too early to tell": "b-Medium" };

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
  // By-market is a weekly table: snap to the matched week, or best-effort to the range's own week.
  // The trend chart, journey and releases follow the selected range itself.
  const sectionWeek = weekMatch ?? mondayOf(cur.from);
  const prevSectionWeek = addDays(sectionWeek, -7);
  const periodLabel = weekMatch ? `Week of ${fmtDate(weekMatch)}` : fmtRange(cur.from, cur.to);
  const inRangeWeeks = useMemo(() => allWeeks.filter((w) => w <= cur.to && addDays(w, 6) >= cur.from), [allWeeks, cur.from, cur.to]);
  // A range spanning several weeks narrows the chart to those weeks; a single week keeps the history for context.
  const chartWeeks = inRangeWeeks.length >= 2 ? inRangeWeeks : allWeeks;

  const marketsForAgg = useMemo<Market[]>(() => (f.ceoMarket === "all" ? (MARKETS.map((m) => m.id) as Market[]) : [f.ceoMarket]), [f.ceoMarket]);
  const curAgg = useMemo(() => rangeAgg(cur.rows, f.ceoChannel, marketsForAgg, f.orders), [cur.rows, f.ceoChannel, marketsForAgg, f.orders]);
  const prevAgg = useMemo(() => (cmp.daysWithData ? rangeAgg(cmp.rows, f.ceoChannel, marketsForAgg, f.orders) : null), [cmp.rows, cmp.daysWithData, f.ceoChannel, marketsForAgg, f.orders]);
  const noPriorData = !cmp.daysWithData;
  // Visits per day far below the comparison period means the latest day is still loading (orders arrive
  // faster than sessions), so rates would be wrong: don't compare them until it fills in.
  const sessionsIncomplete = Boolean(prevAgg && cur.daysWithData && cmp.daysWithData && curAgg.total / cur.daysWithData < 0.5 * (prevAgg.total / cmp.daysWithData));
  const prevForCompare = sessionsIncomplete ? null : prevAgg;

  const [verdict1, verdict2] = ceoVerdict({ channel: f.ceoChannel, market: f.ceoMarket, period, cur: curAgg, prev: prevForCompare, isPartial: isPartialWeek });
  const series = useMemo(() => allWeeks.map((w) => weekAgg(api.data.daily, w, f.ceoChannel, marketsForAgg, f.orders)), [allWeeks, api.data.daily, f.ceoChannel, marketsForAgg, f.orders]);
  const tiles = useMemo(() => ceoScorecard(curAgg, prevForCompare, isPartialWeek, noPriorData, series, period.kind === "week"), [curAgg, prevForCompare, isPartialWeek, noPriorData, series, period.kind]);
  const trendWeeks = useMemo(() => allWeeks.map((w) => ({ week: w, partial: partial?.week === w })), [allWeeks, partial]);
  const trend = useMemo(() => ceoTrend(trendWeeks, selectedMetric, series).filter((t) => chartWeeks.includes(t.week)), [trendWeeks, selectedMetric, series, chartWeeks]);

  const byMarket = useMemo(() => ceoByMarket(api.data.daily, sectionWeek, f.ceoChannel, prevSectionWeek, f.orders), [api.data.daily, sectionWeek, f.ceoChannel, prevSectionWeek, f.orders]);
  const journey = useMemo(() => ceoJourney(api.data.funnel, { from: cur.from, to: cur.to }, f.ceoChannel), [api.data.funnel, cur.from, cur.to, f.ceoChannel]);
  const prevJourney = useMemo(() => ceoJourney(api.data.funnel, { from: cmp.from, to: cmp.to }, f.ceoChannel), [api.data.funnel, cmp.from, cmp.to, f.ceoChannel]);
  const releaseRows = useMemo(
    () => ceoReleases(api.data.releases, api.data.daily, { from: cur.from, to: cur.to }, { from: cmp.from, to: cmp.to }),
    [api.data.releases, api.data.daily, cur.from, cur.to, cmp.from, cmp.to],
  );
  const releaseSources = useMemo(() => ceoReleaseSources(releaseRows), [releaseRows]);
  const latestRelease = useMemo(() => api.data.releases.reduce<string | null>((m, r) => (!m || r.bangkok_date > m ? r.bangkok_date : m), null), [api.data.releases]);
  const releaseCounts = useMemo(() => {
    const out = Object.fromEntries(RELEASE_VERDICTS.map((v) => [v, 0])) as Record<ReleaseVerdict, number>;
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
          This week is still in progress: {partial.daysIn} of 7 days are in. Totals aren&apos;t compared with full weeks
          {sessionsIncomplete ? "." : ", but conversion and bounce rate are."}
        </div>
      )}
      {sessionsIncomplete && (
        <div className="field-warn" role="status">
          Visits for the latest day are still coming in (orders arrive sooner), so conversion and bounce rate here are provisional and aren&apos;t compared yet. Use Refresh data later today.
        </div>
      )}

      <div className="scorecard-strip" role="group" aria-label="Key metrics">
        {tiles.map((t) => (
          <ScorecardTileButton key={t.key} tile={t} selected={selectedMetric === t.key} onSelect={() => setSelectedMetric(t.key)} />
        ))}
      </div>

      <section className="panel">
        <h2>{METRICS[selectedMetric].label} by week</h2>
        <div className="sub">
          {chartWeeks === inRangeWeeks ? `Weeks in ${fmtRange(cur.from, cur.to)}` : `${periodLabel} highlighted`} · click a week to select it
        </div>
        <TrendChart trend={trend} metricKey={selectedMetric} highlighted={inRangeWeeks} onSelectWeek={selectWeek} reduced={reduced} />
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
            {journey.weeks.length ? (journey.weeks.length === 1 ? `Week of ${fmtDate(journey.weeks[0])}` : `Weeks of ${fmtRange(journey.weeks[0], journey.weeks[journey.weeks.length - 1])}`) : periodLabel} · {CHANNEL_LABEL[f.ceoChannel]}
          </div>
          {f.ceoMarket !== "all" && <p className="note">This journey isn&apos;t split by market — it covers all markets.</p>}
          {journey.minWeek && cur.to < journey.minWeek && <p className="note">Shopping-journey data starts the week of {fmtDate(journey.minWeek)}.</p>}
          <JourneyChart steps={journey.steps} prevSteps={prevJourney.steps} prevLabel={weekMatch ? "week before" : "previous period"} />
        </section>
      </div>

      <section className="panel" style={{ marginTop: 12 }}>
        <h2>{weekMatch ? "Did this week's releases help?" : `Did releases from ${fmtRange(cur.from, cur.to)} help?`}</h2>
        <p className="sub">
          Production releases from the API, the website and the iOS and Android apps that went live {weekMatch ? `the week of ${fmtDate(weekMatch)}` : fmtRange(cur.from, cur.to)}. For each one we compare conversion in the days after it went live with the days before, on every platform it affects (an API change affects them all). Helped/Hurt only when the change is too big to be normal ups and downs. Timing, not proof of cause. Covers all markets.
        </p>
        <p className="sub">
          {releaseSources.length ? `${releaseSources.reduce((n, s) => n + s.releases, 0)} releases: ${releaseSources.map((s) => `${s.source} ${s.releases}`).join(" · ")}` : "No releases"}
          {latestRelease && ` · release data up to ${fmtDate(latestRelease)}`}
        </p>
        <div className="chips" style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "8px 0" }}>
          {RELEASE_VERDICTS.filter((k) => releaseCounts[k] > 0 || k === "Helped" || k === "Hurt").map((k) => (
            <span key={k} className={`badge ${RESULT_BADGE[k]}`}>
              {k}: {releaseCounts[k]}
            </span>
          ))}
        </div>
        {releaseRows.length ? (
          <table className="scroll">
            <thead>
              <tr>
                <th scope="col">What shipped</th>
                <th scope="col">Shipped in</th>
                <th scope="col">Went live</th>
                <th scope="col">Measured on</th>
                <th scope="col">Result</th>
                <th scope="col">Conversion before</th>
                <th scope="col">After</th>
                <th scope="col">Change</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {releaseRows.map((r) => (
                <tr key={r.key} title={`${r.ids.join(", ")}${r.prTitles.length ? " · " + r.prTitles.join("; ") : ""}`}>
                  <th scope="row">{r.what}</th>
                  <td>{r.source}</td>
                  <td>{r.wentLive}</td>
                  <td>{r.measuredOn}</td>
                  <td className={RESULT_CLASS[r.result]} style={{ fontWeight: 600 }}>
                    {r.result}
                  </td>
                  <td>{r.before}</td>
                  <td>{r.after}</td>
                  <td className={RESULT_CLASS[r.result]}>{r.change}</td>
                  <td className="rel-notes">{r.notes.join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No releases went live in this period, so there&apos;s nothing to measure.</p>
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
          <dt>Release results</dt>
          <dd>
            Each of the 7 days after a release is compared with the same weekday a week earlier. Days with incomplete tracking, a sale or order spike, or a traffic spike are left out with their pair.{" "}
            <strong>Helped / Hurt</strong>: conversion moved more than normal ups and downs explain (95% sure). <strong>Likely helped / Likely hurt</strong>: the direction is probable (80% sure) but not proven — usually because there are few orders. <strong>No clear effect</strong>: within normal ups and downs.{" "}
            <strong>Can&apos;t compare</strong>: the visit count itself jumped (a tracking change) or too many days were unusable. <strong>Too early to tell</strong>: fewer than 3 full days since go-live. A timing comparison, not proof the release caused it.
          </dd>
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

function TrendChart({ trend, metricKey, highlighted, onSelectWeek, reduced }: { trend: TrendPoint[]; metricKey: MetricKey; highlighted: string[]; onSelectWeek: (week: string) => void; reduced: boolean }) {
  const m = METRICS[metricKey];
  // value labels on every highlighted week while they fit; a long range keeps the hover tooltip only
  const labelHighlighted = highlighted.length <= 8;
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
          const isSelected = highlighted.includes(t.week);
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
              {((isSelected && labelHighlighted) || t.partial) && t.value != null && (
                <text x={cx} y={Math.max(12, yOf(t.value) - 6)} textAnchor="middle" fontSize="11" fontWeight={700} fill="var(--ink)">
                  {m.fmt(t.value)}
                  {t.partial ? " so far" : ""}
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

/** Share of the first step as a readable number: 1 decimal under 10, whole above. */
const fmtShare = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

/**
 * The shopping journey as a funnel: one centred bar per step (width = share of shoppers who browsed),
 * a tapered connector showing how many carried on, the biggest drop-off flagged in red, and each step's
 * share against the comparison period.
 */
function JourneyChart({ steps, prevSteps, prevLabel }: { steps: { label: string; sessions: number }[]; prevSteps: { label: string; sessions: number }[]; prevLabel: string }) {
  const top = steps[0]?.sessions ?? 0;
  if (!top) return <p className="muted journey-empty">No shopping-journey data for this period yet.</p>;
  const prevTop = prevSteps[0]?.sessions ?? 0;
  const shares = steps.map((s) => s.sessions / top);
  const carries = steps.map((s, i) => (i === 0 ? null : steps[i - 1].sessions ? s.sessions / steps[i - 1].sessions : null));
  const worst = carries.reduce<number>((wi, c, i) => (i > 0 && c != null && (carries[wi] == null || c < (carries[wi] as number)) ? i : wi), 1);
  // bars keep a visible minimum so the last step never disappears; the number beside it is exact
  const width = (share: number) => Math.max(6, share * 100);
  const per100 = shares[shares.length - 1] * 100;
  return (
    <div className="funnel">
      <p className="funnel-headline">
        Of every 100 shoppers who browsed, <strong>{per100 < 10 ? per100.toFixed(1) : Math.round(per100)}</strong> placed an order.
      </p>
      <ol className="funnel-steps">
        {steps.map((s, i) => {
          const carry = carries[i];
          const isWorst = i === worst && steps.length > 2;
          const prevShare = prevTop ? (prevSteps[i]?.sessions ?? 0) / prevTop : null;
          const delta = i > 0 && prevShare != null ? shares[i] - prevShare : null;
          const tone = delta == null || Math.abs(delta) < 0.0005 ? "flat" : delta > 0 ? "up" : "down";
          return (
            <li key={s.label} className="funnel-item">
              {i > 0 && carry != null && (
                <div className={`funnel-link ${isWorst ? "worst" : ""}`}>
                  <span
                    className="funnel-taper"
                    aria-hidden
                    style={{ clipPath: `polygon(${(100 - width(shares[i - 1])) / 2}% 0, ${(100 + width(shares[i - 1])) / 2}% 0, ${(100 + width(shares[i])) / 2}% 100%, ${(100 - width(shares[i])) / 2}% 100%)` }}
                  />
                  <span className="funnel-carry">
                    ↓ {fmtPct(carry, 0)} carried on
                    {isWorst && <span className="funnel-flag">Biggest drop-off · {fmtPct(1 - carry, 0)} left here</span>}
                  </span>
                </div>
              )}
              <div className="funnel-row">
                <div className="funnel-label">
                  <span className="funnel-icon" aria-hidden>
                    {i + 1}
                  </span>
                  <span>
                    <span className="funnel-name">{s.label}</span>
                    <span className="funnel-count">{fmtInt(s.sessions)} sessions</span>
                  </span>
                </div>
                <div className="funnel-bar-wrap" aria-hidden>
                  <span className="funnel-bar" style={{ width: `${width(shares[i])}%`, opacity: 1 - i * 0.15 }} />
                </div>
                <div className="funnel-share">
                  <strong>{fmtShare(shares[i])}</strong>
                  <span className="muted">{i === 0 ? "start" : "of browsers"}</span>
                  {delta != null && prevShare != null && (
                    <span className={`funnel-delta ${tone}`} title={`${prevLabel}: ${fmtShare(prevShare)}`}>
                      {tone === "flat" ? "≈ " : tone === "up" ? "▲ " : "▼ "}
                      {prevLabel} {fmtShare(prevShare)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
