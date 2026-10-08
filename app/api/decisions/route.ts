// D9 decision log. Stored in the dashboard's own cache DB — never in production systems.
import { NextResponse } from "next/server";
import { getDb } from "@/server/cache/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OUTCOMES = ["Pending", "Worked", "No effect", "Worse", "Inconclusive"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function bad(message: string, status = 400) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function GET() {
  return NextResponse.json({ data: getDb().prepare("SELECT * FROM decisions ORDER BY decided_on DESC, id DESC").all() });
}

export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return bad("Body must be JSON");
  }
  const decision = str(b.decision, 300);
  const owner = str(b.owner, 80);
  const decided_on = str(b.decided_on, 10);
  const review_date = str(b.review_date, 10);
  if (!decision || !owner) return bad("decision and owner are required");
  if (!DATE.test(decided_on)) return bad("decided_on must be YYYY-MM-DD");
  if (review_date && !DATE.test(review_date)) return bad("review_date must be YYYY-MM-DD");
  const r = getDb()
    .prepare(
      `INSERT INTO decisions (created_at, decided_on, decision, owner, opportunity_key, release_ids, hypothesis, success_metric, target, review_date, outcome, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`,
    )
    .run(new Date().toISOString(), decided_on, decision, owner, str(b.opportunity_key, 80) || null, str(b.release_ids, 300) || null, str(b.hypothesis) || null, str(b.success_metric, 200) || null, str(b.target, 200) || null, review_date || null, str(b.notes, 1000) || null);
  return NextResponse.json({ data: { id: Number(r.lastInsertRowid), ref: `DEC-${r.lastInsertRowid}` } }, { status: 201 });
}

export async function PATCH(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return bad("Body must be JSON");
  }
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return bad("id must be a positive integer");
  const outcome = str(b.outcome, 20);
  if (!OUTCOMES.includes(outcome)) return bad(`outcome must be one of ${OUTCOMES.join(", ")}`);
  const r = getDb().prepare("UPDATE decisions SET outcome = ?, notes = COALESCE(?, notes) WHERE id = ?").run(outcome, str(b.notes, 1000) || null, id);
  if (!r.changes) return bad("decision not found", 404);
  return NextResponse.json({ data: { id, outcome } });
}
