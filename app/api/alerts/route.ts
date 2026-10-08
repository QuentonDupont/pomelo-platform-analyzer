import { NextResponse } from "next/server";
import { getDb } from "@/server/cache/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Acknowledge an in-dashboard alert (local cache only). */
export async function PATCH(req: Request) {
  let b: { id?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Body must be JSON" } }, { status: 400 });
  }
  if (typeof b.id !== "string" || !b.id) return NextResponse.json({ error: { message: "id is required" } }, { status: 400 });
  const r = getDb().prepare("UPDATE alert_events SET acknowledged = 1 WHERE id = ?").run(b.id);
  if (!r.changes) return NextResponse.json({ error: { message: "alert not found" } }, { status: 404 });
  return NextResponse.json({ data: { id: b.id, acknowledged: true } });
}
