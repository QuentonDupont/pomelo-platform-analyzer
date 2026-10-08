// Read-only GitHub REST adapter. GET requests only; token from GITHUB_TOKEN (fine-grained, read-only).
const API = "https://api.github.com";

export function githubConfigured() {
  return Boolean(process.env.GITHUB_TOKEN);
}

async function gh<T>(pathname: string): Promise<T> {
  const r = await fetch(`${API}${pathname}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error(`GitHub rate limit reached; resets at ${new Date(Number(r.headers.get("x-ratelimit-reset")) * 1000).toISOString()}`);
  }
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${pathname.split("?")[0]}`);
  return (await r.json()) as T;
}

export type WorkflowRun = { id: number; head_sha: string; created_at: string; updated_at: string; conclusion: string | null; event: string };
export type GhRelease = { tag_name: string; published_at: string };
export type GhTag = { name: string; commit: { sha: string } };
export type GhCommit = { sha: string; commit: { message: string; committer: { date: string } } };
export type GhPull = { number: number; title: string; body: string | null; merged_at: string | null; user: { login: string } | null; labels: { name: string }[] };
export type GhFile = { filename: string };

export async function successfulRuns(repo: string, workflow: string, since: string): Promise<WorkflowRun[]> {
  const out: WorkflowRun[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await gh<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${repo}/actions/workflows/${workflow}/runs?status=success&per_page=100&page=${page}&created=>=${since}`,
    );
    out.push(...r.workflow_runs);
    if (r.workflow_runs.length < 100) break;
  }
  return out.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

export async function releases(repo: string): Promise<GhRelease[]> {
  const r = await gh<GhRelease[]>(`/repos/${repo}/releases?per_page=100`);
  return r.filter((x) => x.published_at).sort((a, b) => a.published_at.localeCompare(b.published_at));
}

export async function tags(repo: string): Promise<GhTag[]> {
  return gh<GhTag[]>(`/repos/${repo}/tags?per_page=50`);
}

export async function compare(repo: string, base: string, head: string): Promise<GhCommit[]> {
  const r = await gh<{ commits: GhCommit[] }>(`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  return r.commits;
}

export async function pull(repo: string, n: number): Promise<GhPull> {
  return gh<GhPull>(`/repos/${repo}/pulls/${n}`);
}

export async function pullFiles(repo: string, n: number): Promise<GhFile[]> {
  return gh<GhFile[]>(`/repos/${repo}/pulls/${n}/files?per_page=100`);
}

/** PR numbers from commit subjects: "(#123)" squash style or "Merge pull request #123". Skips release commits. */
export function prNumbersFromCommits(commits: GhCommit[]): number[] {
  const nums = new Set<number>();
  for (const c of commits) {
    const subject = c.commit.message.split("\n")[0];
    if (/^chore\(release\)/i.test(subject)) continue;
    const m = subject.match(/\(#(\d+)\)\s*$/) ?? subject.match(/Merge pull request #(\d+)/);
    if (m) nums.add(Number(m[1]));
  }
  return [...nums].sort((a, b) => a - b);
}
