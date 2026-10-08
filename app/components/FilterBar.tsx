"use client";

import { useId } from "react";
import { addDays, daysBetween, parseLocal, priorWindow } from "@/lib/compute";
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

export function rangeError(from: string, to: string, min: string | null, max: string | null): string | null {
  if (!from || !to) return "Choose both a From and a To date-time.";
  if (from > to) return "From must be on or before To.";
  if (min && from.slice(0, 10) < min) return `Data starts ${min}; From is earlier than the data.`;
  if (max && to.slice(0, 10) > max) return `Data ends ${max}; To is later than the data.`;
  return null;
}

export default function FilterBar({ f, set, api }: { f: Filters; set: (p: Partial<Filters>) => void; api: Api }) {
  const id = useId();
  const cal = api.data.calendar;
  const min = cal.earliest;
  const max = cal.latest;
  const err = rangeError(f.from, f.to, min, max);
  const cerr = f.compare === "custom" ? rangeError(f.cfrom, f.cto, min, max) : null;
  const latestWeek = cal.weeks[cal.weeks.length - 1];

  const applyRange = (from: string, to: string, compare: Filters["compare"] = f.compare === "custom" ? "prior" : f.compare) => {
    const c = compareFor({ from, to, compare, cfrom: f.cfrom, cto: f.cto });
    set({ from, to, compare, ...c });
  };
  const presets: { label: string; on: () => void; disabled?: boolean }[] = [
    { label: "Today", on: () => max && applyRange(startOf(max), endOf(max), "week"), disabled: !max },
    {
      label: "Last 7 complete days",
      on: () => {
        if (!max) return;
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
        const end = addDays(today, -1) < max ? addDays(today, -1) : max;
        applyRange(startOf(addDays(end, -6)), endOf(end), "prior");
      },
      disabled: !max,
    },
    { label: "Last complete week vs prior", on: () => latestWeek && applyRange(startOf(latestWeek), endOf(addDays(latestWeek, 6)), "prior"), disabled: !latestWeek },
  ];
  const lengthHours = err ? null : daysBetween(f.from.slice(0, 10), f.to.slice(0, 10)) * 24 + parseLocal(f.to).hour - parseLocal(f.from).hour + 1;

  return (
    <div className="filters" role="search" aria-label="Dashboard filters">
      <fieldset className="range">
        <legend>Date range (Bangkok time, ICT)</legend>
        <label htmlFor={`${id}-from`}>
          From
          <input
            id={`${id}-from`}
            type="datetime-local"
            step={3600}
            min={min ? startOf(min) : undefined}
            max={max ? endOf(max) : undefined}
            value={f.from}
            aria-invalid={Boolean(err)}
            onChange={(e) => e.target.value && applyRange(snapHour(e.target.value), f.to)}
          />
        </label>
        <label htmlFor={`${id}-to`}>
          To
          <input
            id={`${id}-to`}
            type="datetime-local"
            step={3600}
            min={min ? startOf(min) : undefined}
            max={max ? endOf(max) : undefined}
            value={f.to}
            aria-invalid={Boolean(err)}
            onChange={(e) => e.target.value && applyRange(f.from, snapHour(e.target.value))}
          />
        </label>
        <div className="presets" role="group" aria-label="Range presets">
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={p.on} disabled={p.disabled}>
              {p.label}
            </button>
          ))}
        </div>
        <div className={err ? "field-error" : "field-hint"} role={err ? "alert" : undefined}>
          {err ?? `${lengthHours} h selected · hour precision (minutes snap to :00) · To-hour inclusive`}
        </div>
      </fieldset>

      <fieldset className="range">
        <legend>Compare to</legend>
        <label>
          Period
          <select value={f.compare} onChange={(e) => {
            const compare = e.target.value as Filters["compare"];
            set({ compare, ...(compare === "custom" ? {} : compareFor({ ...f, compare })) });
          }}>
            <option value="prior">Previous period (same length)</option>
            <option value="week">Same hours one week earlier</option>
            <option value="custom">Custom…</option>
          </select>
        </label>
        {f.compare === "custom" ? (
          <>
            <label>
              From
              <input type="datetime-local" step={3600} min={min ? startOf(min) : undefined} max={max ? endOf(max) : undefined} value={f.cfrom} onChange={(e) => e.target.value && set({ cfrom: snapHour(e.target.value) })} />
            </label>
            <label>
              To
              <input type="datetime-local" step={3600} min={min ? startOf(min) : undefined} max={max ? endOf(max) : undefined} value={f.cto} onChange={(e) => e.target.value && set({ cto: snapHour(e.target.value) })} />
            </label>
          </>
        ) : (
          <div className="field-hint">
            {f.cfrom.replace("T", " ")} → {f.cto.replace("T", " ")}
          </div>
        )}
        {cerr && (
          <div className="field-error" role="alert">
            {cerr}
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
