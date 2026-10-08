"use client";

import { FormEvent, useState } from "react";
import { fmtDate } from "@/lib/compute";
import { bangkokToday } from "@/lib/metrics";
import { Panel, PendingBadge } from "../shared";
import type { DecisionRow, PanelProps } from "../types";

const OUTCOMES = ["Pending", "Worked", "No effect", "Worse", "Inconclusive"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Form = {
  decision: string;
  owner: string;
  decided_on: string;
  review_date: string;
  opportunity_key: string;
  release_ids: string;
  hypothesis: string;
  success_metric: string;
  target: string;
  notes: string;
};

export function isOverdue(d: DecisionRow, today: string) {
  return d.outcome === "Pending" && !!d.review_date && d.review_date < today;
}

export default function D9DecisionLog(props: PanelProps & { onChange?: () => void }) {
  const { api, onChange } = props;
  const today = bangkokToday();
  const empty: Form = { decision: "", owner: "", decided_on: today, review_date: "", opportunity_key: "", release_ids: "", hypothesis: "", success_metric: "", target: "", notes: "" };
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof Form | "form", string>>>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const linked = (id: number) => api.data.releases.filter((r) => r.decision_ids.includes(`DEC-${id}`));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!form.decision.trim()) errs.decision = "Describe the decision.";
    if (!form.owner.trim()) errs.owner = "Owner is required.";
    if (!DATE.test(form.decided_on)) errs.decided_on = "Use a valid date.";
    if (form.review_date && !DATE.test(form.review_date)) errs.review_date = "Use a valid date.";
    if (form.review_date && form.review_date < form.decided_on) errs.review_date = "Review date must be on or after the decision date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await fetch("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) {
        setErrors({ form: j?.error?.message ?? `Could not save (HTTP ${r.status})` });
        return;
      }
      setMsg(`Saved as ${j.data.ref}. Reference ${j.data.ref} in a PR body to link its release automatically.`);
      setForm(empty);
      setOpen(false);
      onChange?.();
    } catch {
      setErrors({ form: "Network error — decision not saved." });
    } finally {
      setBusy(false);
    }
  }

  async function setOutcome(id: number, outcome: string) {
    const r = await fetch("/api/decisions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, outcome }) });
    setMsg(r.ok ? `DEC-${id} outcome set to ${outcome}.` : `Could not update DEC-${id}.`);
    onChange?.();
  }

  const field = (k: keyof Form, label: string, opts: { type?: string; required?: boolean; textarea?: boolean; placeholder?: string } = {}) => (
    <label className="field">
      <span>
        {label}
        {opts.required && " *"}
      </span>
      {opts.textarea ? (
        <textarea value={form[k]} rows={2} placeholder={opts.placeholder} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `err-${k}` : undefined} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      ) : (
        <input
          type={opts.type ?? "text"}
          value={form[k]}
          placeholder={opts.placeholder}
          aria-invalid={!!errors[k]}
          aria-describedby={errors[k] ? `err-${k}` : undefined}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        />
      )}
      {errors[k] && (
        <span id={`err-${k}`} className="down" role="alert" style={{ fontSize: 11.5 }}>
          {errors[k]}
        </span>
      )}
    </label>
  );

  const decisions = api.data.decisions;
  const overdue = decisions.filter((d) => isOverdue(d, today)).length;

  return (
    <Panel
      id="panel-decisions-log"
      title="D9 · Decision log & experiment tracker"
      badge={overdue ? <PendingBadge text={`${overdue} review${overdue > 1 ? "s" : ""} overdue`} /> : undefined}
      sub="Stored in this dashboard's own database — never in production systems. Releases link automatically when a PR body mentions DEC-<id>."
      right={
        <button className="no-print" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Cancel" : "Log a decision"}
        </button>
      }
    >
      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}
      {open && (
        <form onSubmit={submit} className="decision-form no-print" noValidate>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {field("decision", "Decision", { required: true, placeholder: "e.g. Test lighter hero on TH mobile web" })}
            {field("owner", "Owner", { required: true })}
            {field("decided_on", "Decided on", { type: "date", required: true })}
            {field("review_date", "Review date", { type: "date" })}
            {field("opportunity_key", "Linked opportunity (D2 key)", { placeholder: "e.g. seg-TH-mobile" })}
            {field("release_ids", "Linked release(s)", { placeholder: "e.g. www-v4.210.0" })}
            {field("success_metric", "Success metric", { placeholder: "e.g. TH Web Mobile bounce rate ↓" })}
            {field("target", "Target", { placeholder: "e.g. −2 pp within 2 complete weeks" })}
          </div>
          {field("hypothesis", "Hypothesis", { textarea: true })}
          {field("notes", "Notes", { textarea: true })}
          {errors.form && (
            <p className="down" role="alert">
              {errors.form}
            </p>
          )}
          <button type="submit" disabled={busy} style={{ marginTop: 8 }}>
            {busy ? "Saving…" : "Save decision"}
          </button>
        </form>
      )}
      {decisions.length === 0 ? (
        <p className="muted">No decisions logged yet. Log one from an opportunity (D2) so its outcome can be reviewed against its success metric.</p>
      ) : (
        <div className="scroll">
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Decided</th>
                <th style={{ textAlign: "left" }}>Decision · hypothesis</th>
                <th>Owner</th>
                <th>Opportunity</th>
                <th>Releases</th>
                <th>Success metric · target</th>
                <th>Review</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => {
                const auto = linked(d.id);
                const late = isOverdue(d, today);
                return (
                  <tr key={d.id}>
                    <td>DEC-{d.id}</td>
                    <td>{fmtDate(d.decided_on)}</td>
                    <td className="hyp">
                      <strong>{d.decision}</strong>
                      {d.hypothesis && <div>{d.hypothesis}</div>}
                    </td>
                    <td>{d.owner}</td>
                    <td>{d.opportunity_key ?? "—"}</td>
                    <td className="hyp">
                      {[d.release_ids, ...auto.map((r) => `${r.repo} ${r.release_id ?? ""} (auto)`)].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="hyp">
                      {d.success_metric ?? "—"}
                      {d.target && <div className="sub">target: {d.target}</div>}
                    </td>
                    <td>
                      {d.review_date ? fmtDate(d.review_date) : "—"} {late && <PendingBadge text="overdue" />}
                    </td>
                    <td>
                      <select aria-label={`Outcome for DEC-${d.id}`} value={d.outcome} onChange={(e) => setOutcome(d.id, e.target.value)}>
                        {OUTCOMES.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        A/B testing tool: none found in the repos (feature flags via Flagsmith exist in www) — controlled experiments not connected, so no outcome here is a
        causal measurement.
      </p>
    </Panel>
  );
}
