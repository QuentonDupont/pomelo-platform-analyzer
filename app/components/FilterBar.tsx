"use client";

import { useMemo } from "react";
import DateTimePicker from "./DateTimePicker";
import { addDays, daysBetween, mondayOf, parseLocal, priorWindow } from "@/lib/compute";
import { MARKETS } from "@/server/metrics/definitions";
import { PLATFORM_LABEL } from "./shared";
import type { Api, Filters, PlatformFilter } from "./types";

/** Snap a datetime-local value to the hour: "YYYY-MM-DDTHH:mm" → "YYYY-MM-DDTHH:00". */
export const snapHour = (v: string) => (v.length >= 13 ? `${v.slice(0, 13)}:00` : v);
export const startOf = (day: string) => `${day}T00:00`;
export const endOf = (day: string) => `${day}T23:00`;

export function compareFor(f: Pick<Filters, "from" | "to" | "compare" | "cfrom" | "cto">): { cfrom: string; cto: string } {
  if (f.compare === "custom") return { cfrom: f.cfrom, cto: f.cto };
  if (f.compare === "week") {
    const a = parseLocal(f.from);
    const b = parseLocal(f.to);
    const h = (n: number) => String(n).padStart(2, "0");
    return { cfrom: `${addDays(a.day, -7)}T${h(a.hour)}:00`, cto: `${addDays(b.day, -7)}T${h(b.hour)}:00` };
  }
  const p = priorWindow(f.from, f.to);
  return { cfrom: p.from, cto: p.to };
}

/** Structural problems only — a range outside the cached data is allowed (see rangeWarning). */
export function rangeError(from: string, to: string, _min?: string | null, _max?: string | null): string | null {
  void _min;
  void _max;
  if (!from || !to) return "Choose both a From and a To date-time.";
  if (from > to) return "From must be on or before To.";
  return null;
}

/** Non-blocking note when part of the range has no data in the cache. */
export function rangeWarning(from: string, to: string, days: Set<string>, min: string | null, max: string | null): string | null {
  if (!min || !max) return "No session data in the cache yet.";
  let missing = 0;
  let total = 0;
  for (let d = from.slice(0, 10); d <= to.slice(0, 10); d = addDays(d, 1)) {
    total++;
    if (!days.has(d)) missing++;
  }
  if (!missing) return null;
  if (missing === total) return `No session data for this range yet — cached data covers ${min} → ${max}.`;
  return `${missing} of ${total} days have no session data yet (cached: ${min} → ${max}); totals cover the days that do.`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export default function FilterBar({ f, set, api }: { f: Filters; set: (p: Partial<Filters>) => void; api: Api }) {
  const cal = api.data.calendar;
  const min = cal.earliest;
  const max = cal.latest;
  const dataDays = useMemo(() => new Set(cal.days), [cal.days]);
  const err = rangeError(f.from, f.to);
  const warn = err ? null : rangeWarning(f.from, f.to, dataDays, min, max);
  const cerr = f.compare === "custom" ? rangeError(f.cfrom, f.cto) : null;
  const cwarn = cerr ? null : rangeWarning(f.cfrom, f.cto, dataDays, min, max);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

  const applyRange = (from: string, to: string, compare: Filters["compare"] = f.compare === "custom" ? "prior" : f.compare) => {
    const c = compareFor({ from, to, compare, cfrom: f.cfrom, cto: f.cto });
    set({ from, to, compare, ...c });
  };
  const yesterday = addDays(today, -1);
  const lastMonday = addDays(mondayOf(today), -7);
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthEnd = addDays(monthStart, -1);
  const prevMonthStart = `${prevMonthEnd.slice(0, 7)}-01`;
  const presets: { label: string; on: () => void }[] = [
    { label: "Today", on: () => applyRange(startOf(today), endOf(today), "week") },
    { label: "Yesterday", on: () => applyRange(startOf(yesterday), endOf(yesterday), "week") },
    { label: "Last 7 days", on: () => applyRange(startOf(addDays(yesterday, -6)), endOf(yesterday), "prior") },
    { label: "Last complete week", on: () => applyRange(startOf(lastMonday), endOf(addDays(lastMonday, 6)), "prior") },
    { label: "Month to date", on: () => applyRange(startOf(monthStart), endOf(yesterday < monthStart ? monthStart : yesterday), "prior") },
    { label: "Last month", on: () => applyRange(startOf(prevMonthStart), endOf(prevMonthEnd), "prior") },
    ...(max ? [{ label: "Latest cached week", on: () => applyRange(startOf(mondayOf(addDays(max, -6))), endOf(addDays(mondayOf(addDays(max, -6)), 6)), "prior") }] : []),
  ];
  const lengthHours = err ? null : daysBetween(f.from.slice(0, 10), f.to.slice(0, 10)) * 24 + parseLocal(f.to).hour - parseLocal(f.from).hour + 1;
  const lengthText = lengthHours == null ? "" : lengthHours % 24 === 0 ? `${lengthHours / 24} day${lengthHours === 24 ? "" : "s"}` : `${lengthHours} hours`;

  return (
    <div className="filters" role="search" aria-label="Dashboard filters">
      <fieldset className="range">
        <legend>Date range (Bangkok time, ICT)</legend>
        <DateTimePicker label="From" value={f.from} dataDays={dataDays} rangeFrom={f.from} rangeTo={f.to} onChange={(v) => applyRange(v, v > f.to ? `${v.slice(0, 10)}T23:00` : f.to)} />
        <DateTimePicker label="To" endOfHour value={f.to} dataDays={dataDays} rangeFrom={f.from} rangeTo={f.to} onChange={(v) => applyRange(v < f.from ? `${v.slice(0, 10)}T00:00` : f.from, v)} />
        <div className="presets" role="group" aria-label="Range presets">
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={p.on}>
              {p.label}
            </button>
          ))}
        </div>
        <div className={err ? "field-error" : "field-hint"} role={err ? "alert" : undefined}>
          {err ?? `${lengthText} selected: ${f.from.replace("T", " ")} → ${f.to.slice(0, 10)} ${pad2(parseLocal(f.to).hour)}:59 · hour precision`}
        </div>
        {warn && (
          <div className="field-warn" role="status">
            {warn}
          </div>
        )}
      </fieldset>

      <fieldset className="range">
        <legend>Compare to</legend>
        <label>
          Period
          <select
            value={f.compare}
            onChange={(e) => {
              const compare = e.target.value as Filters["compare"];
              set({ compare, ...(compare === "custom" ? {} : compareFor({ ...f, compare })) });
            }}
          >
            <option value="prior">Previous period (same length)</option>
            <option value="week">Same hours one week earlier</option>
            <option value="custom">Custom…</option>
          </select>
        </label>
        {f.compare === "custom" ? (
          <>
            <DateTimePicker label="From" value={f.cfrom} dataDays={dataDays} rangeFrom={f.cfrom} rangeTo={f.cto} onChange={(v) => set({ cfrom: v, cto: v > f.cto ? `${v.slice(0, 10)}T23:00` : f.cto })} />
            <DateTimePicker label="To" endOfHour value={f.cto} dataDays={dataDays} rangeFrom={f.cfrom} rangeTo={f.cto} onChange={(v) => set({ cto: v, cfrom: v < f.cfrom ? `${v.slice(0, 10)}T00:00` : f.cfrom })} />
          </>
        ) : (
          <div className="field-hint">
            {f.cfrom.replace("T", " ")} → {f.cto.slice(0, 10)} {pad2(parseLocal(f.cto).hour)}:59
          </div>
        )}
        {cerr && (
          <div className="field-error" role="alert">
            {cerr}
          </div>
        )}
        {cwarn && (
          <div className="field-warn" role="status">
            {cwarn}
          </div>
        )}
      </fieldset>

      <label>
        Platform
        <span className="seg" role="group" aria-label="Platform">
          {(Object.keys(PLATFORM_LABEL) as PlatformFilter[]).map((p) => (
            <button key={p} type="button" aria-pressed={f.platform === p} onClick={() => set({ platform: p })}>
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </span>
      </label>
      <label>
        Market
        <span className="seg" role="group" aria-label="Market">
          {MARKETS.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.id === "AU" ? "Australia (shop 10 — assumed, pending confirmation)" : m.label}
              aria-pressed={f.markets.includes(m.id)}
              onClick={() => {
                const next = f.markets.includes(m.id) ? f.markets.filter((x) => x !== m.id) : [...f.markets, m.id];
                if (next.length) set({ markets: next });
              }}
            >
              {m.id}
            </button>
          ))}
        </span>
      </label>
      <label>
        Web device
        <select value={f.device} onChange={(e) => set({ device: e.target.value as Filters["device"] })}>
          <option value="all">All devices</option>
          <option value="mobile">Mobile web</option>
          <option value="desktop">Desktop web</option>
        </select>
      </label>
      <label>
        Orders
        <select value={f.orders} onChange={(e) => set({ orders: e.target.value as Filters["orders"] })} disabled={!api.data.has_backend_orders && f.orders === "session"}>
          <option value="backend" disabled={!api.data.has_backend_orders}>
            Backend eligible orders (order date)
          </option>
          <option value="session">Session-attributed orders (dataset 63)</option>
        </select>
      </label>
    </div>
  );
}
