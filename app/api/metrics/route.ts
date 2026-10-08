import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { DEFINITION_VERSION } from "@/lib/metrics";
import { buildSample, Release, SAMPLE_RELEASES } from "@/lib/sample";

export const dynamic = "force-dynamic";

type GhRelease = {
  repo?: string;
  platform?: string;
  release_id?: string;
  go_live_at?: string;
  bangkok_date?: string;
  prs?: { number: number; title: string; success_metric_declared?: boolean }[];
  confounded?: boolean;
};

// Real releases from Phase 0 GitHub discovery, when present (read-only import).
async function loadReleases(): Promise<{ releases: Release[]; source: "github" | "sample" }> {
  try {
    const raw = await readFile(path.join(process.cwd(), "discovery/github_releases.json"), "utf8");
    const parsed = JSON.parse(raw);
    const list: GhRelease[] = Array.isArray(parsed) ? parsed : parsed.releases ?? [];
    const releases = list
      .filter((r) => r.bangkok_date || r.go_live_at)
      .map((r, i): Release => {
        const prs = (r.prs ?? []).map((p) => ({ number: p.number, title: p.title }));
        const platform = (["web", "ios", "android", "backend"].includes(r.platform ?? "") ? r.platform : "backend") as Release["platform"];
        return {
          id: `${r.repo}-${r.release_id ?? i}`,
          platform,
          repo: r.repo ?? "?",
          go_live: r.bangkok_date ?? (r.go_live_at ?? "").slice(0, 10),
          title: `${r.repo} ${r.release_id ?? ""}`.trim(),
          prs,
          success_metric: (r.prs ?? []).some((p) => p.success_metric_declared) ? "declared in PR" : null,
          metric_source: (r.prs ?? []).some((p) => p.success_metric_declared) ? "declared" : "none",
          surface: "—",
          confounded: r.confounded ?? prs.length > 1,
        };
      });
    if (releases.length) return { releases, source: "github" };
  } catch {
    /* discovery not run yet */
  }
  return { releases: SAMPLE_RELEASES, source: "sample" };
}

export type RealRow = {
  week_start: string;
  platform: string;
  market: string;
  total_sessions: number;
  bounce_sessions: number;
  non_bounce_sessions: number;
  orders: number;
  booked_revenue_usd: number;
};

// Real weekly aggregates from Superset dataset 63 (Phase 0 discovery, read-only).
async function loadRealWeekly(): Promise<{ rows: RealRow[]; source: string } | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "discovery/superset/weekly_aggregates.json"), "utf8");
    const d = JSON.parse(raw);
    return { rows: d.rows ?? [], source: d.source ?? "Superset dataset 63" };
  } catch {
    return null;
  }
}

export async function GET() {
  const cells = buildSample();
  const { releases, source: releaseSource } = await loadReleases();
  const real = await loadRealWeekly();
  const unknown = cells.filter((c) => c.platform === "unknown").reduce((a, c) => a + c.total_sessions, 0);
  const all = cells.reduce((a, c) => a + c.total_sessions, 0);
  return NextResponse.json({
    data: { cells, releases, real_weekly: real },
    as_of: new Date().toISOString(),
    source: { traffic: "SAMPLE (CEO brief aggregates + illustrative splits)", releases: releaseSource },
    definition_version: DEFINITION_VERSION,
    coverage: { unknown_platform_sessions: unknown, unknown_platform_share: all ? unknown / all : 0 },
  });
}
