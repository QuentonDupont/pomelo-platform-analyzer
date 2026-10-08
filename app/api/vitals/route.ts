import { NextResponse } from "next/server";
import { cruxConfigured, fetchVitals } from "@/server/adapters/crux";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!cruxConfigured()) {
    return NextResponse.json({ data: [], as_of: null, source: "not connected — set CRUX_API_KEY (no RUM source: web-vitals PR www#4036 not live)", definition_version: null, coverage: null });
  }
  try {
    return NextResponse.json({ data: await fetchVitals(), as_of: new Date().toISOString(), source: "Chrome UX Report API (28-day p75 field data)", definition_version: null, coverage: null });
  } catch (e) {
    return NextResponse.json({ error: { message: e instanceof Error ? e.message : "CrUX request failed" } }, { status: 502 });
  }
}
