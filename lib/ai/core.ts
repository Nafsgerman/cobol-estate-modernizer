// =============================================================================
// lib/ai/core.ts — Anthropic client, cost, robust JSON extraction.
// Mode set matches the analysis_mode enum (now incl. 'dependencies').
// =============================================================================
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-4-6" as const;

export type AnalysisMode =
  | "explain"
  | "modernize"
  | "assess"
  | "extract"
  | "dependencies";

export const PROMPT_VERSIONS: Record<AnalysisMode, string> = {
  explain: "explain-v2.1",
  modernize: "modernize-v1.0",
  assess: "assess-v2.0",
  extract: "extract-v2.1",
  dependencies: "dependencies-v1.0",
};

const COST_PER_M_INPUT = 3.0;
const COST_PER_M_OUTPUT = 15.0;

export interface UsageCost {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}

export function calculateCost(usage: Anthropic.Usage): UsageCost {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cost =
    (inputTokens / 1_000_000) * COST_PER_M_INPUT +
    (outputTokens / 1_000_000) * COST_PER_M_OUTPUT;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    totalCostUsd: Math.round(cost * 1e6) / 1e6,
  };
}

/** Robust JSON extraction: direct → fenced → brace-span. Null on failure. */
export function extractJson<T = unknown>(raw: string): T | null {
  const text = raw.trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    /* next */
  }
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {
      /* next */
    }
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1)) as T;
    } catch {
      /* next */
    }
  }
  return null;
}

export interface CodeBlocks {
  python: string | null;
  java: string | null;
}

export function extractCodeBlocks(text: string): CodeBlocks {
  const blocks: CodeBlocks = { python: null, java: null };
  const re = /```(\w+)\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lang = m[1].toLowerCase();
    if (lang === "python" && blocks.python === null) blocks.python = m[2];
    else if (lang === "java" && blocks.java === null) blocks.java = m[2];
  }
  return blocks;
}

export function stripCodeBlocks(text: string): string {
  return text.replace(/```\w*\n[\s\S]*?```/g, "").trim();
}

export function validateJava(code: string): { valid: boolean; error: string } {
  const errs: string[] = [];
  const c = (ch: string) => [...code].filter((x) => x === ch).length;
  if (c("{") !== c("}")) errs.push(`unbalanced braces`);
  if (c("(") !== c(")")) errs.push(`unbalanced parentheses`);
  if (!/\bclass\s+\w+/.test(code)) errs.push("no class declaration");
  return errs.length
    ? { valid: false, error: errs.join("; ") }
    : { valid: true, error: "" };
}

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}
