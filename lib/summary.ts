// Short, plain-English summary of the selected period vs the comparison period: what changed,
// where it came from, and which releases helped or hurt. Deterministic — built from the same
// numbers as the charts, so it can never disagree with them.
import { aggregate, Agg, comparable, decomposeChange, DailyRow, filterRows, fmtDate, METRICS, ResolvedRange, segmentAgg, segmentsFor } from "@/lib/compute";
import { Market, newcombeDiff } from "@/server/metrics/definitions";
import type { ScoreRow } from "@/lib/release-sections";

export interface SummaryLine {
  tone: "good" | "bad" | "neutral" | "note";
  text: string;
}

const pct = (v: number, dp = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(dp)}%`;
const rate = (v: number) => `${(v * 100).toFixed(2)}%`;
const n = (v: number) => Math.round(v).toLocaleString("en-US");

function convLine(label: string, a: Agg, b: Agg): SummaryLine | null {
  if (!a.nb || !b.nb || !a.orders_known || !b.orders_known) return null;
  const ca = a.orders / a.nb;
  const cb = b.orders / b.nb;
  if (!ca) return null;
  const rel = (cb - ca) / ca;
  const ci = newcombeDiff(a.orders, a.nb, b.orders, b.nb);
  const clear = Boolean(ci && (ci[0] > 0 || ci[1] < 0));
  const verdict = clear ? (rel > 0 ? "a clear rise" : "a clear drop") : "within normal ups and downs";
  return {
    tone: clear ? (rel > 0 ? "good" : "bad") : "neutral",
    text: `${label}: conversion ${rate(ca)} → ${rate(cb)} (${pct(rel)}, ${verdict}); ${n(b.orders)} orders vs ${n(a.orders)}.`,
  };
}

export function buildSummary(cur: ResolvedRange, cmp: ResolvedRange, markets: Market[], src: "backend" | "session", releases: ScoreRow[]): SummaryLine[] {
  const lines: SummaryLine[] = [];
  const agg = (r: ResolvedRange, platform: "web" | "app", device: "all" | "mobile" = "all") => aggregate(filterRows(r.rows, { from: r.from, to: r.to, platform, markets, device }), src);
  const like = comparable(cur, cmp);

  if (!cur.daysWithData) return [{ tone: "note", text: "No session data for this period yet — choose dates with data (green dots in the date picker)." }];

  // 1. Web and App headline
  for (const [label, p, dev] of [["Web", "web", "all"], ["Web mobile", "web", "mobile"], ["App", "app", "all"]] as const) {
    const l = convLine(label, agg(cmp, p, dev), agg(cur, p, dev));
    if (l) lines.push(l);
  }

  // 2. Bounce shift on web, when it is large and clear
  const wa = agg(cmp, "web");
  const wb = agg(cur, "web");
  if (wa.total && wb.total) {
    const ba = wa.bounces / wa.total;
    const bb = wb.bounces / wb.total;
    const ci = newcombeDiff(wa.bounces, wa.total, wb.bounces, wb.total);
    if (ci && (ci[0] > 0.02 || ci[1] < -0.02))
      lines.push({
        tone: bb > ba ? "bad" : "good",
        text: `Web bounce rate ${rate(ba)} → ${rate(bb)}: ${bb > ba ? "more" : "fewer"} visitors left without a second page${like ? ` (web sessions ${pct((wb.total - wa.total) / wa.total, 0)})` : ""}.`,
      });
  }

  // 3. Where the conversion change came from (market × platform), only when comparable
  if (like) {
    const segs = segmentsFor("all", markets).map((s) => ({ key: s.key, label: s.label, a: segmentAgg(cmp.rows, s, cmp.from, cmp.to, src), b: segmentAgg(cur.rows, s, cur.from, cur.to, src) }));
    const d = decomposeChange(METRICS.nonbounce_cr, segs);
    const sorted = [...d.contributions].sort((x, y) => x.total - y.total);
    const drag = sorted[0];
    const lift = sorted[sorted.length - 1];
    const parts: string[] = [];
    if (drag && drag.total < -0.0001) parts.push(`biggest drag: ${drag.label} (${(drag.total * 100).toFixed(2)} pp)`);
    if (lift && lift.total > 0.0001) parts.push(`biggest lift: ${lift.label} (+${(lift.total * 100).toFixed(2)} pp)`);
    if (parts.length) lines.push({ tone: "neutral", text: `Where it came from — ${parts.join("; ")}.` });
  }

  // 4. Releases that helped / hurt (conversion 7 days after vs 7 days before)
  const cells = releases.flatMap((r) =>
    (Object.entries(r.cells) as [string, NonNullable<ScoreRow["cells"]["web"]> | null][])
      .filter(([, c]) => c && (c.verdict === "better" || c.verdict === "worse"))
      // mobile web repeats web when both moved the same way: keep the whole-web line only
      .filter(([plat, c]) => !(plat === "web_mobile" && r.cells.web?.verdict === c!.verdict))
      .map(([plat, c]) => ({ r, plat, c: c! })),
  );
  const platName = (p: string) => (p === "web" ? "Web" : p === "web_mobile" ? "Web mobile" : p === "ios" ? "iOS" : "Android");
  // an API release is shown with the platform it was measured on, so two same-day rows don't look identical
  const fmtRel = (x: (typeof cells)[number]) =>
    `${x.r.name} (${x.r.r.platform === "backend" ? `API release, on ${platName(x.plat)}` : platName(x.plat)}, ${fmtDate(x.r.r.bangkok_date)}, ${pct(x.c.rel ?? 0, 0)})`;
  const helped = cells.filter((x) => x.c.verdict === "better").sort((a, b) => (b.c.rel ?? 0) - (a.c.rel ?? 0));
  const hurt = cells.filter((x) => x.c.verdict === "worse").sort((a, b) => (a.c.rel ?? 0) - (b.c.rel ?? 0));
  if (helped.length) lines.push({ tone: "good", text: `Helped: ${helped.slice(0, 2).map(fmtRel).join("; ")}${helped.length > 2 ? ` and ${helped.length - 2} more` : ""}.` });
  if (hurt.length) lines.push({ tone: "bad", text: `Hurt: ${hurt.slice(0, 2).map(fmtRel).join("; ")}${hurt.length > 2 ? ` and ${hurt.length - 2} more` : ""}.` });
  if (releases.length && !helped.length && !hurt.length) lines.push({ tone: "neutral", text: `None of the ${releases.length} releases in this period had a clear effect on conversion.` });

  // 5. Caveat when the periods are not like-for-like
  if (!like) lines.push({ tone: "note", text: `Partial data: this period has session data for ${cur.daysWithData} of ${cur.daysInRange} days and the comparison for ${cmp.daysWithData} of ${cmp.daysInRange} — treat totals with care.` });
  return lines;
}

export type { DailyRow };
