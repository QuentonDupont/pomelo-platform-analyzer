"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { aggregate, Agg, DailyRow, Filter, filterRows, OrdersSource } from "@/lib/compute";
import type { Filters } from "./types";

export const PLATFORM_LABEL = { web: "Web", app: "App (iOS + Android)", ios: "iOS", android: "Android" } as const;
export const PLATFORM_COLOR: Record<string, string> = {
  web: "var(--web)",
  app: "var(--app)",
  ios: "var(--ios)",
  android: "var(--android)",
  backend: "var(--unknown)",
  unknown: "var(--unknown)",
};

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function useCountUp(target: number, reduced: boolean, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setV(a + (target - a) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, ms]);
  return v;
}

/** Day-grain filter for resolved rows, using global market/device filters. */
export function scopeFilter(f: Filters, from: string, to: string, platform: Filter["platform"]): Filter {
  return { from, to, platform, markets: f.markets, device: platform === "web" || platform === "all" ? f.device : "all" };
}

export function agg(rows: DailyRow[], f: Filters, platform: Filter["platform"], src: OrdersSource = f.orders): Agg {
  const days = rows.map((r) => r.day).sort();
  return aggregate(filterRows(rows, scopeFilter(f, days[0] ?? "0000", days[days.length - 1] ?? "9999", platform)), src);
}

export function Panel({ title, sub, children, badge, right, id }: { title: ReactNode; sub?: ReactNode; children: ReactNode; badge?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <section className="panel" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <h2 id={id ? `${id}-h` : undefined}>
            {title} {badge}
          </h2>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
  );
}

export const RealBadge = ({ text = "REAL DATA" }: { text?: string }) => <span className="badge b-High">{text}</span>;
export const PendingBadge = ({ text }: { text: string }) => <span className="badge b-Medium">{text}</span>;

/** Standard placeholder when a source is missing: names the missing source, never draws a fake chart. */
export function NotEvidenced({ what, needs }: { what: string; needs: string }) {
  return (
    <div className="not-evidenced" role="note">
      <strong>{what}: not evidenced.</strong> <span className="muted">Needs {needs}.</span>
    </div>
  );
}

export function Delta({ cur, prev, pp, good = "up", dp = 1 }: { cur: number | null; prev: number | null; pp?: boolean; good?: "up" | "down"; dp?: number }) {
  if (cur == null || prev == null || (!pp && prev === 0)) return <span className="flat">—</span>;
  const d = cur - prev;
  const cls = Math.abs(d) < 1e-12 ? "flat" : (good === "up" ? d > 0 : d < 0) ? "up" : "down";
  const txt = pp ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)} pp` : `${d >= 0 ? "+" : ""}${((d / prev) * 100).toFixed(dp)}%`;
  return <span className={cls}>{txt}</span>;
}
