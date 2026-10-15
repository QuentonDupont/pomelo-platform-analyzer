// Read-only Superset adapter. Two transports, both read-only:
//  1. the Pomelo Superset MCP server (SUPERSET_MCP_URL + SUPERSET_MCP_TOKEN) — tool `query_dataset`
//  2. Superset REST (SUPERSET_URL + SUPERSET_USERNAME/PASSWORD or SUPERSET_ACCESS_TOKEN) — POST /api/v1/chart/data
// Never calls any write endpoint. Server-side only; the browser never talks to Superset.

export type Filter = { column: string; operator: "eq" | "neq" | "in" | "not_in" | "lt" | "lte" | "gt" | "gte" | "is_null" | "not_null"; value?: unknown };
export type DatasetQuery = { dataset_id: number; columns: string[]; filters: Filter[]; row_limit?: number; row_offset?: number };

export function supersetTransport(): "mcp" | "rest" | null {
  if (process.env.SUPERSET_MCP_URL && process.env.SUPERSET_MCP_TOKEN) return "mcp";
  if (process.env.SUPERSET_URL && (process.env.SUPERSET_ACCESS_TOKEN || (process.env.SUPERSET_USERNAME && process.env.SUPERSET_PASSWORD))) return "rest";
  return null;
}

// ---------------- MCP (streamable HTTP, JSON-RPC) ----------------
let mcpSession: string | null = null;
let rpcId = 0;

function parseRpc(text: string, contentType: string | null) {
  if (contentType?.includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    const last = data.reverse().find((d) => d.startsWith("{"));
    return last ? JSON.parse(last) : null;
  }
  return text ? JSON.parse(text) : null;
}

async function rpc(method: string, params: unknown, notify = false) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${process.env.SUPERSET_MCP_TOKEN}`,
  };
  if (mcpSession) headers["Mcp-Session-Id"] = mcpSession;
  const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++rpcId, method, params };
  const r = await fetch(process.env.SUPERSET_MCP_URL!, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
  const sid = r.headers.get("mcp-session-id");
  if (sid) mcpSession = sid;
  if (!r.ok) throw new Error(`Superset MCP HTTP ${r.status}`);
  if (notify) return null;
  const msg = parseRpc(await r.text(), r.headers.get("content-type"));
  if (msg?.error) throw new Error(`Superset MCP: ${msg.error.message ?? "error"}`);
  return msg?.result;
}

async function mcpInit() {
  if (mcpSession) return;
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "pomelo-platform-analyzer", version: "0.2" } });
  await rpc("notifications/initialized", {}, true);
}

function rowsFromToolResult(result: { content?: { type: string; text?: string }[]; structuredContent?: unknown }): Record<string, unknown>[] {
  const sc = result?.structuredContent as { data?: unknown; rows?: unknown; result?: unknown } | undefined;
  const fromObj = (o: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(o)) return o as Record<string, unknown>[];
    if (o && typeof o === "object") {
      const x = o as Record<string, unknown>;
      for (const k of ["data", "rows", "result", "records"]) {
        const v = fromObj(x[k]);
        if (v) return v;
      }
    }
    return null;
  };
  const direct = fromObj(sc);
  if (direct) return direct;
  for (const c of result?.content ?? []) {
    if (c.type === "text" && c.text) {
      try {
        const v = fromObj(JSON.parse(c.text));
        if (v) return v;
      } catch {
        /* not JSON */
      }
    }
  }
  return [];
}

async function mcpQuery(q: DatasetQuery) {
  await mcpInit();
  try {
    const result = await rpc("tools/call", { name: "query_dataset", arguments: { ...q, row_limit: q.row_limit ?? 500 } });
    return rowsFromToolResult(result);
  } catch (e) {
    mcpSession = null; // session may have expired; next call re-initialises
    throw e;
  }
}

// ---------------- REST ----------------
let restToken: { token: string; at: number } | null = null;
async function restAuth(): Promise<string> {
  if (process.env.SUPERSET_ACCESS_TOKEN) return process.env.SUPERSET_ACCESS_TOKEN;
  if (restToken && Date.now() - restToken.at < 10 * 60_000) return restToken.token;
  const r = await fetch(`${process.env.SUPERSET_URL}/api/v1/security/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.SUPERSET_USERNAME, password: process.env.SUPERSET_PASSWORD, provider: process.env.SUPERSET_PROVIDER ?? "db", refresh: false }),
  });
  if (!r.ok) throw new Error(`Superset login ${r.status}`);
  restToken = { token: (await r.json()).access_token, at: Date.now() };
  return restToken.token;
}

const OP: Record<Filter["operator"], string> = { eq: "==", neq: "!=", in: "IN", not_in: "NOT IN", lt: "<", lte: "<=", gt: ">", gte: ">=", is_null: "IS NULL", not_null: "IS NOT NULL" };

async function restQuery(q: DatasetQuery) {
  const token = await restAuth();
  // chart/data is a read endpoint (it executes a query); no state is written.
  const r = await fetch(`${process.env.SUPERSET_URL}/api/v1/chart/data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      datasource: { id: q.dataset_id, type: "table" },
      queries: [{ columns: q.columns, metrics: [], filters: q.filters.map((f) => ({ col: f.column, op: OP[f.operator], val: f.value })), row_limit: q.row_limit ?? 5000, row_offset: q.row_offset ?? 0, extras: { having: "", where: "" } }],
      result_format: "json",
      result_type: "full",
    }),
  });
  if (!r.ok) throw new Error(`Superset chart/data ${r.status}`);
  const j = await r.json();
  return (j.result?.[0]?.data ?? []) as Record<string, unknown>[];
}

/** Runs a dataset query, paging through the 500-row MCP cap. */
export async function queryDataset(q: DatasetQuery): Promise<Record<string, unknown>[]> {
  const t = supersetTransport();
  if (!t) throw new Error("Superset not configured");
  if (t === "rest") return restQuery(q);
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 20_000; offset += 500) {
    const page = await mcpQuery({ ...q, row_limit: 500, row_offset: offset });
    out.push(...page);
    if (page.length < 500) break;
  }
  return out;
}
