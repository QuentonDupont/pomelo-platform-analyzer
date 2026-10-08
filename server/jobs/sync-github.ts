// Incremental, idempotent import of production releases newer than what the cache holds.
// History before the first sync comes from discovery/github_releases.json (import-snapshots).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import * as gh from "../adapters/github";
import { getDb, recordRun, tx } from "../cache/db";
import { defaultMetricFor, inferSurface, parsePrBody } from "../metrics/release-metric";

type RepoCfg = { repo: string; platform: string; signal: "workflow_run" | "tag"; workflow?: string; version: string };

export function bangkokDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso));
}

export function upsertRelease(r: {
  id: string;
  repo: string;
  platform: string;
  release_id: string | null;
  go_live_at: string | null;
  bangkok_date: string;
  signal: string;
  prs: { number: number; title: string; merged_at?: string | null; author?: string | null; labels?: string[]; dirs: string[]; body?: string | null; declared?: boolean }[];
  note?: string | null;
  source: string;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO releases (id, repo, platform, release_id, go_live_at, bangkok_date, signal, pr_count, confounded, note, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET release_id=excluded.release_id, go_live_at=excluded.go_live_at, bangkok_date=excluded.bangkok_date,
       pr_count=excluded.pr_count, confounded=excluded.confounded, note=excluded.note, source=excluded.source`,
  ).run(r.id, r.repo, r.platform, r.release_id, r.go_live_at, r.bangkok_date, r.signal, r.prs.length, r.prs.length > 1 ? 1 : 0, r.note ?? null, r.source);
  const ins = db.prepare(
    `INSERT INTO release_prs (release_key, number, title, merged_at, author, labels, dirs, success_metric, surface, expected_direction, metric_source, decision_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(release_key, number) DO UPDATE SET title=excluded.title, dirs=excluded.dirs, success_metric=excluded.success_metric,
       surface=excluded.surface, expected_direction=excluded.expected_direction, metric_source=excluded.metric_source, decision_ids=excluded.decision_ids`,
  );
  for (const p of r.prs) {
    const declared = parsePrBody(p.body);
    const surface = declared?.surface ?? inferSurface(p.dirs);
    const fallback = defaultMetricFor(surface);
    const metric = declared?.metric ?? fallback.metric;
    const direction = declared?.direction ?? fallback.direction;
    const source = declared?.metric ? "declared" : p.declared ? "declared-unparsed" : "inferred";
    ins.run(r.id, p.number, p.title, p.merged_at ?? null, p.author ?? null, JSON.stringify(p.labels ?? []), JSON.stringify(p.dirs), metric, surface, direction, source, JSON.stringify(declared?.decisionIds ?? []));
  }
}

async function prsBetween(repo: string, base: string | null, head: string) {
  if (!base) return [];
  const commits = await gh.compare(repo, base, head);
  const out = [];
  for (const n of gh.prNumbersFromCommits(commits).slice(0, 40)) {
    const p = await gh.pull(repo, n);
    const files = await gh.pullFiles(repo, n);
    const dirs = [...new Set(files.map((f) => f.filename.split("/").slice(0, 2).join("/")))].slice(0, 10);
    out.push({ number: p.number, title: p.title, merged_at: p.merged_at, author: p.user?.login ?? null, labels: p.labels.map((l) => l.name), dirs, body: p.body });
  }
  return out;
}

export async function syncGithub(): Promise<{ status: "ok" | "skipped" | "error"; rows: number; message: string }> {
  const started = new Date().toISOString();
  if (!gh.githubConfigured()) {
    const msg = "GITHUB_TOKEN not set — source not connected (history from discovery snapshot only)";
    recordRun("sync-github", "skipped", 0, msg, started);
    return { status: "skipped", rows: 0, message: msg };
  }
  const cfg = parse(readFileSync(path.join(process.cwd(), "config/repos.yml"), "utf8")) as { repos: RepoCfg[] };
  const db = getDb();
  let rows = 0;
  try {
    for (const rc of cfg.repos) {
      const short = rc.repo.split("/")[1];
      const last = db.prepare("SELECT release_id, go_live_at FROM releases WHERE repo = ? ORDER BY go_live_at DESC LIMIT 1").get(short) as
        | { release_id: string | null; go_live_at: string | null }
        | undefined;
      const since = (last?.go_live_at ?? new Date(Date.now() - 60 * 86400000).toISOString()).slice(0, 10);
      let prev = last?.release_id ?? null;
      if (rc.signal === "workflow_run" && rc.workflow) {
        const runs = (await gh.successfulRuns(rc.repo, rc.workflow, since)).filter((r) => !last?.go_live_at || r.updated_at > last.go_live_at);
        const rels = rc.version === "latest_release_before_run" ? await gh.releases(rc.repo) : [];
        for (const run of runs) {
          const version =
            rc.version === "head_sha" ? run.head_sha : [...rels].reverse().find((x) => x.published_at <= run.created_at)?.tag_name ?? null;
          if (!version || version === prev) continue; // redeploy of the same version keeps the first go-live
          const prs = await prsBetween(rc.repo, prev, version);
          tx(() =>
            upsertRelease({
              id: `${short}-${version}`,
              repo: short,
              platform: rc.platform,
              release_id: version,
              go_live_at: run.updated_at,
              bangkok_date: bangkokDate(run.updated_at),
              signal: "workflow_run",
              prs,
              note: rc.version === "latest_release_before_run" ? "version inferred as latest GitHub release before the dispatch" : null,
              source: "github-sync",
            }),
          );
          prev = version;
          rows++;
        }
      } else {
        const tagList = (await gh.tags(rc.repo)).reverse();
        const startIdx = prev ? tagList.findIndex((t) => t.name === prev) + 1 : Math.max(0, tagList.length - 1);
        for (const t of tagList.slice(startIdx)) {
          const commits = prev ? await gh.compare(rc.repo, prev, t.name) : [];
          const when = commits.at(-1)?.commit.committer.date ?? new Date().toISOString();
          const prs = await prsBetween(rc.repo, prev, t.name);
          tx(() =>
            upsertRelease({ id: `${short}-${t.name}`, repo: short, platform: rc.platform, release_id: t.name, go_live_at: when, bangkok_date: bangkokDate(when), signal: "tag", prs, note: "tag date (weak signal: no production deploy record)", source: "github-sync" }),
          );
          prev = t.name;
          rows++;
        }
      }
    }
    recordRun("sync-github", "ok", rows, `${rows} new release(s)`, started);
    return { status: "ok", rows, message: `${rows} new release(s)` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordRun("sync-github", "error", rows, msg, started);
    return { status: "error", rows, message: msg };
  }
}
