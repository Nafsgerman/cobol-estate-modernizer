"use server";

// =============================================================================
// app/actions/analyze.ts — streaming analysis Server Action (all 5 modes).
// Streams tokens to the client AND records the full lineage in Aurora:
//   analysis_run (pending → streaming → complete/error) with token counts,
//   business_rule + ticket rows for extract mode, program.last_run_id pointer.
// Uses the proven IAM-auth db client; no new connection logic.
// =============================================================================
import { createStreamableValue, type StreamableValue } from "ai/rsc";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  program,
  analysisRun,
  businessRule,
  ticket,
  type ruleCategory,
  type ticketKind,
  type ticketPriority,
} from "@/lib/db/schema";
import { callChainDownstream, type CallChainRow } from "@/lib/db/lineage";
import {
  anthropic,
  MODEL,
  PROMPT_VERSIONS,
  calculateCost,
  extractCodeBlocks,
  stripCodeBlocks,
  validateJava,
  type AnalysisMode,
  type UsageCost,
} from "@/lib/ai/core";
import {
  systemPrompt,
  userMessage,
  isJsonMode,
  type GraphContext,
} from "@/lib/ai/prompts";
import { assembleResult } from "@/lib/ai/summarize";
import { checkCobolSyntax, type SyntaxIssue } from "@/lib/cobol/syntax";

export type StreamEvent =
  | { type: "run"; runId: string }
  | { type: "syntax"; issues: SyntaxIssue[] }
  | { type: "delta"; text: string }
  | {
      type: "done";
      mode: AnalysisMode;
      runId: string;
      result: unknown;
      usage: UsageCost;
    }
  | { type: "error"; message: string };

export interface AnalyzeResult {
  stream: StreamableValue<StreamEvent>;
}

type RuleCat = (typeof ruleCategory.enumValues)[number];
type TicketKind = (typeof ticketKind.enumValues)[number];
type TicketPriority = (typeof ticketPriority.enumValues)[number];

export async function analyzeProgram(
  estateId: string,
  programId: string,
  mode: AnalysisMode,
): Promise<AnalyzeResult> {
  const stream = createStreamableValue<StreamEvent>();
  void run(estateId, programId, mode, stream);
  return { stream: stream.value };
}

async function run(
  estateId: string,
  programId: string,
  mode: AnalysisMode,
  stream: ReturnType<typeof createStreamableValue<StreamEvent>>,
): Promise<void> {
  let runId: string | null = null;
  try {
    const [prog] = await db
      .select()
      .from(program)
      .where(eq(program.id, programId));
    if (!prog) {
      stream.update({ type: "error", message: "Program not found." });
      stream.done();
      return;
    }
    const source = prog.source ?? "";

    // 1. Open the lineage row (pending → streaming).
    const [created] = await db
      .insert(analysisRun)
      .values({
        estateId,
        programId,
        mode,
        status: "streaming",
        model: MODEL,
        inputHash: PROMPT_VERSIONS[mode] ?? null,
      })
      .returning({ id: analysisRun.id });
    runId = created.id;
    stream.update({ type: "run", runId });

    // 2. Pre-flight syntax.
    const issues = checkCobolSyntax(source);
    stream.update({ type: "syntax", issues });

    // 3. Graph context for dependencies mode (from the recursive CTE).
    let graph: GraphContext | undefined;
    if (mode === "dependencies") {
      graph = await buildGraphContext(estateId, programId, prog.programId);
    }

    // 4. Stream the model. temperature:0 — analytical modes must be
    //    deterministic; the same program must yield the same verdict.
    const client = anthropic();
    const msg = client.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      temperature: 0,
      system: systemPrompt(mode),
      messages: [{ role: "user", content: userMessage(mode, source, graph) }],
    });

    let raw = "";
    for await (const ev of msg) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        raw += ev.delta.text;
        stream.update({ type: "delta", text: ev.delta.text });
      }
    }
    const final = await msg.finalMessage();
    const usage = calculateCost(final.usage);

    // 5. Shape result. JSON modes: summary is DERIVED from details (single
    //    source of truth) so the scorecards can't contradict the breakdown.
    const result = isJsonMode(mode) ? assembleResult(mode, raw) : shapeModernize(raw);

    // 6. Persist: close the run, point program at it, write rules/tickets.
    await db
      .update(analysisRun)
      .set({
        status: "complete",
        output: isJsonMode(mode) ? null : raw,
        outputJson: result as Record<string, unknown>,
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        finishedAt: new Date(),
      })
      .where(eq(analysisRun.id, runId as string));

    await db
      .update(program)
      .set({ lastRunId: runId })
      .where(eq(program.id, programId));

    if (mode === "extract") {
      await persistExtract(estateId, programId, runId as string, result);
    }
    if (mode === "explain") {
      await persistExplain(estateId, programId, runId as string, result);
    }

    stream.update({ type: "done", mode, runId, result, usage });
    stream.done();
  } catch (err) {
    console.error(`[analyze:${mode}] failed:`, err);
    if (runId) {
      await db
        .update(analysisRun)
        .set({
          status: "error",
          error: err instanceof Error ? err.message : "unknown",
          finishedAt: new Date(),
        })
        .where(eq(analysisRun.id, runId!))
        .catch(() => {});
    }
    stream.update({
      type: "error",
      message: err instanceof Error ? err.message : "Analysis failed.",
    });
    stream.done();
  }
}

// ── shaping + persistence ─────────────────────────────────────────────

function shapeModernize(raw: string) {
  const blocks = extractCodeBlocks(raw);
  const java = blocks.java ? validateJava(blocks.java) : { valid: false, error: "" };
  return {
    mode: "modernize" as const,
    analysis: stripCodeBlocks(raw),
    python: { code: blocks.python ?? "", found: blocks.python !== null },
    java: { code: blocks.java ?? "", found: blocks.java !== null, ...java },
  };
}

const RULE_CATS: ReadonlySet<string> = new Set([
  "validation",
  "calculation",
  "control_flow",
  "io",
  "other",
]);
const TICKET_KINDS: ReadonlySet<string> = new Set([
  "refactor",
  "rewrite",
  "test",
  "document",
  "risk",
]);
const TICKET_PRIOS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "critical",
]);

/** Map extract-mode JSON into business_rule + ticket rows. Defensive on enums. */
async function persistExtract(
  estateId: string,
  programId: string,
  runId: string,
  result: unknown,
): Promise<void> {
  if (!result || typeof result !== "object") return;
  const rules =
    ((result as Record<string, unknown>).details as Record<string, unknown>)
      ?.rules;
  if (!Array.isArray(rules)) return;

  for (const r of rules as Record<string, unknown>[]) {
    const cat = (RULE_CATS.has(String(r.category)) ? r.category : "other") as RuleCat;
    const [rule] = await db
      .insert(businessRule)
      .values({
        estateId,
        programId,
        runId,
        statement: String(r.statement ?? r.name ?? "Untitled rule"),
        category: cat,
        location: r.location ? String(r.location) : null,
        metadata: { acceptance_criteria: r.acceptance_criteria ?? [], id: r.id },
      })
      .returning({ id: businessRule.id });

    const jt = r.jira_ticket as Record<string, unknown> | undefined;
    if (jt) {
      const kind = (TICKET_KINDS.has(String(jt.kind)) ? jt.kind : "refactor") as TicketKind;
      const prio = (TICKET_PRIOS.has(String(jt.priority)) ? jt.priority : "medium") as TicketPriority;
      await db.insert(ticket).values({
        estateId,
        programId,
        runId,
        title: String(jt.title ?? "Migration ticket"),
        body: String(jt.body ?? jt.description ?? ""),
        kind,
        priority: prio,
        effort: jt.story_points != null ? `${jt.story_points} pts` : null,
      });
    }
  }
}

/** Map explain-mode business_rules[] into business_rule rows (no tickets). */
async function persistExplain(
  estateId: string,
  programId: string,
  runId: string,
  result: unknown,
): Promise<void> {
  if (!result || typeof result !== "object") return;
  const rules = (
    (result as Record<string, unknown>).details as Record<string, unknown>
  )?.business_rules;
  if (!Array.isArray(rules)) return;

  for (const r of rules as Record<string, unknown>[]) {
    const cat = (RULE_CATS.has(String(r.category)) ? r.category : "other") as RuleCat;
    await db.insert(businessRule).values({
      estateId,
      programId,
      runId,
      statement: String(r.statement ?? "Untitled rule"),
      category: cat,
      location: r.location ? String(r.location) : null,
      metadata: { id: r.id },
    });
  }
}

async function persistExplain(
  estateId: string,
  programId: string,
  runId: string,
  result: unknown,
): Promise<void> {
  if (!result || typeof result !== "object") return;
  const rules = (
    (result as Record<string, unknown>).details as Record<string, unknown>
  )?.business_rules;
  if (!Array.isArray(rules)) return;

  for (const r of rules as Record<string, unknown>[]) {
    const cat = (RULE_CATS.has(String(r.category)) ? r.category : "other") as RuleCat;
    await db.insert(businessRule).values({
      estateId,
      programId,
      runId,
      statement: String(r.statement ?? "Untitled rule"),
      category: cat,
      location: r.location ? String(r.location) : null,
      metadata: { id: r.id },
    });
  }
}

async function buildGraphContext(
  estateId: string,
  programId: string,
  programName: string,
): Promise<GraphContext> {
  // Downstream from this node; upstream by scanning every node's downstream
  // chain for one that reaches this program (cheap at H0 scale).
  const downstream = await callChainDownstream(db, estateId, programId);

  const allPrograms = await db
    .select({ id: program.id, name: program.programId })
    .from(program)
    .where(eq(program.estateId, estateId));

  const upstream: CallChainRow[] = [];
  for (const p of allPrograms) {
    if (p.id === programId) continue;
    const chain = await callChainDownstream(db, estateId, p.id);
    if (chain.some((row) => row.program_id === programId)) {
      upstream.push({
        program_id: p.id,
        program_name: p.name,
        depth: 1,
        path: [],
        is_cycle: false,
      });
    }
  }

  const cycleMembers = [
    ...new Set(
      downstream.filter((r) => r.is_cycle).map((r) => r.program_name),
    ),
  ];
  return {
    downstream,
    upstream,
    inCycle: cycleMembers.length > 0,
    cycleMembers: cycleMembers.length ? [programName, ...cycleMembers] : [],
  };
}
