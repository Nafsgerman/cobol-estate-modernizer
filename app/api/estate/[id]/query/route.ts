// app/api/estate/[id]/query/route.ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { businessRule, program, copybook } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const client = new Anthropic();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: estateId } = await params;

  let question: string;
  try {
    const body = await req.json();
    question = body.question;
    if (!question?.trim()) throw new Error("empty");
  } catch {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  try {
    const progs = await db
      .select({ id: program.id, name: program.programId })
      .from(program)
      .where(eq(program.estateId, estateId));

    const books = await db
      .select({ id: copybook.id, name: copybook.name })
      .from(copybook)
      .where(eq(copybook.estateId, estateId));

    const progIds = progs.map((p) => p.id);
    const rules = progIds.length > 0
      ? await db
          .select({
            id: businessRule.id,
            statement: businessRule.statement,
            category: businessRule.category,
          })
          .from(businessRule)
          .where(inArray(businessRule.programId, progIds))
          .limit(120)
      : [];

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      temperature: 0,
      system: `You are an expert COBOL estate analyst. Answer based only on the provided estate data. Return ONLY a JSON object with: "answer" (string), "references" (array of {type, id, name}), "confidence" ("high"|"medium"|"low"). No markdown fences, no preamble, raw JSON only.`,
      messages: [{
        role: "user",
        content: `Programs: ${JSON.stringify(progs)}\nCopybooks: ${JSON.stringify(books)}\nRules: ${JSON.stringify(rules)}\n\nQuestion: ${question}`,
      }],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Model returned invalid JSON", raw }, { status: 502 });
    }

    return NextResponse.json({ result: parsed, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[query] ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
