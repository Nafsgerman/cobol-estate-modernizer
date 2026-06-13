// =============================================================================
// lib/ai/summarize.ts — deterministic summary projection + detail reconcile.
//
// Single source of truth: the model returns `details` (per-factor evidence);
// THIS code computes the headline `summary` from it AND writes the computed
// rollups back into `details`, so the scorecard, the structured JSON, and the
// breakdown factors all show the same numbers. Combined with temperature:0 at
// the call sites, the same program yields the same verdict every run.
// =============================================================================
import { extractJson, type AnalysisMode } from "./core";

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);

type Band = "Low" | "Medium" | "High";

function clampBand(v: unknown): Band {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("high")) return "High";
  if (s.startsWith("med")) return "Medium";
  return "Low";
}

// Headline risk = the worst individual risk actually found in the breakdown.
function maxSeverity(levels: unknown[]): Band {
  let rank = 0;
  for (const l of levels) {
    const s = String(l ?? "").toLowerCase();
    if (s.startsWith("high")) rank = Math.max(rank, 3);
    else if (s.startsWith("med")) rank = Math.max(rank, 2);
    else if (s.startsWith("low")) rank = Math.max(rank, 1);
  }
  return rank === 3 ? "High" : rank === 2 ? "Medium" : "Low";
}

function depCount(deps: Obj): number {
  const keys = [
    "copybooks",
    "called_programs",
    "db2_tables",
    "cics_transactions",
    "files",
    "vsam_files",
    "sequential_files",
  ];
  return sum(keys.map((k) => arr(deps[k]).length));
}

/** Compute the summary scorecards from the model's details. Pure + total. */
export function projectSummary(
  mode: AnalysisMode,
  details: Obj,
  modelSummary: Obj = {},
): Obj {
  switch (mode) {
    case "explain": {
      const cx = obj(details.complexity);
      return {
        complexity: clampBand(modelSummary.complexity ?? cx.verdict),
        variables_count: arr(details.variables).length,
        business_rules_count: arr(details.business_rules).length,
        paragraphs_count: num(cx.paragraphs),
        lines_of_code: num(cx.loc),
      };
    }
    case "assess": {
      const readiness = obj(details.readiness);
      const breakdown = arr(readiness.breakdown);
      const readinessScore = breakdown.length
        ? Math.round(avg(breakdown.map((b) => num(b.score))))
        : Math.round(num(readiness.score));
      const effort = obj(details.effort);
      const phaseDays = sum(arr(effort.phases).map((p) => num(p.days)));
      return {
        readiness_score: readinessScore,
        effort_days: num(effort.total_days) || phaseDays,
        risk_level: maxSeverity(arr(details.risks).map((r) => r.level)),
        dependencies_count: depCount(obj(details.dependencies)),
      };
    }
    case "extract": {
      const rules = arr(details.rules);
      return {
        total_rules: rules.length,
        core_rules: rules.filter((r) =>
          ["critical", "high"].includes(String(r.priority).toLowerCase()),
        ).length,
        jira_ready: rules.length > 0 && rules.every((r) => !!r.jira_ticket),
        total_story_points: sum(rules.map((r) => num(obj(r.jira_ticket).story_points))),
      };
    }
    case "dependencies": {
      const callers = arr(details.callers);
      const callees = arr(details.callees);
      const transitive = new Set(
        [...callers, ...callees]
          .filter((x) => String(x.relationship).toLowerCase() === "transitive")
          .map((x) => String(x.name)),
      );
      return {
        impact_level: clampBand(modelSummary.impact_level),
        direct_callers: callers.filter((c) => String(c.relationship).toLowerCase() === "direct").length,
        direct_callees: callees.filter((c) => String(c.relationship).toLowerCase() === "direct").length,
        transitive_reach: transitive.size,
        in_cycle: arr(details.cycles).length > 0,
      };
    }
    default:
      return {};
  }
}

/**
 * Write the computed rollups back into `details` so the structured JSON shows
 * the SAME numbers as the headline scorecards. The breakdown factors are the
 * ground truth; the rolled-up score is their computed mean, not the model's
 * free-floating guess. Mutates `details` in place.
 */
function reconcileDetails(mode: AnalysisMode, details: Obj, summary: Obj): void {
  if (mode === "assess") {
    if (details.readiness && typeof details.readiness === "object") {
      (details.readiness as Obj).score = summary.readiness_score;
    }
    if (details.effort && typeof details.effort === "object") {
      (details.effort as Obj).total_days = summary.effort_days;
    }
  }
}

/**
 * Parse a JSON-mode response, attach a derived summary, and reconcile details.
 * Shape stays { mode, summary, details } so the renderer + persistence are
 * unchanged. Falls back to { raw } if the model didn't return parseable JSON.
 */
export function assembleResult(mode: AnalysisMode, raw: string): Obj {
  const parsed = extractJson<Obj>(raw);
  if (!parsed || typeof parsed !== "object") return { raw };
  const nested = obj(parsed.details);
  const details = Object.keys(nested).length ? nested : parsed;
  const summary = projectSummary(mode, details, obj(parsed.summary));
  reconcileDetails(mode, details, summary);
  return { mode, summary, details };
}
