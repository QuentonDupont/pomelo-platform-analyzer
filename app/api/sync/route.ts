// Manual refresh: run the same idempotent jobs the scheduler runs (snapshot import, Superset, GitHub, alerts).
import { NextResponse } from "next/server";
import { runAll } from "@/server/jobs/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const r = await runAll();
  if ("skipped" in r) return NextResponse.json({ error: { message: "A refresh is already running — try again in a minute." } }, { status: 409 });
  return NextResponse.json({ data: r, as_of: new Date().toISOString() });
}
