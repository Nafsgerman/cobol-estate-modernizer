import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db, warmDb } from "../../../../lib/db";
import { seedLargeEstate } from "../../../../scripts/seed-large";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.ADMIN_SEED_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await warmDb();
    const result = await db.transaction(async (tx) => seedLargeEstate(tx));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/seed] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
