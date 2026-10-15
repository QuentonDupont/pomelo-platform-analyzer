"use client";

import { useMemo } from "react";
import { addDays, Agg, aggregate, filterRows, fmtDate, METRICS, MetricKey, metricValue, mondayOf } from "@/lib/compute";
import { scoreReleases } from "@/lib/release-sections";
import { buildSummary, SummaryLine } from "@/lib/summary";
import { compareFor, endOf, startOf } from "./FilterBar";
import { PLATFORM_LABEL, scopeFilter, useCountUp } from "./shared";
import type { Filters, PanelProps } from "./types";

const HEADLINE: MetricKey[] = ["total", "bounce_rate", "orders", "revenue"];
const MARK: Record<string, string> = { good: "▲", bad: "▼", neutral: "•", note: "!" };

/**
 * The plain-language landing view: a handful of headline numbers, one sentence on what moved,
 * and which releases helped or hurt — for someone who wants the story, not the filter bar.
 * Reads the same aggregated rows and the same `buildSummary()` narrative as the analyst view;
 * nothing here recomputes a number differently.
 */
export default function SimpleView(props: PanelProps & { set: (p: Partial<Filters>) => void }) {
  const { api, f, cur, cmp, set, reduced } = props;

  const a = aggregate(filterRows(cur.rows, scopeFilter(f, cur.from, cur.to, f.platform)), f.orders);
  const b = aggregate(filterRows(cmp.rows, scopeFilter(f, cmp.from, cmp.to, f.platform)), f.orders);

  const lines = useMemo(() => {
    const releases = scoreReleases(api.data.releases, api.data.daily, { from: cur.from, to: cur.to }, { from: cmp.from, to: cmp.to }, f.markets);
    return buildSummary(cur, cmp, f.markets, f.orders, releases);
  }, [api.data.releases, api.data.daily, cur, cmp, f.markets, f.orders]);

  const [headline, ...rest] = lines.length ? lines : [{ tone: "neutral", text: "No notable changes this period." } as SummaryLine];

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const yesterday = addDays(today, -1);
  const applyRange = (from: string, to: string) => set({ from, to, compare: "prior", ...compareFor({ from, to, compare: "prior", cfrom: f.cfrom, cto: f.cto }) });
  const periods: { label: string; on: () => void }[] = [
    { label: "Today", on: () => applyRange(startOf(today), endOf(today)) },
    { label: "This week", on: () => applyRange(startOf(mondayOf(today)), endOf(today)) },
    { label: "Last 7 days", on: () => applyRange(startOf(addDays(yesterday, -6)), endOf(yesterday)) },
    { label: "Last 30 days", on: () => applyRange(startOf(addDays(yesterday, -29)), endOf(yesterday)) },
  ];

  return (
    <div className="simple">
      <div className="simple-controls">
        <div className="presets" role="group" aria-label="Period">
          {periods.map((p) => (
            <button key={p.label} type="button" onClick={p.on}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="seg" role="group" aria-label="Platform">
          {(["web", "app"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={f.platform === p} onClick={() => set({ platform: p })}>
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </span>
      </div>

      <section className="simple-verdict" aria-live="polite">
        <p className="simple-verdict-text">{headline.text}</p>
        <p className="simple-verdict-period muted">
          {fmtDate(cur.from)} – {fmtDate(cur.to)} vs {fmtDate(cmp.from)} – {fmtDate(cmp.to)}
        </p>
      </section>

      <div className="simple-tiles">
        {HEADLINE.map((k) => (
          <HeadlineTile key={k} metricKey={k} a={a} b={b} reduced={reduced} />
        ))}
      </div>

      {rest.length > 0 && (
        <section className="simple-detail" aria-label="What's behind the numbers">
          <h2>What&apos;s behind the numbers</h2>
          <ul>
            {rest.map((l, i) => (
              <li key={i} className={`ps-${l.tone}`}>
                <span className="ps-mark" aria-hidden>
                  {MARK[l.tone]}
                </span>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HeadlineTile({ metricKey, a, b, reduced }: { metricKey: MetricKey; a: Agg; b: Agg; reduced: boolean }) {
  const m = METRICS[metricKey];
  const value = metricValue(m, a);
  const prev = metricValue(m, b);
  const v = useCountUp(value ?? 0, reduced);
  let delta = "no comparison yet";
  let cls = "flat";
  if (value != null && prev != null) {
    const d = value - prev;
    const rel = prev !== 0 && m.kind !== "rate" ? ` (${d >= 0 ? "+" : ""}${((d / prev) * 100).toFixed(1)}%)` : "";
    delta = `${m.fmtDelta(d)}${rel} vs last period`;
    cls = Math.abs(d) < 1e-12 ? "flat" : (m.good === "up" ? d > 0 : d < 0) ? "up" : "down";
  }
  return (
    <div className="panel simple-tile">
      <div className="sub">{m.label}</div>
      <div className="simple-tile-value">{value == null ? "—" : m.fmt(v)}</div>
      <div className={`d ${cls}`}>{delta}</div>
    </div>
  );
}
