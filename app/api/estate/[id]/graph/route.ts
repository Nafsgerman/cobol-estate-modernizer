// app/api/estate/[id]/query/route.ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { businessRule, program, copybook } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const client = new Anthropic();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: estateId } = await params;

  let question: string;
  try {
    ({ question } = await req.json());
    if (!question?.trim()) throw new Error("empty");
  } catch {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const [progs, books, rules] = await Promise.all([
    db.select({ id: program.id, name: program.programId, loc: program.lineCount })
      .from(program)
      .where(eq(program.estateId, estateId)),
    db.select({ id: copybook.id, name: copybook.name })
      .from(copybook)
      .where(eq(copybook.estateId, estateId)),
    db.select({
      id: businessRule.id,
      programId: businessRule.programId,
      title: businessRule.title,
      description: businessRule.description,
      ruleType: businessRule.category,
      priority: businessRule.priority,
    })
      .from(businessRule)
      .where(
        sql`${businessRule.programId} IN (
          SELECT id FROM program WHERE estate_id = ${estateId}
        )`,
      )
      .limit(120),
  ]);

  const estateContext = JSON.stringify(
    { programs: progs, copybooks: books, rules },
    null,
    2,
  );

  const systemPrompt = `You are an expert COBOL estate analyst. Answer the user's question concisely and accurately based only on the provided estate data. Return a JSON object with:
- "answer": string — your direct answer (1-3 paragraphs max)
- "references": array of { "type": "program"|"copybook"|"rule", "id": string, "name": string } — relevant items from the estate (max 8)
- "confidence": "high"|"medium"|"low"

Return ONLY valid JSON, no markdown fences, no preamble.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Estate data:\n${estateContext}\n\nQuestion: ${question}`,
        },
      ],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Model returned invalid JSON", raw },
        { status: 502 },
      );
    }

    return NextResponse.json({
      result: parsed,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    console.error(`[/api/estate/${estateId}/query] failed:`, err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}