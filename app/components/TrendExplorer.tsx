"use client";

import { KeyboardEvent, PointerEvent, useMemo, useRef, useState } from "react";
import { daysBetween, fmtDate, METRIC_KEYS, METRICS, metricSeries, parseLocal, SeriesPoint } from "@/lib/compute";
import type { PlatformFilter } from "@/server/metrics/definitions";
import { NotEvidenced, Panel, PLATFORM_COLOR, PLATFORM_LABEL, RealBadge } from "./shared";
import { ChartOrTable, Legend, niceTicks, Tip, tipLeft } from "./viz";
import type { Filters, PanelProps } from "./types";

type Series = { id: string; label: string; color: string; pts: SeriesPoint[]; dashed?: boolean; cmp?: boolean };

export default function TrendExplorer(props: PanelProps & { set: (p: Partial<Filters>) => void }) {
  const { api, f, cur, cmp, set } = props;
  const m = METRICS[f.metric];
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<SVGSVGElement>(null);

  // Hour grain when the range is ≤ 2 days and hourly rows exist; otherwise days.
  const spanDays = daysBetween(cur.from, cur.to) + 1;
  const hourly = spanDays <= 2 && api.data.hourly.some((h) => h.day >= cur.from && h.day <= cur.to) ? api.data.hourly : undefined;
  const grain = hourly ? "hour" : "day";

  const scopes: PlatformFilter[] = useMemo(() => (f.split ? ["web", "ios", "android"] : ["web", "app"]), [f.split]);
  const focus: PlatformFilter = scopes.includes(f.platform) ? f.platform : f.platform === "ios" || f.platform === "android" ? "app" : "web";
  const series: Series[] = useMemo(() => {
    const flt = (p: PlatformFilter, from: string, to: string) => ({ from, to, platform: p, markets: f.markets, device: p === "web" ? f.device : ("all" as const) });
    const s: Series[] = scopes.map((p) => ({ id: p, label: PLATFORM_LABEL[p], color: PLATFORM_COLOR[p], pts: metricSeries(m, cur.rows, flt(p, cur.from, cur.to), f.orders, hourly) }));
    const c = metricSeries(m, cmp.rows, flt(focus, cmp.from, cmp.to), f.orders, hourly ? api.data.hourly : undefined);
    s.push({ id: "cmp", label: `${PLATFORM_LABEL[focus]} — comparison period`, color: "var(--cmp)", pts: c, cmp: true });
    return s;
  }, [m, cur, cmp, f.markets, f.device, f.orders, hourly, api.data.hourly, focus, scopes]);

  const n = Math.max(...series.map((s) => s.pts.length), 0);
  const W = 860;
  const H = 260;
  const pad = { l: 64, r: 150, t: 12, b: 34 };
  const vals = series.flatMap((s) => s.pts.flatMap((p) => (p.value == null ? [] : [p.value, ...(p.ci && !s.cmp && s.id === focus ? p.ci : [])])));
  const lo = m.kind === "count" || m.kind === "money" ? 0 : Math.min(...vals);
  const ticks = niceTicks(lo, Math.max(...vals, lo + 1e-9), 5);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (i: number) => pad.l + (n <= 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const labels = series[0]?.pts.map((p) => p.t) ?? [];
  const fmtT = (t: string) => (grain === "hour" ? `${fmtDate(t.slice(0, 10))} ${t.slice(11, 13)}:00` : fmtDate(t));
  const every = Math.max(1, Math.ceil(n / 8));

  // Releases on the visible days, as flags on the axis.
  const rels = grain === "day" ? api.data.releases.filter((r) => labels.includes(r.bangkok_date)) : [];

  const path = (pts: SeriesPoint[]) => {
    let d = "";
    let pen = false;
    pts.forEach((p, i) => {
      if (p.value == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const band = (pts: SeriesPoint[]) => {
    const ok = pts.map((p, i) => ({ p, i })).filter(({ p }) => p.ci);
    if (ok.length < 2) return "";
    return `M${ok.map(({ p, i }) => `${x(i)},${y(p.ci![1])}`).join("L")}L${[...ok].reverse().map(({ p, i }) => `${x(i)},${y(p.ci![0])}`).join("L")}Z`;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    if (e.key === "Escape") setHover(null);
  };

  const noTraffic = !series.some((s) => !s.cmp && s.pts.some((p) => p.agg.total > 0));
  const unavailable = noTraffic || (m.needsOrders && (cur.ordersUnavailable || !series[0]?.pts.some((p) => p.value != null)));
  const tipRows = (i: number) =>
    series.map((s) => {
      const p = s.pts[i];
      const den = p ? m.den(p.agg) : null;
      return {
        key: s.id,
        color: s.color,
        value: p?.value == null ? "—" : m.fmt(p.value),
        label: s.cmp ? `${s.label} (${p ? fmtT(p.t) : "—"})` : s.label,
        sub: p
          ? `${m.denLabel ? `${p.agg && m.num(p.agg).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${m.numLabel} ÷ ${den?.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${m.denLabel}` : `n = ${p.agg.total.toLocaleString("en-US")} sessions`}${p.ci ? ` · 95% CI ${m.fmt(p.ci[0])}–${m.fmt(p.ci[1])}` : ""}`
          : undefined,
      };
    });

  const chart = (
    <div className="viz">
      <svg
        ref={plotRef}
        className="viz-plot"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        tabIndex={0}
        aria-label={`${m.label} by ${grain}, ${series.map((s) => `${s.label}: ${s.pts.length ? m.fmt(s.pts[s.pts.length - 1].value) : "no data"} at end`).join("; ")}. Use left and right arrow keys to read values.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <g className="viz-grid">
          {ticks.map((t) => (
            <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="viz-axis">
          {ticks.map((t) => (
            <text key={t} x={pad.l - 8} y={y(t) + 3.5} textAnchor="end">
              {m.fmt(t)}
            </text>
          ))}
          {labels.map((t, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={t} x={x(i)} y={H - 14} textAnchor="middle">
                {grain === "hour" ? `${t.slice(11, 13)}:00` : fmtDate(t)}
              </text>
            ) : null,
          )}
          <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line)" />
        </g>
        {/* 95% band for the focused series (rates & money ratios only) */}
        {series
          .filter((s) => s.id === focus && !s.cmp)
          .map((s) => (
            <path key={`band-${s.id}`} d={band(s.pts)} fill={s.color} opacity={0.12} />
          ))}
        {series.map((s) => (
          <path key={s.id} d={path(s.pts)} fill="none" stroke={s.color} strokeWidth={s.cmp ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* direct labels at line ends (relief for low-contrast hues) */}
        {(() => {
          // end labels, pushed apart so they never overlap (min 15px), each tied to its line by a leader
          const ends = series
            .map((s) => {
              const last = [...s.pts].reverse().find((p) => p.value != null);
              return last ? { s, last, i: s.pts.lastIndexOf(last), y: y(last.value!), ly: y(last.value!) } : null;
            })
            .filter((e): e is NonNullable<typeof e> => e != null)
            .sort((a, b) => a.y - b.y);
          for (let k = 1; k < ends.length; k++) ends[k].ly = Math.max(ends[k].ly, ends[k - 1].ly + 15);
          const overflow = ends.length ? ends[ends.length - 1].ly - (H - pad.b) : 0;
          if (overflow > 0) for (const e of ends) e.ly -= overflow;
          return ends.map((e) => (
            <g key={`lab-${e.s.id}`}>
              <circle cx={x(e.i)} cy={e.y} r={3.5} fill={e.s.color} stroke="var(--panel)" strokeWidth={2} />
              <line x1={x(e.i) + 5} x2={W - pad.r + 4} y1={e.y} y2={e.ly} stroke={e.s.color} strokeOpacity={0.5} />
              <text x={W - pad.r + 8} y={e.ly + 4} fontSize="11" fill="var(--ink)">
                <tspan fontWeight={700}>{m.fmt(e.last.value)}</tspan>
                <tspan fill="var(--muted)"> {e.s.cmp ? "comparison" : e.s.label}</tspan>
              </text>
            </g>
          ));
        })()}
        {rels.map((r) => {
          const i = labels.indexOf(r.bangkok_date);
          return (
            <g key={r.id}>
              <title>{`${r.repo} ${r.release_id} went live ${r.bangkok_date}`}</title>
              <path d={`M${x(i)},${H - pad.b} l-4,7 l8,0 z`} fill={PLATFORM_COLOR[r.platform]} />
            </g>
          );
        })}
        <rect className="viz-hit" x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} />
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--ink)" strokeOpacity={0.35} />
            {series.map((s) => (s.pts[hover]?.value == null ? null : <circle key={s.id} cx={x(hover)} cy={y(s.pts[hover].value!)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />))}
          </g>
        )}
      </svg>
      {hover != null && labels[hover] && (
        <Tip
          x={tipLeft((x(hover) / W) * 100, 300)}
          y={8}
          title={fmtT(labels[hover])}
          rows={tipRows(hover)}
          foot={rels.filter((r) => r.bangkok_date === labels[hover]).map((r) => `Release: ${r.repo} ${r.release_id}`).join(" · ") || undefined}
          width={300}
        />
      )}
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      {rels.length > 0 && <div className="sub">▲ on the axis = production release (colour = platform). Hover the chart or use arrow keys for exact numbers.</div>}
    </div>
  );

  const table = (
    <table>
      <thead>
        <tr>
          <th>{grain === "hour" ? "Hour (ICT)" : "Day"}</th>
          {series.map((s) => (
            <th key={s.id}>{s.label}</th>
          ))}
          {series.map((s) => (
            <th key={`n-${s.id}`}>n · {s.cmp ? "comparison" : s.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((t, i) => (
          <tr key={t}>
            <td>{fmtT(t)}</td>
            {series.map((s) => (
              <td key={s.id}>{m.fmt(s.pts[i]?.value ?? null)}</td>
            ))}
            {series.map((s) => (
              <td key={`n-${s.id}`}>{s.pts[i] ? (m.den(s.pts[i].agg) ?? s.pts[i].agg.total).toLocaleString("en-US") : "—"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Panel
      id="panel-trend"
      title={`Trend · ${m.label}`}
      badge={<RealBadge />}
      sub={
        <>
          {grain === "hour" ? "Hourly" : "Daily"} values for {parseLocal(f.from).day} → {parseLocal(f.to).day}, one line per platform; grey = {PLATFORM_LABEL[focus]} in the comparison period, aligned day-by-day.
          {m.kind === "rate" ? " Shaded band = 95% Wilson interval for the highlighted platform." : ""}
          {m.denLabel ? ` ${m.label} = ${m.numLabel} ÷ ${m.denLabel}.` : ""}
        </>
      }
      right={
        <div className="chart-controls">
          <label className="inline">
            Metric{" "}
            <select value={f.metric} onChange={(e) => set({ metric: e.target.value as Filters["metric"] })}>
              {METRIC_KEYS.map((k) => (
                <option key={k} value={k}>
                  {METRICS[k].label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" aria-pressed={f.split} onClick={() => set({ split: !f.split })}>
            {f.split ? "Combine app" : "Split iOS / Android"}
          </button>
        </div>
      }
    >
      {unavailable ? (
        <NotEvidenced
          what={`${m.label} for this range`}
          needs={noTraffic ? `session data for ${cur.from} → ${cur.to} in the cache (latest synced traffic day: ${props.api.data.calendar.latest ?? "none"})` : "orders at this precision (hourly orders are not available for partial days)"}
        />
      ) :<ChartOrTable label={`${m.label} trend`} chart={chart} table={table} />}
    </Panel>
  );
}
