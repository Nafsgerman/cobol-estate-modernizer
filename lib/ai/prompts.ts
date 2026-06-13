// =============================================================================
// lib/ai/prompts.ts — system prompts + user templates for all 5 modes.
// Ported from the COBOL AI Advisor; dependencies mode is graph-aware and
// consumes the recursive-CTE call chain (upstream + downstream).
//
// GROUNDING is appended to every system prompt. It is the single guard against
// the model padding a trivial program into pages of invented enterprise rules.
// =============================================================================
import type { AnalysisMode } from "./core";
import type { CallChainRow } from "@/lib/db/lineage";

// Shared accuracy contract — appended to every system prompt.
const GROUNDING = `

ACCURACY CONTRACT (highest priority — overrides any urge to be thorough):
- Report ONLY what the source actually contains. Never invent variables, statements, validations, error paths, scale concerns (e.g. "1M transactions"), or compliance requirements that are not present in the code.
- Scale your output to the program's real size. A 7-line program gets a few short findings, not pages. Brevity is correctness here.
- Use short, precise phrases. No filler, no hedging, no restating the prompt.
- Separate fact from recommendation. What the code DOES = a fact. What it SHOULD do = a clearly-labeled recommendation, never presented as extracted behavior.
- When you reference an issue, cite its exact location (paragraph, line, or statement) so the reader can verify it against the source.`;

const EXPLAIN_SYSTEM =
  "You are a COBOL modernization expert with 22 years of experience. Analyze the provided COBOL code and respond ONLY with valid JSON matching the schema below. No markdown, no explanations, no code fences — pure JSON only." +
  GROUNDING;
const ASSESS_SYSTEM =
  "You are a mainframe modernization expert with 22 years of experience. Analyze the provided COBOL code and respond ONLY with valid JSON matching the schema below. No markdown, no code fences — pure JSON only." +
  GROUNDING;
const EXTRACT_SYSTEM =
  "You are an expert legacy analyst and business analyst with 22 years of experience. Analyze the provided COBOL code and respond ONLY with valid JSON matching the schema below. No markdown, no code fences — pure JSON only." +
  GROUNDING;
const DEPENDENCIES_SYSTEM =
  "You are a mainframe dependency and impact-analysis expert with 22 years of experience. You are given a COBOL program plus its resolved call-graph context (callers, callees, cycles). Respond ONLY with valid JSON matching the schema below. No markdown, no code fences — pure JSON only." +
  GROUNDING;
const MODERNIZE_SYSTEM =
  `You are an expert legacy modernization architect with 22 years of experience. You analyze legacy COBOL code and provide actionable modernization recommendations, working code equivalents, and risk assessments.

Provide, each in short phrases:
1. What the code does
2. Modernization recommendation
3. Key risks
4. Working Python equivalent
5. Working Java equivalent

The Python and Java must be faithful equivalents of the ACTUAL logic — same inputs, same outputs, same arithmetic. If you add defensive code (null checks, validation) that the COBOL does not have, mark those lines with a comment // ADDED: not in original. Do not invent behavior the source lacks.

IMPORTANT: Always include both a fenced \`\`\`python code block and a fenced \`\`\`java code block. Never omit either block.` +
  GROUNDING;

export function systemPrompt(mode: AnalysisMode): string {
  switch (mode) {
    case "explain":
      return EXPLAIN_SYSTEM;
    case "assess":
      return ASSESS_SYSTEM;
    case "extract":
      return EXTRACT_SYSTEM;
    case "dependencies":
      return DEPENDENCIES_SYSTEM;
    case "modernize":
      return MODERNIZE_SYSTEM;
  }
}

export function isJsonMode(mode: AnalysisMode): boolean {
  return mode !== "modernize";
}

export interface GraphContext {
  downstream: CallChainRow[]; // what this program calls (transitive)
  upstream: CallChainRow[]; // what calls this program (transitive)
  inCycle: boolean;
  cycleMembers: string[]; // program names
}

export function userMessage(
  mode: AnalysisMode,
  cobol: string,
  graph?: GraphContext,
): string {
  switch (mode) {
    case "explain":
      return EXPLAIN_USER(cobol);
    case "assess":
      return ASSESS_USER(cobol);
    case "extract":
      return EXTRACT_USER(cobol);
    case "modernize":
      return `Analyze this COBOL code. Keep every prose field to short phrases; scale depth to the program's size.\n\n${cobol}`;
    case "dependencies":
      return DEPENDENCIES_USER(cobol, graph);
  }
}

const EXPLAIN_USER = (cobol: string) => `Mode: explain

Rules:
- Be precise and concise (max 1-2 sentences per description)
- Business rule IDs sequential: BR-001, BR-002, ...
- Only list business rules that correspond to actual statements in the code
- Complexity exactly one of: Low, Medium, High
- Count actual COMPUTE, PERFORM, IF, EVALUATE statements — do not estimate
- Detect CICS, DB2, file I/O, copybooks, called programs as dependencies ONLY if present
- Category values: validation, calculation, control_flow, io, other

Respond with JSON exactly matching this schema:
{
  "mode": "explain",
  "summary": { "purpose": "", "domain": "", "complexity": "Low|Medium|High",
    "variables_count": 0, "business_rules_count": 0, "paragraphs_count": 0, "lines_of_code": 0 },
  "details": {
    "purpose": { "description": "", "tags": [] },
    "complexity": { "loc": 0, "paragraphs": 0, "compute_statements": 0, "perform_calls": 0,
      "copybooks": 0, "cics_calls": 0, "db2_queries": 0, "file_io": false, "verdict": "" },
    "variables": [ { "name": "", "picture": "", "description": "" } ],
    "business_rules": [ { "id": "BR-001", "statement": "", "category": "calculation", "location": "" } ]
  }
}

COBOL code to analyze:
${cobol}`;

const ASSESS_USER = (cobol: string) => `Mode: assess

Rules:
- readiness_score 0-100 (higher = easier to migrate)
- effort_days realistic for a senior engineer, proportional to actual program size
- Phases: Analysis, Conversion, Testing, Review
- Risk levels: Low, Medium, High; each risk must be grounded in something the code actually does, and needs a mitigation
- Do not inflate risk for a simple program — a trivial subprogram is Low effort, Low risk
- Detect dependencies ONLY if present: copybooks, called programs, DB2 tables, CICS, files

Respond with JSON exactly matching this schema:
{
  "mode": "assess",
  "summary": { "readiness_score": 0, "effort_days": 0, "risk_level": "Low|Medium|High", "dependencies_count": 0 },
  "details": {
    "readiness": { "score": 0, "breakdown": [ { "factor": "", "score": 0, "note": "" } ] },
    "effort": { "total_days": 0, "phases": [ { "phase": "Analysis", "days": 0, "description": "" } ] },
    "risks": [ { "level": "Low|Medium|High", "title": "", "description": "", "mitigation": "" } ],
    "dependencies": { "copybooks": [], "called_programs": [], "db2_tables": [], "cics_transactions": [], "files": [], "verdict": "" }
  }
}

COBOL code to analyze:
${cobol}`;

const EXTRACT_USER = (cobol: string) => `Mode: extract

Rules:
- Extract ONLY business rules explicitly present in the code. Do NOT invent rules, validations, rounding policies, or compliance requirements the source does not contain.
- A trivial program may yield just 1-2 rules. That is the correct answer — do NOT manufacture more to look thorough.
- IDs sequential BR-001...
- Priority: Critical, High, Medium, Low — based on the rule's real role, not assumed business stakes
- Category: validation, calculation, control_flow, io, other
- acceptance_criteria must be verifiable against the code AS WRITTEN. Do not write hypothetical volume/scale test cases (e.g. "across 1M transactions") unless the code handles volume.
- Jira tickets: story points Fibonacci (1,2,3,5,8,13,21), sized to the real change
- If you recommend something the code should add (e.g. a ROUNDED keyword), phrase the ticket as a recommendation, not as an extracted rule

Respond with JSON exactly matching this schema:
{
  "mode": "extract",
  "summary": { "total_rules": 0, "core_rules": 0, "jira_ready": true, "total_story_points": 0 },
  "details": {
    "rules": [ { "id": "BR-001", "statement": "", "category": "calculation", "priority": "Critical|High|Medium|Low",
      "location": "", "acceptance_criteria": [],
      "jira_ticket": { "title": "", "body": "", "kind": "refactor|rewrite|test|document|risk", "story_points": 3, "priority": "low|medium|high|critical" } } ],
    "data_dependencies": { "db2_tables": [], "vsam_files": [], "sequential_files": [], "copybooks": [], "verdict": "" }
  }
}

COBOL code to analyze:
${cobol}`;

const DEPENDENCIES_USER = (cobol: string, graph?: GraphContext) => {
  const ctx = graph ? renderGraphContext(graph) : "No resolved graph context.";
  return `Mode: dependencies

You are analyzing one program's role in a larger estate. Use the resolved
call-graph context below — do not re-derive it from source. Reconcile what the
source implies against what the graph already knows.

Rules:
- impact_level: Low, Medium, High (estate-wide risk of changing this program)
- Distinguish direct vs transitive callers/callees
- If the program is in a cycle, call it out explicitly as a re-platforming risk
- Each change-impact scenario needs a safeguard
- Reference programs by name; only reference programs that appear in the graph context

Resolved graph context:
${ctx}

Respond with JSON exactly matching this schema:
{
  "mode": "dependencies",
  "summary": { "impact_level": "Low|Medium|High", "direct_callers": 0, "direct_callees": 0, "transitive_reach": 0, "in_cycle": false },
  "details": {
    "callers": [ { "name": "", "relationship": "direct|transitive", "why_it_matters": "" } ],
    "callees": [ { "name": "", "relationship": "direct|transitive", "why_it_matters": "" } ],
    "cycles": [ { "members": [], "risk": "", "break_strategy": "" } ],
    "change_impact": [ { "scenario": "", "affected": [], "severity": "Low|Medium|High", "safeguard": "" } ],
    "verdict": ""
  }
}

COBOL code to analyze:
${cobol}`;
};

function renderGraphContext(g: GraphContext): string {
  const names = (rows: CallChainRow[]) =>
    [...new Set(rows.filter((r) => r.depth > 0).map((r) => r.program_name))];
  const down = names(g.downstream);
  const up = names(g.upstream);
  return [
    `Transitive downstream (this program calls): ${down.join(", ") || "none"}`,
    `Transitive upstream (callers of this program): ${up.join(", ") || "none"}`,
    g.inCycle
      ? `Participates in a cycle with: ${g.cycleMembers.join(", ")}`
      : "Not part of any cycle.",
  ].join("\n");
}
