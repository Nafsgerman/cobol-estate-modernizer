import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { readFileSync } from "fs";
import { join } from "path";

export async function POST() {
  try {
    const sql = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");
    await pool.query(sql);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
