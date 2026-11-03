#!/usr/bin/env node
// Run the Platform Changes Tracker page's own dash.calc functions offline, so numbers (and the written
// conclusions next to them) can be re-checked after the data or the analysis windows change.
//
//   tracker-model.cjs --page <page.html> --data <dir> [--compare <dir2>]
//
// <page.html> is the page file (store doc files/index.html, the "text" field). <dir> holds the dataset CSVs
// named <dataset id>.csv (analysis_windows, daily_platform, sale_days, checkout_funnel, search_daily, ...).
// Prints the per-window metrics and every comparison; with --compare it prints <dir> -> <dir2> side by side.
const fs = require("fs");
const arg = (k) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const pagePath = arg("page"), dirA = arg("data"), dirB = arg("compare");
if (!pagePath || !dirA) { console.error("usage: tracker-model.cjs --page <page.html> --data <dir> [--compare <dir2>]"); process.exit(1); }

const parseCsv = (p) => {
  const L = fs.readFileSync(p, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
  const H = L[0].split(",");
  return L.slice(1).map((l) => { const c = l.split(","); return Object.fromEntries(H.map((h, i) => [h, c[i] ?? ""])); });
};
function extractCalls(src) { // balanced-parenthesis extraction of every dash.calc(...) call
  const out = []; let i = 0;
  while ((i = src.indexOf("dash.calc(", i)) >= 0) {
    let j = i + 9, depth = 0, q = null, esc = false;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === "`") { q = c; continue; }
      if (c === "(") depth++; else if (c === ")") { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(i, j + 1)); i = j + 1;
  }
  return out;
}
function model(dir) {
  const src = fs.readFileSync(pagePath, "utf8"), defs = {};
  for (const call of extractCalls(src)) { try { new Function("dash", call)({ calc: (id, def) => { defs[id] = def; } }); } catch { /* skip */ } }
  const datasets = Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".csv")).map((f) => [f.replace(".csv", ""), parseCsv(`${dir}/${f}`)]));
  const res = {}, errors = {};
  const get = (id) => { if (id in res) return res[id]; if (id in datasets) return (res[id] = datasets[id]); const d = defs[id]; if (!d) throw new Error("no dataset or calc " + id); return (res[id] = d.fn(...d.inputs.map(get))); };
  for (const id of Object.keys(defs)) { try { get(id); } catch (e) { errors[id] = e.message; } }
  return { res, errors };
}
const A = model(dirA), B = dirB ? model(dirB) : null;
const show = (m) => (m && m.after !== undefined ? `${m.before} -> ${m.after} (${m.change_pct > 0 ? "+" : ""}${m.change_pct}%)` : "-");
console.log("calc errors:", JSON.stringify(A.errors), B ? JSON.stringify(B.errors) : "");
console.log("\nwindow_metrics:");
for (const w of (B ?? A).res.window_metrics ?? []) console.log(" ", w.id.padEnd(22), w.start, w.end, "days", w.days, "orders/d", w.orders_per_day, "rev/d", w.revenue_per_day, "aov", w.aov, "cr%", w.engaged_cr_pct);
console.log("\ncomparisons" + (B ? " (data -> compare)" : "") + ":");
const a = Object.fromEntries((A.res.comparisons ?? []).map((r) => [r.key, r])), b = B ? Object.fromEntries((B.res.comparisons ?? []).map((r) => [r.key, r])) : null;
for (const k of Object.keys(b ?? a)) console.log(" ", k.padEnd(18), b ? `${show(a[k]).padEnd(34)} -> ${show(b[k])}` : show(a[k]));
