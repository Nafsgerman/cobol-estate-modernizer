// =============================================================================
// lib/ai/triage.ts — the triage agent (model cascade, stage 1).
// A fast, cheap Haiku call that (a) detects which legacy language the pasted
// source is, and (b) returns a syntax verdict BEFORE any expensive Sonnet
// analysis runs. This is the cost/latency gate: Sonnet only fires on clean
// (or user-overridden) input.
//
// Determinism: the call runs at temperature 0 so the same source always yields
// the same verdict — switching analysis modes can never flip a clean program to
// blocked. The verdict is then RE-DERIVED in code from the per-issue
// severities (deriveVerdict), so the headline can never disagree with the list
// of issues actually shown. Same "evidence from the model, verdict from code"
// contract used for the analysis rollups.
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

2. CHECK syntax for that language's real rules. Be CONSERVATIVE, not pedantic. The bar for "blocking" is high: only flag an issue as blocking if you are CERTAIN the code would fail to compile. When in doubt, do NOT flag it, or flag it as cosmetic. Real legacy code is full of valid constructs that look unusual:
   - COBOL abbreviated combined conditions are VALID: \`IF A NOT = "X" AND "Y"\` and \`IF A NOT = "X" AND NOT = "Y"\` both implicitly carry the subject A. Do NOT flag these as "missing operand".
   - GOBACK is CORRECT for subprograms (CALLed programs); STOP RUN is for main programs. Never flag GOBACK.
   - GO TO is legacy but VALID. It is never blocking — at most a cosmetic/modernization note.
   - ALTER, level-88s, REDEFINES, OCCURS DEPENDING ON, COMP-3, reference modification — all valid. Do not flag unfamiliar-but-legal syntax.
   - LINKAGE SECTION + PROCEDURE DIVISION USING is a valid subprogram shape.
   - Periods: a genuinely missing period that breaks the parse is blocking; if a compiler would accept it (or you are unsure), treat as cosmetic.
   - PL/I: PROC OPTIONS(MAIN) marks the entry; END statements must match.
   - HLASM: column conventions (label col 1, opcode, operands), END required.
   - JCL: // in col 1-2, EXEC/DD structure. JCL is a job script, not a program — if the user likely wanted program analysis, say so as a cosmetic note, not a blocking error.

3. CLASSIFY each issue precisely:
   - "blocking" = the code structurally would NOT compile (e.g. an IF with no matching END-IF or period that leaves the parse open, a truncated statement).
   - "cosmetic" = style, obsolescence, conventions, modernization suggestions — anything that does NOT prevent compilation or degrade analysis.
   Style and obsolescence are ALWAYS cosmetic, never blocking.

4. Report only issues you are confident about. A clean program returns an empty issues array. Do NOT invent issues to look thorough.

Respond ONLY with valid JSON, no markdown, no fences:
{
  "language": "cobol|pl1|assembler|jcl|rpg|natural|unknown",
  "languageLabel": "short human label",
  "verdict": "clean|cosmetic|blocking",
  "issues": [
    { "line": 12, "severity": "blocking|cosmetic", "message": "what is wrong", "hint": "how to fix in one line" }
  ]
}`;

/** Verdict is derived from the issues, never trusted from the model: blocking
 *  iff at least one issue is severity "blocking"; else cosmetic iff any issue;
 *  else clean. Guarantees the headline matches the list the user sees. */
function deriveVerdict(issues: TriageIssue[]): TriageVerdict {
  if (issues.some((i) => i.severity === "blocking")) return "blocking";
  if (issues.length > 0) return "cosmetic";
  return "clean";
}

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
    temperature: 0, // deterministic verdict — same source, same gate, every time
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

  // Normalise issue severities, then derive the verdict from them in code so a
  // mislabeled model verdict (e.g. "blocking" over only cosmetic issues) can't
  // gate valid code.
  const issues: TriageIssue[] = Array.isArray(parsed.issues)
    ? (parsed.issues as TriageIssue[]).map((i) => ({
        line: typeof i.line === "number" ? i.line : null,
        severity: i.severity === "blocking" ? "blocking" : "cosmetic",
        message: String(i.message ?? "Issue"),
        hint: String(i.hint ?? ""),
      }))
    : [];

  return {
    language: (parsed.language as LegacyLanguage) ?? "unknown",
    languageLabel: parsed.languageLabel ?? String(parsed.language ?? "Unknown"),
    verdict: deriveVerdict(issues),
    issues,
  };
}
