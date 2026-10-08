// Data client: how the dashboard loads, refreshes and saves. The local Next.js app uses its own API
// routes; the published Artifact installs a client backed by the artifact's database, the viewer's
// Superset connector and the downloads capability (artifact/client.ts).
import type { Api } from "./types";

export interface RefreshProgress {
  step: string;
  done: number;
  total: number;
}

export interface RefreshResult {
  /** "live" = pulled from the source; "reloaded" = re-read the latest saved data */
  mode: "live" | "reloaded";
  message: string;
}

export interface DecisionInput {
  decision: string;
  owner: string;
  decided_on: string;
  review_date?: string;
  opportunity_key?: string;
  release_ids?: string;
  hypothesis?: string;
  success_metric?: string;
  target?: string;
  notes?: string;
}

export interface DataClient {
  kind: "local" | "artifact";
  load(): Promise<Api>;
  refresh(onProgress?: (p: RefreshProgress) => void): Promise<RefreshResult>;
  createDecision(d: DecisionInput): Promise<{ ref: string }>;
  updateDecision(id: number, outcome: string): Promise<void>;
  ackAlert(id: string): Promise<void>;
  vitals(): Promise<{ data: unknown[]; source: string }>;
  exportCsv(q: { from: string; to: string; markets: string[]; orders: string }): Promise<void>;
  /** Printing works in the local app; the Artifact frame blocks window.print(). */
  canPrint: boolean;
}

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${r.status}`);
  return body as T;
}

const localClient: DataClient = {
  kind: "local",
  canPrint: true,
  async load() {
    return json<Api>(await fetch("/api/metrics", { cache: "no-store" }));
  },
  async refresh() {
    const r = await json<{ data: { superset: { status: string; message: string }; github: { status: string; message: string } } }>(await fetch("/api/sync", { method: "POST" }));
    const s = r.data.superset;
    return s.status === "ok"
      ? { mode: "live", message: `Pulled the latest data from Superset (${s.message}).` }
      : { mode: "reloaded", message: `Reloaded the cache. Superset live sync ${s.status}: ${s.message}` };
  },
  async createDecision(d) {
    const r = await json<{ data: { ref: string } }>(await fetch("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }));
    return r.data;
  },
  async updateDecision(id, outcome) {
    await json(await fetch("/api/decisions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, outcome }) }));
  },
  async ackAlert(id) {
    await json(await fetch("/api/alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
  },
  async vitals() {
    return json(await fetch("/api/vitals", { cache: "no-store" }));
  },
  async exportCsv(q) {
    window.location.href = `/api/export?from=${q.from}&to=${q.to}&m=${q.markets.join(",")}&orders=${q.orders}`;
  },
};

let current: DataClient = localClient;
export const getClient = () => current;
export const setClient = (c: DataClient) => {
  current = c;
};
