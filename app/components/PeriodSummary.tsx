"use client";

import { useMemo } from "react";
import { fmtDate } from "@/lib/compute";
import { scoreReleases } from "@/lib/release-sections";
import { buildSummary } from "@/lib/summary";
import type { PanelProps } from "./types";

const MARK: Record<string, string> = { good: "▲", bad: "▼", neutral: "•", note: "!" };

/** A few plain sentences that rewrite themselves whenever the dates or filters change. */
export default function PeriodSummary({ api, f, cur, cmp }: PanelProps) {
  const lines = useMemo(() => {
    const releases = scoreReleases(api.data.releases, api.data.daily, { from: cur.from, to: cur.to }, { from: cmp.from, to: cmp.to }, f.markets);
    return buildSummary(cur, cmp, f.markets, f.orders, releases);
  }, [api.data.releases, api.data.daily, cur, cmp, f.markets, f.orders]);
  return (
    <section className="period-summary" aria-labelledby="period-summary-h" aria-live="polite">
      <h2 id="period-summary-h">
        What changed · {fmtDate(cur.from)} – {fmtDate(cur.to)} <span className="muted">vs {fmtDate(cmp.from)} – {fmtDate(cmp.to)}</span>
      </h2>
      <ul>
        {lines.map((l, i) => (
          <li key={i} className={`ps-${l.tone}`}>
            <span className="ps-mark" aria-hidden>
              {MARK[l.tone]}
            </span>
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
