// app/api/estate/[id]/query/route.ts
// Natural-language query against an estate's extracted business rules + graph.
// Uses Haiku for triage speed; returns structured JSON.
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { businessRules, programs, copybooks } from "@/lib/db/schema";
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

  // Pull estate context: programs, copybooks, extracted rules
  const [progs, books, rules] = await Promise.all([
    db.select({ id: programs.id, name: programs.name, loc: programs.loc })
      .from(programs)
      .where(eq(programs.estateId, estateId)),
    db.select({ id: copybooks.id, name: copybooks.name })
      .from(copybooks)
      .where(eq(copybooks.estateId, estateId)),
    db.select({
      id: businessRules.id,
      programId: businessRules.programId,
      title: businessRules.title,
      description: businessRules.description,
      ruleType: businessRules.ruleType,
      priority: businessRules.priority,
    })
      .from(businessRules)
      .where(
        sql`${businessRules.programId} IN (
          SELECT id FROM programs WHERE estate_id = ${estateId}
        )`,
      )
      .limit(120), // keep context manageable
  ]);

  const estateContext = JSON.stringify({ programs: progs, copybooks: books, rules }, null, 2);

  const systemPrompt = `You are an expert COBOL estate analyst. You have access to metadata about a COBOL estate including programs, copybooks, and extracted business rules. Answer the user's question concisely and accurately based only on the provided estate data. Return a JSON object with:
- "answer": string — your direct answer (1-3 paragraphs max)
- "references": array of { "type": "program"|"copybook"|"rule", "id": string, "name": string } — relevant items from the estate that support your answer (max 8)
- "confidence": "high"|"medium"|"low" — based on how much relevant data exists

Return ONLY valid JSON, no markdown fences, no preamble.`;

  const userMessage = `Estate data:\n${estateContext}\n\nQuestion: ${question}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Model returned invalid JSON", raw }, { status: 502 });
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