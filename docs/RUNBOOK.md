# Runbook

## Run locally
```
npm install
npm run sync -- import   # load discovery snapshots into the local cache (data/cache.sqlite)
npm run dev              # http://localhost:3210 — also starts the sync scheduler
npm test && npm run typecheck && npm run lint
```
Node ≥ 22.13 (uses the built-in `node:sqlite`; no database server). The cache is git-ignored and can be deleted any time;
`npm run sync -- import` rebuilds it from `discovery/`.

## Environment (`.env.local`, git-ignored; names in `.env.example`)
| Variable | Purpose | Without it |
|---|---|---|
| `SUPERSET_MCP_URL`, `SUPERSET_MCP_TOKEN` | live read-only Superset sync via the Pomelo Superset MCP server (`query_dataset`) | snapshots only; pulse goes amber |
| or `SUPERSET_URL` + `SUPERSET_USERNAME`/`SUPERSET_PASSWORD` (`SUPERSET_PROVIDER` db/ldap) or `SUPERSET_ACCESS_TOKEN` | same via REST `/api/v1/chart/data` | — |
| `GITHUB_TOKEN` | fine-grained read-only token (contents, pull requests, actions) for new prod deploys | release history from `discovery/github_releases.json` only |
| `CRUX_API_KEY` | D6 Core Web Vitals (CrUX) | D6 shows "source not connected" |
| `REFRESH_INTERVAL_MINUTES` | sync cadence, 5–60 (default 10) | 10 |
| `SYNC_LOOKBACK_DAYS` / `SYNC_HOURLY_LOOKBACK_HOURS` | re-pull window for late cancellations / hourly cache | 14 / 6 |
| `SLACK_WEBHOOK_URL` | alert delivery — only after the team confirms and `slack_enabled: true` in `config/alerts.yml` | in-dashboard only |
| `DISABLE_SCHEDULER=1` | don't start the in-process scheduler (CLI/tests) | — |

All credentials must be read-only. Nothing in this app writes to Superset, the warehouse, RudderStack or GitHub.

## Sync schedule
- Every `REFRESH_INTERVAL_MINUTES`: import changed snapshots → Superset: re-pull last `SYNC_LOOKBACK_DAYS` days (one query per Bangkok day, idempotent upsert) + last `SYNC_HOURLY_LOOKBACK_HOURS` hours (hourly cache) → GitHub: prod deploy runs newer than the cache → evaluate alerts.
- Each run is logged in `sync_runs` and shown on the Data quality tab. The pulse turns amber after 2 missed intervals and red when a sync fails.
- Manual: `npm run sync`.

## What is real vs not evidenced (2026-10-08)
| Area | Status |
|---|---|
| Sessions / bounce / non-bounce by day × platform × device × market | REAL — Superset dataset 63 (Cube `segment_session`) |
| Orders | REAL — backend eligible (dataset 33, candidate filters in `server/jobs/order-eligibility.ts`) or session-attributed (dataset 63); switchable |
| Hour precision | REAL where `traffic_hourly` exists (last 14 days backfilled + live); otherwise partial days are flagged "rounded to day" |
| Channel / new vs returning mix, app versions, event funnel | REAL weekly snapshots where the data pull found them (see Data quality → sources) |
| Releases | REAL — prod deploy workflow runs (www, api, mobile-ios); Android = tags (deploy runs failing) |
| Site section / landing page | NOT EVIDENCED — no page column; needs RudderStack pages tables |
| Core Web Vitals, crash-free sessions, promotions, A/B tests | NOT CONNECTED — named in each panel |

## Add a metric
1. Define it in `server/metrics/definitions.ts` (or a pure helper in `lib/compute.ts`).
2. Add a unit test in `tests/`.
3. If it can be a release success metric, add it to `MetricId` + `METRIC_LABEL` in `server/metrics/release-metric.ts` and to `computeImpact` in `server/impact.ts`.

## Add a repo
Add it to `config/repos.yml` with its **production** signal (deploy workflow file, or tags) — merge time and GitHub Releases are not go-live here — and document the evidence in `docs/GITHUB_RELEASES.md`.

## Report
"Generate report" opens `/report?…` with the current filters. Download PDF = browser print; CSV = `/api/export` aggregates.
