"use client";

import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { addDays, mondayOf } from "@/lib/compute";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" (Bangkok local) helpers */
const dayOf = (v: string) => v.slice(0, 10);
const hourOf = (v: string) => Number(v.slice(11, 13)) || 0;
const fmtButton = (v: string) => {
  const d = new Date(`${dayOf(v)}T00:00:00Z`);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, ${pad2(hourOf(v))}:00`;
};

export default function DateTimePicker({
  label,
  value,
  onChange,
  dataDays,
  rangeFrom,
  rangeTo,
  endOfHour = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** days that have data in the cache — shown with a dot; other days stay selectable */
  dataDays: Set<string>;
  rangeFrom?: string;
  rangeTo?: string;
  /** To-pickers show the hour as "HH:00–HH:59" (the hour is inclusive) */
  endOfHour?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 }));
  const [focusDay, setFocusDay] = useState(dayOf(value));
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // keep the visible month in step with the value when it changes from outside (presets, URL)
  useEffect(() => {
    if (!open) {
      setView({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 });
      setFocusDay(dayOf(value));
    }
  }, [value, open]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // move DOM focus to the focused day when navigating with the keyboard
  useEffect(() => {
    if (open) gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, open, view]);

  const first = `${view.y}-${pad2(view.m + 1)}-01`;
  const cells = useMemo(() => {
    const start = mondayOf(first);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [first]);
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const out: number[] = [];
    for (let y = now - 3; y <= now + 1; y++) out.push(y);
    if (!out.includes(view.y)) out.push(view.y);
    return out.sort();
  }, [view.y]);

  const pick = (day: string, hour = hourOf(value)) => onChange(`${day}T${pad2(hour)}:00`);
  const shiftMonth = (delta: number) => {
    const m = view.m + delta;
    const next = { y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    setView(next);
    setFocusDay(`${next.y}-${pad2(next.m + 1)}-01`);
  };
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key] != null) {
      e.preventDefault();
      const d = addDays(focusDay, step[e.key]);
      setFocusDay(d);
      setView({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1 });
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      shiftMonth(e.key === "PageUp" ? -1 : 1);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const selected = dayOf(value);
  const inRange = (d: string) => rangeFrom && rangeTo && d >= dayOf(rangeFrom) && d <= dayOf(rangeTo);

  return (
    <div className="dtp" ref={wrapRef}>
      <span className="dtp-label" id={`${id}-l`}>
        {label}
      </span>
      <button
        type="button"
        className="dtp-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-l ${id}-v`}
        onClick={() => setOpen(!open)}
      >
        <span id={`${id}-v`}>{fmtButton(value)}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="dtp-pop" role="dialog" aria-label={`Choose ${label} date and time`}>
          <div className="dtp-head">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">
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
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="dtp-grid" role="grid" ref={gridRef} onKeyDown={onGridKey} aria-label={`${MONTHS[view.m]} ${view.y}`}>
            {DOW.map((d) => (
              <div key={d} className="dtp-dow" role="columnheader">
                {d}
              </div>
            ))}
            {cells.map((d) => {
              const outside = Number(d.slice(5, 7)) - 1 !== view.m;
              const has = dataDays.has(d);
              const cls = ["dtp-day", outside && "outside", d === selected && "selected", inRange(d) && "in-range", d === today && "today", !has && "no-data"].filter(Boolean).join(" ");
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  data-day={d}
                  className={cls}
                  tabIndex={d === focusDay ? 0 : -1}
                  aria-selected={d === selected}
                  aria-label={`${new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}${has ? "" : ", no data in cache"}`}
                  onClick={() => {
                    pick(d);
                    setFocusDay(d);
                  }}
                >
                  {Number(d.slice(8, 10))}
                  {has && <span className="dtp-dot" aria-hidden />}
                </button>
              );
            })}
          </div>
          <div className="dtp-foot">
            <label>
              {endOfHour ? "Until end of hour" : "From hour"}{" "}
              <select aria-label={`${label} hour`} value={hourOf(value)} onChange={(e) => pick(selected, Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {endOfHour ? `${pad2(h)}:59` : `${pad2(h)}:00`}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted small">
              <span className="dtp-dot inline" aria-hidden /> = data in cache · ICT
            </span>
            <button type="button" className="dtp-done" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
