import { NextResponse } from "next/server";
import { db, pool } from "@/lib/db";
import { dependency } from "@/lib/db/schema";

const ESTATE_ID   = "546277ad-9ecb-4f96-aa29-b2b15c9ce9ad";
const BILMAIN_ID  = "abf4e318-f5c8-4337-b3a2-c2dedee3bce2";
const PAYLEDGR_ID = "cadbe514-f525-4894-9c5a-0f65a98d8ecf";

export async function GET() {
  try {
    await db
      .insert(dependency)
      .values({
        estateId:   ESTATE_ID,
        sourceType: "program",
        sourceId:   BILMAIN_ID,
        targetType: "program",
        targetId:   PAYLEDGR_ID,
        kind:       "call",
      })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true, edge: "BILMAIN→PAYLEDGR" });
  } finally {
    await pool.end().catch(() => {});
  }
}