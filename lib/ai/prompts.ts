// =============================================================================
// lib/ai/prompts.ts — system prompts + user templates for all 5 modes.
// Ported from the COBOL AI Advisor; dependencies mode is graph-aware and
// consumes the recursive-CTE call chain (upstream + downstream).
// =============================================================================
import type { AnalysisMode } from "./core";
import type { CallChainRow } from "@/lib/db/lineage";

const EXPLAIN_SYSTEM =
  "You are a COBOL modernization expert with 22 years of experience. Analyze the provided COBOL code and respond ONLY with valid JSON matching the schema below. No markdown, no explanations, no code fences — pure JSON only.";
const ASSESS_SYSTEM =
  "You are a mainframe modernization expert with 22 years of experience. Analyze the provided COBOL code and respond ONLY with valid JSON matching the schema below. No markdown, no code fences — pure JSON only.";
const EXTRACT_SYSTEM =
  "You are an expert legacy analyst and business analyst with 22 years of experience. Analyze the provided COBOL code and respond ONLY with valid JSON matching the schema below. No markdown, no code fences — pure JSON only.";
const DEPENDENCIES_SYSTEM =
  "You are a mainframe dependency and impact-analysis expert with 22 years of experience. You are given a COBOL program plus its resolved call-graph context (callers, callees, cycles). Respond ONLY with valid JSON matching the schema below. No markdown, no code fences — pure JSON only.";
const MODERNIZE_SYSTEM = `You are an expert legacy modernization architect with 22 years of experience. You analyze legacy COBOL code and provide actionable modernization recommendations, working code equivalents, and risk assessments.

Always provide:
1. What the code does
2. Modernization recommendation
3. Key risks
4. Working Python equivalent
5. Working Java equivalent

IMPORTANT: Always include both a fenced \`\`\`python code block and a fenced \`\`\`java code block. Never omit either block.`;

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
      return `Analyze this COBOL code:\n\n${cobol}`;
    case "dependencies":
      return DEPENDENCIES_USER(cobol, graph);
  }
}

const EXPLAIN_USER = (cobol: string) => `Mode: explain

Rules:
- Be precise and concise (max 1-2 sentences per description)
- Business rule IDs sequential: BR-001, BR-002, ...
- Complexity exactly one of: Low, Medium, High
- Count actual COMPUTE, PERFORM, IF, EVALUATE statements
- Detect CICS, DB2, file I/O, copybooks, called programs as dependencies
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
- effort_days realistic for a senior engineer
- Phases: Analysis, Conversion, Testing, Review
- Risk levels: Low, Medium, High; each risk needs a mitigation
- Detect dependencies: copybooks, called programs, DB2 tables, CICS, files

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
- Extract every business rule; IDs sequential BR-001...
- Priority: Critical, High, Medium, Low
- Category: validation, calculation, control_flow, io, other
- Each rule needs testable acceptance criteria
- Generate Jira-ready tickets with story points (Fibonacci 1,2,3,5,8,13,21)
- Return max 10 rules; prioritize core/critical

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
- Reference programs by name

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
