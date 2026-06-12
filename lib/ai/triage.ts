// =============================================================================
// lib/ai/triage.ts — the triage agent (model cascade, stage 1).
// A fast, cheap Haiku call that (a) detects which legacy language the pasted
// source is, and (b) returns a syntax verdict BEFORE any expensive Sonnet
// analysis runs. This is the cost/latency gate: Sonnet only fires on clean
// (or user-overridden) input.
// =============================================================================
import { anthropic, extractJson } from "./core";

export const TRIAGE_MODEL = "claude-haiku-4-5" as const;

export type LegacyLanguage =
  | "cobol"
  | "pl1"
  | "assembler"
  | "jcl"
  | "rpg"
  | "natural"
  | "unknown";

export type TriageVerdict = "clean" | "cosmetic" | "blocking";

export interface TriageIssue {
  line: number | null;
  severity: "blocking" | "cosmetic";
  message: string;
  hint: string;
}

export interface TriageResult {
  language: LegacyLanguage;
  languageLabel: string; // human label, e.g. "COBOL (subprogram)"
  verdict: TriageVerdict;
  issues: TriageIssue[];
}

const TRIAGE_SYSTEM = `You are a legacy-code triage agent for mainframe modernization tooling. You receive raw source code of unknown origin. Your job, in order:

1. DETECT the language: cobol, pl1, assembler (HLASM), jcl, rpg, natural, or unknown.
2. CHECK syntax for that language's real rules. Be precise, not pedantic:
   - COBOL: GOBACK is CORRECT for subprograms (CALLed programs); STOP RUN is for main programs only. Do not flag GOBACK. Periods after division/section headers ARE required. LINKAGE SECTION + PROCEDURE DIVISION USING is a valid subprogram shape.
   - PL/I: PROC OPTIONS(MAIN) marks the entry; END statements must match.
   - HLASM: column conventions (label col 1, opcode, operands), END required.
   - JCL: // in col 1-2, EXEC/DD structure. JCL is a job script, not a program — if the user likely wanted program analysis, say so as a cosmetic note.
3. CLASSIFY each issue: "blocking" = would not compile / structurally broken; "cosmetic" = style, warnings, conventions that do NOT affect analysis quality.
4. VERDICT: "clean" (no issues), "cosmetic" (only cosmetic issues), "blocking" (any blocking issue).

Respond ONLY with valid JSON, no markdown, no fences:
{
  "language": "cobol|pl1|assembler|jcl|rpg|natural|unknown",
  "languageLabel": "short human label",
  "verdict": "clean|cosmetic|blocking",
  "issues": [
    { "line": 12, "severity": "blocking|cosmetic", "message": "what is wrong", "hint": "how to fix in one line" }
  ]
}`;

/**
 * Run the triage agent. Fast (~1s) and cheap (~$0.002/call on Haiku).
 * Falls back to a permissive "unknown/cosmetic" result if the model response
 * cannot be parsed — triage must never hard-block the pipeline by itself.
 */
export async function triageSource(source: string): Promise<TriageResult> {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return {
      language: "unknown",
      languageLabel: "No code",
      verdict: "blocking",
      issues: [
        {
          line: null,
          severity: "blocking",
          message: "No source code provided.",
          hint: "Paste a legacy program (COBOL, PL/I, Assembler …) first.",
        },
      ],
    };
  }

  const client = anthropic();
  const res = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 1500,
    system: TRIAGE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Triage this source:\n\n${trimmed.slice(0, 30_000)}`,
      },
    ],
  });

  const raw = res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = extractJson<Partial<TriageResult>>(raw);
  if (!parsed || !parsed.verdict) {
    return {
      language: "unknown",
      languageLabel: "Unrecognized",
      verdict: "cosmetic",
      issues: [
        {
          line: null,
          severity: "cosmetic",
          message: "Triage could not produce a structured verdict.",
          hint: "Analysis will proceed; results may vary.",
        },
      ],
    };
  }

  return {
    language: (parsed.language as LegacyLanguage) ?? "unknown",
    languageLabel: parsed.languageLabel ?? String(parsed.language ?? "Unknown"),
    verdict: parsed.verdict as TriageVerdict,
    issues: Array.isArray(parsed.issues) ? (parsed.issues as TriageIssue[]) : [],
  };
}
