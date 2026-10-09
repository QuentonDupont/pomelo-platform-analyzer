"use client";

import { Fragment, useMemo, useState } from "react";
import { addDays, fmtDate, fmtInt, fmtPct } from "@/lib/compute";
import { classifyPr, RelPlatform, scopesFor, SECTION_METRIC, sectionImpact, SectionId, SectionImpact, sectionLabel, SECTIONS } from "@/lib/release-sections";
import { Panel, PLATFORM_COLOR, RealBadge } from "./shared";
import { Legend } from "./viz";
import type { PanelProps, ReleaseView } from "./types";

const LANES: RelPlatform[] = ["web", "ios", "android", "backend"];
const LANE_LABEL: Record<RelPlatform, string> = { web: "Web", ios: "iOS", android: "Android", backend: "Backend (affects all)" };
const VERDICT_COLOR: Record<SectionImpact["verdict"], string> = { better: "var(--good)", worse: "var(--bad)", "no clear change": "var(--muted)", "not enough days": "var(--amber)", "no data": "var(--unknown)" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Enriched = ReleaseView & {
  prSections: { number: number; title: string; sections: SectionId[] }[];
  sections: { id: SectionId; prs: number }[];
  rangeImpacts: SectionImpact[];
  headline: SectionImpact["verdict"];
};

const fmtMetric = (m: SectionImpact["metric"], v: number | null) => (v == null ? "—" : m === "search_rate" ? v.toFixed(3) : fmtPct(v, m === "nonbounce_cr" || m === "atb_order" ? 2 : 1));
const fmtDiff = (m: SectionImpact["metric"], v: number | null) => (v == null ? "—" : m === "search_rate" ? `${v >= 0 ? "+" : ""}${v.toFixed(3)}` : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(m === "nonbounce_cr" || m === "atb_order" ? 2 : 1)} pp`);
const goLiveTime = (r: ReleaseView) => (r.go_live_at ? new Date(r.go_live_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "");

export default function Releases(props: PanelProps) {
  const { api, f, cur, cmp } = props;
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // Semantic mapping + range-driven impact for every release (recomputed whenever range, comparison or markets change)
  const enriched: Enriched[] = useMemo(() => {
    const range = { from: cur.from, to: cur.to };
    const comp = { from: cmp.from, to: cmp.to };
    return api.data.releases.map((r) => {
      const prSections = r.prs.map((p) => ({ number: p.number, title: p.title, sections: classifyPr(p.title, p.dirs) }));
      const counts = new Map<SectionId, number>();
      for (const p of prSections) for (const s of p.sections) counts.set(s, (counts.get(s) ?? 0) + 1);
      const sections = SECTIONS.filter((s) => counts.has(s.id)).map((s) => ({ id: s.id, prs: counts.get(s.id)! }));
      const inRange = r.bangkok_date >= cur.from && r.bangkok_date <= cur.to;
      const rangeImpacts = inRange ? sections.flatMap((s) => scopesFor(r.platform as RelPlatform).map((sc) => sectionImpact(api.data.daily, r.bangkok_date, s.id, sc.key, range, comp, f.markets))) : [];
      const headline: SectionImpact["verdict"] = rangeImpacts.some((i) => i.verdict === "worse") ? "worse" : rangeImpacts.some((i) => i.verdict === "better") ? "better" : rangeImpacts.length ? "no clear change" : "no data";
      return { ...r, prSections, sections, rangeImpacts, headline };
    });
  }, [api.data.releases, api.data.daily, cur.from, cur.to, cmp.from, cmp.to, f.markets]);

  const inRange = enriched.filter((r) => r.bangkok_date >= cur.from && r.bangkok_date <= cur.to);
  const listed = (day ? enriched.filter((r) => r.bangkok_date === day) : inRange).sort((a, b) => (b.go_live_at ?? b.bangkok_date).localeCompare(a.go_live_at ?? a.bangkok_date));

  // section summary for the range: which sections each platform changed
  const summary = SECTIONS.map((s) => ({
    s,
    per: LANES.map((p) => inRange.filter((r) => r.platform === p && r.sections.some((x) => x.id === s.id))),
  })).filter((x) => x.per.some((l) => l.length));

  return (
    <>
      <Timeline enriched={enriched} props={props} selectDay={(d) => setDay(d)} selected={day} />
      <ReleaseCalendar enriched={enriched} range={{ from: cur.from, to: cur.to }} selected={day} onSelect={setDay} />

      <Panel
        id="panel-release-sections"
        title="What was launched, by section"
        badge={<RealBadge text="REAL — GitHub production deploys" />}
        sub={`Production releases from ${fmtDate(cur.from)} to ${fmtDate(cur.to)}, mapped to the same sections as the funnel from each PR's title and changed folders. Backend (API) releases can affect web and both apps.`}
      >
        {summary.length ? (
          <div className="scroll">
            <table className="sec-matrix">
              <thead>
                <tr>
                  <th scope="col">Section</th>
                  {LANES.map((p) => (
                    <th key={p} scope="col">
                      <span className="sw" style={{ background: PLATFORM_COLOR[p] }} /> {LANE_LABEL[p]}
                    </th>
                  ))}
                  <th scope="col">Measured by</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(({ s, per }) => (
                  <tr key={s.id}>
                    <th scope="row">{s.label}</th>
                    {per.map((list, i) => (
                      <td key={LANES[i]}>{list.length ? `${list.length} release${list.length > 1 ? "s" : ""} · ${list.reduce((a, r) => a + (r.sections.find((x) => x.id === s.id)?.prs ?? 0), 0)} PRs` : <span className="muted">—</span>}</td>
                    ))}
                    <td className="muted">{SECTION_METRIC[s.metric].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No production releases in the selected range.</p>
        )}
      </Panel>

      <Panel
        id="panel-release-table"
        title={day ? `Releases on ${fmtDate(day)} (${listed.length})` : `Releases in range (${listed.length})`}
        sub={
          <>
            Impact follows your date range: <strong>after</strong> = go-live → {fmtDate(cur.to)}; <strong>before</strong> = {fmtDate(cur.from)} → day before go-live, or the comparison period ({fmtDate(cmp.from)} – {fmtDate(cmp.to)}) when fewer than 3 days come before. 95% interval by bootstrap over days. Changes are vs before, not caused by the release — overlapping releases are listed.
          </>
        }
        right={
          day ? (
            <button type="button" onClick={() => setDay(null)}>
              Show whole range
            </button>
          ) : undefined
        }
      >
        {!listed.length && <p className="muted">{day ? "Nothing went live on this day." : "No production releases in the selected range."}</p>}
        <div className="rel-list">
          {listed.map((r) => (
            <ReleaseItem key={r.id} r={r} all={enriched} open={open === r.id || listed.length <= 3} toggle={() => setOpen(open === r.id ? null : r.id)} outOfRange={!(r.bangkok_date >= cur.from && r.bangkok_date <= cur.to)} />
          ))}
        </div>
      </Panel>
    </>
  );
}

// ---------------- timeline ----------------
function Timeline({ enriched, props, selectDay, selected }: { enriched: Enriched[]; props: PanelProps; selectDay: (d: string) => void; selected: string | null }) {
  const { cur } = props;
  const from = addDays(cur.from, -7);
  const to = addDays(cur.to, 7);
  const t = (d: string) => new Date(d + "T00:00:00Z").getTime();
  const W = 900;
  const x = (d: string) => 150 + ((t(d) - t(from)) / Math.max(1, t(to) - t(from))) * (W - 170);
  const ticks: string[] = [];
  for (let d = from; d <= to; d = addDays(d, Math.max(1, Math.round((t(to) - t(from)) / 86400000 / 8)))) ticks.push(d);
  const inView = enriched.filter((r) => r.bangkok_date >= from && r.bangkok_date <= to);
  return (
    <Panel
      id="panel-releases"
      title="Release timeline"
      badge={<RealBadge text="REAL — GitHub production deploys" />}
      sub="One flag per production go-live (successful prod deploy; Android = tag). Dot = impact in your selected range on the sections the release touched (green better, red worse, grey no clear change). Shaded = selected range. Hover for what launched; click to open that day."
    >
      <svg viewBox={`0 0 ${W} 170`} width="100%" role="group" aria-label="Release timeline">
        <rect x={x(cur.from)} y={6} width={Math.max(2, x(cur.to) - x(cur.from))} height={130} fill="var(--line)" opacity=".5" />
        {ticks.map((d) => (
          <g key={d} className="viz-axis">
            <line x1={x(d)} x2={x(d)} y1={6} y2={136} stroke="var(--grid)" />
            <text x={x(d)} y={156} textAnchor="middle">
              {fmtDate(d)}
            </text>
          </g>
        ))}
        {LANES.map((l, li) => (
          <text key={l} x={0} y={30 + li * 32} fontSize="11.5" fill="var(--ink)" fontWeight={600}>
            <tspan fill={PLATFORM_COLOR[l]}>●</tspan> {LANE_LABEL[l]}
          </text>
        ))}
        {inView.map((r) => {
          const y = 34 + LANES.indexOf(r.platform as RelPlatform) * 32;
          const title = `${r.repo} ${r.release_id} · ${r.bangkok_date} ${goLiveTime(r)} ICT\nSections: ${r.sections.map((s) => sectionLabel(s.id)).join(", ")}\n${r.prSections
            .slice(0, 6)
            .map((p) => `#${p.number} ${p.title}`)
            .join("\n")}${r.prSections.length > 6 ? `\n+${r.prSections.length - 6} more PRs` : ""}`;
          return (
            <g
              key={r.id}
              className="flag"
              tabIndex={0}
              role="button"
              aria-label={`${LANE_LABEL[r.platform as RelPlatform]} release ${r.release_id} on ${r.bangkok_date}: ${r.sections.map((s) => sectionLabel(s.id)).join(", ")}; impact ${r.headline}`}
              onClick={() => selectDay(r.bangkok_date)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectDay(r.bangkok_date)}
            >
              <title>{title}</title>
              <rect x={x(r.bangkok_date) - 8} y={y - 22} width={18} height={30} fill="transparent" />
              <line x1={x(r.bangkok_date)} x2={x(r.bangkok_date)} y1={y - 20} y2={y + 2} stroke={PLATFORM_COLOR[r.platform]} strokeWidth={selected === r.bangkok_date ? 3 : 1.5} />
              <path d={`M${x(r.bangkok_date)},${y - 20} l10,4 l-10,4 z`} fill={PLATFORM_COLOR[r.platform]} />
              <circle cx={x(r.bangkok_date)} cy={y + 6} r={3.5} fill={VERDICT_COLOR[r.headline]} stroke="var(--panel)" strokeWidth={1.5} />
            </g>
          );
        })}
      </svg>
      <Legend
        kind="rect"
        items={[
          { label: "better in range", color: "var(--good)" },
          { label: "worse in range", color: "var(--bad)" },
          { label: "no clear change", color: "var(--muted)" },
          { label: "outside range / no data", color: "var(--unknown)" },
        ]}
      />
    </Panel>
  );
}

// ---------------- calendar ----------------
function ReleaseCalendar({ enriched, range, selected, onSelect }: { enriched: Enriched[]; range: { from: string; to: string }; selected: string | null; onSelect: (d: string | null) => void }) {
  const [view, setView] = useState(() => ({ y: Number(range.to.slice(0, 4)), m: Number(range.to.slice(5, 7)) - 1 }));
  const first = `${view.y}-${String(view.m + 1).padStart(2, "0")}-01`;
  const dow = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7;
  const start = addDays(first, -dow);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, Enriched[]>();
  for (const r of enriched) byDay.set(r.bangkok_date, [...(byDay.get(r.bangkok_date) ?? []), r]);
  const shift = (d: number) => {
    const m = view.m + d;
    setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };
  const monthCount = enriched.filter((r) => r.bangkok_date.startsWith(first.slice(0, 7))).length;
  return (
    <Panel
      id="panel-release-calendar"
      title="Release calendar"
      sub={`${monthCount} production release${monthCount === 1 ? "" : "s"} in ${MONTHS[view.m]} ${view.y}. Each chip is one go-live (colour = platform, text = sections it touched). Click a day to see its PR titles and impact below. Shaded days are in your selected range.`}
      right={
        <div className="chart-controls">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <select aria-label="Month" value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })}>
            {MONTHS.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select aria-label="Year" value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })}>
            {[view.y - 1, view.y, view.y + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
      }
    >
      <div className="rel-cal" role="grid" aria-label={`Releases in ${MONTHS[view.m]} ${view.y}`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="rel-cal-dow" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const rs = byDay.get(d) ?? [];
          const outside = Number(d.slice(5, 7)) - 1 !== view.m;
          const inRange = d >= range.from && d <= range.to;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              className={`rel-cal-day${outside ? " outside" : ""}${inRange ? " in-range" : ""}${selected === d ? " selected" : ""}`}
              aria-selected={selected === d}
              aria-label={`${d}: ${rs.length ? `${rs.length} release${rs.length > 1 ? "s" : ""} — ${rs.map((r) => `${LANE_LABEL[r.platform as RelPlatform]} ${r.sections.map((s) => sectionLabel(s.id)).join(", ")}`).join("; ")}` : "no releases"}`}
              onClick={() => onSelect(selected === d ? null : d)}
            >
              <span className="rel-cal-num">{Number(d.slice(8, 10))}</span>
              {rs.slice(0, 3).map((r) => (
                <span key={r.id} className="rel-chip" style={{ borderLeftColor: PLATFORM_COLOR[r.platform] }}>
                  <strong>{r.platform === "backend" ? "API" : LANE_LABEL[r.platform as RelPlatform]}</strong> {r.sections.map((s) => sectionLabel(s.id)).slice(0, 2).join(", ")}
                  {r.sections.length > 2 ? ` +${r.sections.length - 2}` : ""}
                </span>
              ))}
              {rs.length > 3 && <span className="rel-chip more">+{rs.length - 3} more</span>}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------------- one release ----------------
function ReleaseItem({ r, all, open, toggle, outOfRange }: { r: Enriched; all: Enriched[]; open: boolean; toggle: () => void; outOfRange: boolean }) {
  const after = r.rangeImpacts[0]?.after;
  const confounders = after ? all.filter((o) => o.id !== r.id && o.bangkok_date >= r.bangkok_date && o.bangkok_date <= after.to && (o.platform === r.platform || o.platform === "backend" || r.platform === "backend")) : [];
  return (
    <article className="rel-item" style={{ borderLeftColor: PLATFORM_COLOR[r.platform] }}>
      <header className="rel-head">
        <div>
          <strong>
            {LANE_LABEL[r.platform as RelPlatform]} · {r.repo} {r.release_id}
          </strong>
          <div className="sub">
            Live {fmtDate(r.bangkok_date)} {goLiveTime(r)} ICT · {r.prs.length} PR{r.prs.length === 1 ? "" : "s"} {r.confounded ? "· bundled (impact is for the whole release)" : ""}
            {r.note ? ` · ${r.note}` : ""}
          </div>
          <div className="rel-sections">
            {r.sections.map((s) => (
              <span key={s.id} className="sec-chip">
                {sectionLabel(s.id)} <span className="muted">· {s.prs}</span>
              </span>
            ))}
          </div>
        </div>
        <button type="button" aria-expanded={open} onClick={toggle}>
          {open ? "Hide details" : "Show PRs & impact"}
        </button>
      </header>
      {open && (
        <div className="rel-body">
          <h3>What launched</h3>
          {r.prSections.length ? (
            <ul className="pr-list">
              {r.prSections.map((p) => (
                <li key={p.number}>
                  <span className="muted">#{p.number}</span> {p.title}{" "}
                  {p.sections.map((s) => (
                    <span key={s} className="sec-chip small">
                      {sectionLabel(s)}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No PRs recorded for this release (redeploy or version bump).</p>
          )}
          <h3>Impact in your selected range</h3>
          {outOfRange ? (
            <p className="muted">This release is outside the selected range — pick a range that includes {fmtDate(r.bangkok_date)} to measure it.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Section · platform</th>
                    <th>Measured by</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Change [95% CI]</th>
                    <th>Days (before / after)</th>
                    <th>Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rangeImpacts.map((i, k) => (
                    <Fragment key={k}>
                      <tr>
                        <td style={{ textAlign: "left" }}>
                          {sectionLabel(i.section)} · {i.scope === "web" ? "Web" : i.scope === "ios" ? "iOS" : "Android"}
                        </td>
                        <td style={{ textAlign: "left", whiteSpace: "normal" }} className="muted">
                          {SECTION_METRIC[i.metric].label}
                        </td>
                        <td title={`${i.before.label}: ${i.before.from} → ${i.before.to}`}>{fmtMetric(i.metric, i.before.value)}</td>
                        <td title={`${i.after.from} → ${i.after.to}`}>{fmtMetric(i.metric, i.after.value)}</td>
                        <td>
                          {fmtDiff(i.metric, i.diff)}
                          {i.ci ? ` [${fmtDiff(i.metric, i.ci[0])}, ${fmtDiff(i.metric, i.ci[1])}]` : ""}
                        </td>
                        <td>
                          {fmtInt(i.before.days)} / {fmtInt(i.after.days)}
                        </td>
                        <td style={{ color: VERDICT_COLOR[i.verdict], fontWeight: 600 }}>{i.verdict}</td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!outOfRange && r.rangeImpacts[0] && (
            <div className="note">
              Before = {r.rangeImpacts[0].before.label} ({r.rangeImpacts[0].before.from} → {r.rangeImpacts[0].before.to}); after = {r.rangeImpacts[0].after.from} → {r.rangeImpacts[0].after.to}. Event ratios come from session-attributed counts in the Cube session table.
              {confounders.length > 0 && ` Overlapping releases in the after window (${confounders.length}): ${confounders.map((c) => `${c.repo} ${c.bangkok_date}`).join(", ")} — part of any change may come from them.`}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
