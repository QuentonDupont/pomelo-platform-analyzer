"use client";

import { Fragment, useMemo, useState } from "react";
import { fmtDate, fmtInt, fmtPct } from "@/lib/compute";
import { ConversionImpact, SCORE_PLATS, SCORE_WINDOW, scoreReleases } from "@/lib/release-sections";
import type { PanelProps } from "./types";

const PLATS = SCORE_PLATS;
const WINDOW = SCORE_WINDOW;
const weekday = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

/** One chart for the CEO: did each release help or hurt conversion on Web, iOS and Android? */
export default function ReleaseScorecard(props: PanelProps) {
  const { api, f, cur, cmp } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const [clearOnly, setClearOnly] = useState(false);

  const rows = useMemo(
    () => scoreReleases(api.data.releases, api.data.daily, { from: cur.from, to: cur.to }, { from: cmp.from, to: cmp.to }, f.markets),
    [api.data.releases, api.data.daily, cur.from, cur.to, cmp.from, cmp.to, f.markets],
  );

  const all = rows.flatMap((x) => PLATS.map((p) => x.cells[p.key]).filter((c): c is ConversionImpact => c != null));
  const helped = rows.filter((x) => PLATS.some((p) => x.cells[p.key]?.verdict === "better")).length;
  const hurt = rows.filter((x) => PLATS.some((p) => x.cells[p.key]?.verdict === "worse")).length;
  const shown = clearOnly ? rows.filter((x) => PLATS.some((p) => ["better", "worse"].includes(x.cells[p.key]?.verdict ?? ""))) : rows;

  return (
    <section className="panel scorecard" id="panel-release-scorecard" aria-labelledby="scorecard-h">
      <header className="sc-head">
        <div>
          <h2 id="scorecard-h" className="sc-title">
            Did each release help or hurt conversion?
          </h2>
          <p className="sc-sub">
            Releases that went live {fmtDate(cur.from)} – {fmtDate(cur.to)}. Each cell compares conversion on that platform in the {WINDOW} days after the release with the {WINDOW} days before it. Releases on the same day and platform are shown together. Click a release to see what changed.
          </p>
        </div>
        <label className="sc-toggle">
          <input type="checkbox" checked={clearOnly} onChange={(e) => setClearOnly(e.target.checked)} /> Only clear changes
        </label>
      </header>

      {rows.length ? (
        <p className="sc-verdict" role="status">
          <strong>{rows.length}</strong> release{rows.length === 1 ? "" : "s"} in this period: <span className="sc-good">{helped} clearly helped</span>, <span className="sc-bad">{hurt} clearly hurt</span>,{" "}
          {rows.length - new Set(rows.filter((x) => PLATS.some((p) => ["better", "worse"].includes(x.cells[p.key]?.verdict ?? ""))).map((x) => x.r.id)).size} made no clear difference
          {all.some((c) => c.verdict === "too early") ? " (some are too recent to judge)" : ""}.
        </p>
      ) : (
        <p className="sc-verdict">No releases went live in this period. Choose a wider date range above.</p>
      )}

      {shown.length > 0 && (
        <div className="scroll">
          <table className="sc-table">
            <thead>
              <tr>
                <th scope="col" className="sc-rel">
                  Release
                </th>
                {PLATS.map((p) => (
                  <th key={p.key} scope="col" className="sc-col">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ r, ids, releases, prs, name, where, cells }) => (
                <Fragment key={r.id}>
                  <tr className="sc-row">
                    <th scope="row" className="sc-rel">
                      <button type="button" className="sc-name" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                        <span className="sc-date">
                          {weekday(r.bangkok_date)} {fmtDate(r.bangkok_date)}
                        </span>
                        <span className="sc-what">{name}</span>
                        <span className="sc-where">
                          {where.label} · {releases > 1 ? `${releases} releases · ` : ""}
                          {prs.length} change{prs.length === 1 ? "" : "s"} {openId === r.id ? "▴" : "▾"}
                        </span>
                      </button>
                    </th>
                    {PLATS.map((p) => (
                      <ScoreCell key={p.key} c={cells[p.key]} platform={p.label} release={name} />
                    ))}
                  </tr>
                  {openId === r.id && (
                    <tr className="sc-detail">
                      <td colSpan={4}>
                        <ul>
                          {prs.map((p) => (
                            <li key={p.number}>
                              <span className="muted">#{p.number}</span> {p.title}
                            </li>
                          ))}
                          {!prs.length && <li className="muted">Redeploy with no code changes.</li>}
                        </ul>
                        <div className="sub">
                          {ids.join(", ")} · went live {fmtDate(r.bangkok_date)}{" "}
                          {r.go_live_at ? new Date(r.go_live_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : ""} Bangkok time
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="sc-legend" aria-label="How to read the cells">
        <span>
          <span className="sc-chip better">▲</span> clearly better
        </span>
        <span>
          <span className="sc-chip worse">▼</span> clearly worse
        </span>
        <span>
          <span className="sc-chip flat">–</span> no clear change (within normal ups and downs)
        </span>
        <span className="muted">— not shipped there · “too early” = fewer than 3 days of data since the release</span>
      </div>
      <p className="sc-foot">
        Conversion = orders ÷ non-bounce sessions. “Clearly” means the change is bigger than normal day-to-day noise (95% confidence). This shows what changed after each release, not proof that the release caused it — releases a few days apart overlap. Hover a cell for the exact numbers.
      </p>
    </section>
  );
}

function ScoreCell({ c, platform, release }: { c: ConversionImpact | null; platform: string; release: string }) {
  if (!c)
    return (
      <td className="sc-cell na" aria-label={`${release} was not shipped on ${platform}`}>
        <span className="sc-na">—</span>
      </td>
    );
  if (c.verdict === "too early" || c.verdict === "no data")
    return (
      <td className="sc-cell na" aria-label={`${release} on ${platform}: ${c.verdict}`}>
        <span className="sc-na small">{c.verdict === "too early" ? "too early" : "no data"}</span>
      </td>
    );
  const cls = c.verdict === "better" ? "better" : c.verdict === "worse" ? "worse" : "flat";
  const arrow = c.verdict === "better" ? "▲" : c.verdict === "worse" ? "▼" : "●";
  const pct = c.rel == null ? "—" : `${c.rel >= 0 ? "+" : "−"}${Math.abs(c.rel * 100).toFixed(1)}%`;
  const tip = `${platform} conversion ${fmtPct(c.before.value, 2)} → ${fmtPct(c.after.value, 2)} (${pct})\nBefore: ${c.before.from} → ${c.before.to} (${c.before.label}), ${fmtInt(c.before.orders)} orders / ${fmtInt(c.before.sessions)} sessions\nAfter: ${c.after.from} → ${c.after.to}, ${fmtInt(c.after.orders)} orders / ${fmtInt(c.after.sessions)} sessions`;
  if (cls === "flat")
    return (
      <td className="sc-cell flat" title={tip} aria-label={`${release} on ${platform}: no clear change in conversion (${pct}, within normal variation)`}>
        <span className="sc-flat">No clear change</span>
        <span className="sc-abs">
          {pct} · {fmtPct(c.before.value, 2)} → {fmtPct(c.after.value, 2)}
        </span>
      </td>
    );
  return (
    <td className={`sc-cell ${cls}`} title={tip} aria-label={`${release} on ${platform}: conversion ${c.verdict}, ${pct}, from ${fmtPct(c.before.value, 2)} to ${fmtPct(c.after.value, 2)}`}>
      <span className="sc-arrow" aria-hidden>
        {arrow}
      </span>
      <span className="sc-pct">{pct}</span>
      <span className="sc-abs">
        {fmtPct(c.before.value, 2)} → {fmtPct(c.after.value, 2)}
      </span>
    </td>
  );
}
