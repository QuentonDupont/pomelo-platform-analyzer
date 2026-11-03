import { describe, expect, it } from "vitest";
import { rowsFromToolResult } from "../server/adapters/superset";

const ROWS = [
  { id_shop: 1, total_sessions: 10 },
  { id_shop: 2, total_sessions: 20 },
];

describe("Superset MCP query_dataset result parsing", () => {
  it("unwraps the chart-data envelope the server returns (result[0].data)", () => {
    const envelope = { result: [{ cache_key: "k", status: "success", colnames: ["id_shop", "total_sessions"], data: ROWS }], mcp_query: { returned_rows: 2 } };
    expect(rowsFromToolResult({ structuredContent: envelope })).toEqual(ROWS);
  });
  it("reads the same envelope from the text content when there is no structured content", () => {
    const envelope = { result: [{ colnames: ["id_shop", "total_sessions"], data: ROWS }] };
    expect(rowsFromToolResult({ content: [{ type: "text", text: JSON.stringify(envelope) }] })).toEqual(ROWS);
  });
  it("still accepts plain row arrays", () => {
    expect(rowsFromToolResult({ structuredContent: { data: ROWS } })).toEqual(ROWS);
    expect(rowsFromToolResult({ structuredContent: { rows: ROWS } })).toEqual(ROWS);
  });
  it("returns no rows for an empty envelope", () => {
    expect(rowsFromToolResult({ structuredContent: { result: [{ colnames: ["id_shop"], data: [] }] } })).toEqual([]);
  });
});
