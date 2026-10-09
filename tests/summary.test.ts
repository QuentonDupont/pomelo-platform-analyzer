import { describe, expect, it } from "vitest";
import { addDays, DailyRow, resolveRange } from "../lib/compute";
import { buildSummary } from "../lib/summary";

// 28 days: app conversion steps up sharply from 2026-09-15; web stays flat
function rows(): DailyRow[] {
  const out: DailyRow[] = [];
  for (let i = 0; i < 28; i++) {
    const day = addDays("2026-09-01", i);
    const appOrders = day >= "2026-09-15" ? 40 : 10;
    out.push({ day, platform: "ios", device: "app", market: "TH", total: 3000, bounces: 1000, nb: 2000, s_orders: appOrders, s_revenue: appOrders * 40, e_orders: appOrders, e_revenue: appOrders * 40 });
    out.push({ day, platform: "web", device: "mobile", market: "TH", total: 4000, bounces: 3000, nb: 1000, s_orders: 5, s_revenue: 200, e_orders: 5, e_revenue: 200 });
  }
  return out;
}

describe("period summary", () => {
  const d = rows();
  const r = (a: string, b: string) => resolveRange(d, [], `${a}T00:00`, `${b}T23:00`);
  it("calls out a clear app rise and a flat web", () => {
    const lines = buildSummary(r("2026-09-15", "2026-09-28"), r("2026-09-01", "2026-09-14"), ["TH"], "backend", []);
    const app = lines.find((l) => l.text.startsWith("App"))!;
    const web = lines.find((l) => l.text.startsWith("Web:"))!;
    expect(app.tone).toBe("good");
    expect(app.text).toMatch(/clear rise/);
    expect(web.tone).toBe("neutral");
    expect(web.text).toMatch(/within normal ups and downs/);
  });
  it("changes when the date range changes", () => {
    const before = buildSummary(r("2026-09-08", "2026-09-14"), r("2026-09-01", "2026-09-07"), ["TH"], "backend", []);
    expect(before.find((l) => l.text.startsWith("App"))!.tone).toBe("neutral");
  });
  it("says so when there is no data", () => {
    const lines = buildSummary(r("2026-12-01", "2026-12-07"), r("2026-11-24", "2026-11-30"), ["TH"], "backend", []);
    expect(lines[0].tone).toBe("note");
  });
});
