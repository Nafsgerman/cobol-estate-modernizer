"use server";

// =============================================================================
// app/actions/playground.ts — paste-and-analyze (the Claude-style flow).
// One click runs the cascade and streams every stage:
//   triage_start → triage (Haiku verdict) → [clean/cosmetic] analyzing →
//   delta… → done.
// Blocking verdict ends the stream after `triage` UNLESS the caller forces it
// (user chose "Analyze anyway") — Sonnet never fires on broken input by default.
// A cachedTriage lets the client skip the Haiku call when the source has not
// changed since its last verdict, so switching modes is instant and stable.
// fixSource streams a Sonnet repair pass returning fixed code.
// Ephemeral: nothing here touches the estate tables.
// =============================================================================
import { createStreamableValue, type StreamableValue } from "ai/rsc";
import {
  anthropic,
  MODEL,
  calculateCost,
  extractCodeBlocks,
  stripCodeBlocks,
  validateJava,
  type AnalysisMode,
  type UsageCost,
} from "@/lib/ai/core";
import { systemPrompt, userMessage, isJsonMode } from "@/lib/ai/prompts";
import { assembleResult } from "@/lib/ai/summarize";
import { triageSource, type TriageResult } from "@/lib/ai/triage";

export type PlaygroundEvent =
  | { type: "triage_start" }
  | { type: "triage"; result: TriageResult }
  | { type: "analyzing" }
  | { type: "delta"; text: string }
  | { type: "done"; mode: AnalysisMode; result: unknown; usage: UsageCost }
  | { type: "fixed"; code: string; notes: string[] }
  | { type: "error"; message: string };

export interface PlaygroundStream {
  stream: StreamableValue<PlaygroundEvent>;
}

export interface AnalyzeOptions {
  /** Reuse a prior verdict for unchanged source — skips the Haiku triage call. */
  cachedTriage?: TriageResult | null;
  /** Run analysis even on a blocking verdict (user chose "Analyze anyway"). */
  force?: boolean;
}

/** Analyze raw pasted source. Triage gates the expensive call (unless forced). */
export async function analyzeSource(
  source: string,
  mode: AnalysisMode,
  opts: AnalyzeOptions = {},
): Promise<PlaygroundStream> {
  const stream = createStreamableValue<PlaygroundEvent>();
  void runAnalyze(source, mode, stream, opts);
  return { stream: stream.value };
}

async function runAnalyze(
  source: string,
  mode: AnalysisMode,
  stream: ReturnType<typeof createStreamableValue<PlaygroundEvent>>,
  opts: AnalyzeOptions,
): Promise<void> {
  try {
    // Reuse the cached verdict if the client still holds one for this source;
    // otherwise run the Haiku gate. Either way the client gets a `triage` event.
    let triage: TriageResult;
    if (opts.cachedTriage) {
      triage = opts.cachedTriage;
    } else {
      stream.update({ type: "triage_start" });
      triage = await triageSource(source);
    }
    stream.update({ type: "triage", result: triage });

    if (triage.verdict === "blocking" && !opts.force) {
      stream.done(); // hard gate: expensive model never fires (unless forced)
      return;
    }

    stream.update({ type: "analyzing" });
    const client = anthropic();
    const msg = client.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      temperature: 0, // deterministic analysis — same paste, same result
      system: systemPrompt(mode),
      messages: [{ role: "user", content: userMessage(mode, source) }],
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

    // JSON modes: summary derived from details (single source of truth).
    const result = isJsonMode(mode) ? assembleResult(mode, raw) : shapeModernize(raw);

    stream.update({ type: "done", mode, result, usage });
    stream.done();
  } catch (err) {
    console.error(`[playground:${mode}] failed:`, err);
    stream.update({
      type: "error",
      message: err instanceof Error ? err.message : "Analysis failed.",
    });
    stream.done();
  }
}

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

// ── Fix it ────────────────────────────────────────────────────────────

const FIX_SYSTEM = `You are a legacy-code repair agent. You receive source code (COBOL, PL/I, HLASM, …) plus a list of syntax issues. Return the MINIMALLY corrected source: fix only the listed issues plus anything that clearly would not compile. Preserve the original structure, names, comments and formatting (including fixed-format columns) exactly wherever possible.

Respond with:
1. ONE fenced code block containing the complete corrected source.
2. After the block, a short bullet list of the changes made (one line each).
No other prose.`;

export async function fixSource(
  source: string,
  issues: { line: number | null; message: string; hint: string }[],
): Promise<PlaygroundStream> {
  const stream = createStreamableValue<PlaygroundEvent>();
  void runFix(source, issues, stream);
  return { stream: stream.value };
}

async function runFix(
  source: string,
  issues: { line: number | null; message: string; hint: string }[],
  stream: ReturnType<typeof createStreamableValue<PlaygroundEvent>>,
): Promise<void> {
  try {
    stream.update({ type: "analyzing" });
    const issueList = issues
      .map((i) => `- ${i.line ? `line ${i.line}: ` : ""}${i.message} (${i.hint})`)
      .join("\n");

    const client = anthropic();
    const msg = client.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      temperature: 0, // same broken input → same repair
      system: FIX_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Issues to fix:\n${issueList}\n\nSource:\n\n${source}`,
        },
      ],
    });

    let raw = "";
    for await (const ev of msg) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        raw += ev.delta.text;
        stream.update({ type: "delta", text: ev.delta.text });
      }
    }
    await msg.finalMessage();

    const fence = raw.match(/```\w*\n([\s\S]*?)```/);
    const code = fence ? fence[1] : null;
    const after = fence ? raw.slice(raw.indexOf(fence[0]) + fence[0].length) : "";
    const notes = after
      .split("\n")
      .map((l) => l.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);

    if (!code) {
      stream.update({
        type: "error",
        message: "Repair pass returned no code block. Try again.",
      });
    } else {
      stream.update({ type: "fixed", code, notes });
    }
    stream.done();
  } catch (err) {
    console.error("[playground:fix] failed:", err);
    stream.update({
      type: "error",
      message: err instanceof Error ? err.message : "Fix failed.",
    });
    stream.done();
  }
}
