"use client";

import { useEffect } from "react";
import type { RFNodeData } from "@/lib/graph/reactflow";
import type { AnalysisMode } from "@/lib/ai/core";
import { useAnalysis } from "./useAnalysis";

const MODES: { id: AnalysisMode; label: string; blurb: string }[] = [
  { id: "explain", label: "Explain", blurb: "Purpose, complexity, rules" },
  { id: "modernize", label: "Modernize", blurb: "Python + Java equivalents" },
  { id: "assess", label: "Assess", blurb: "Readiness, effort, risk" },
  { id: "extract", label: "Extract", blurb: "Rules → tickets (persisted)" },
  { id: "dependencies", label: "Dependencies", blurb: "Estate-wide blast radius" },
];

interface Props {
  estateId: string;
  programId: string;
  node: RFNodeData;
  mode: AnalysisMode;
  onModeChange: (m: AnalysisMode) => void;
  onClose: () => void;
}

export function AnalysisPanel({
  estateId,
  programId,
  node,
  mode,
  onModeChange,
  onClose,
}: Props) {
  const { state, run } = useAnalysis();

  useEffect(() => {
    run(estateId, programId, mode);
  }, [estateId, programId, mode, run]);

  return (
    <aside className="panel" role="dialog" aria-label={`Analysis of ${node.label}`}>
      <header className="panel__head">
        <div>
          <div className="panel__eyebrow">PROGRAM</div>
          <h2 className="panel__title">{node.label}</h2>
        </div>
        <button className="panel__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <nav className="panel__modes" aria-label="Analysis mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            className="mode"
            data-active={m.id === mode || undefined}
            onClick={() => onModeChange(m.id)}
          >
            <span className="mode__label">{m.label}</span>
            <span className="mode__blurb">{m.blurb}</span>
          </button>
        ))}
      </nav>

      <div className="panel__body">
        {state.syntax.length > 0 && <SyntaxStrip issues={state.syntax} />}
        {state.status === "streaming" && <LiveStream text={state.liveText} />}
        {state.status === "error" && (
          <div className="panel__error">
            Analysis failed: {state.error}. Select the mode again to retry.
          </div>
        )}
        {state.status === "done" && <Result mode={mode} result={state.result} />}
        {state.usage && (
          <footer className="panel__usage">
            {state.usage.totalTokens.toLocaleString()} tokens · $
            {state.usage.totalCostUsd.toFixed(4)}
            {state.runId ? ` · run ${state.runId.slice(0, 8)}` : ""}
          </footer>
        )}
      </div>
    </aside>
  );
}

function SyntaxStrip({ issues }: { issues: { severity: string; message: string }[] }) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warning").length;
  return (
    <div className="syntax">
      <div className="syntax__head">
        Pre-flight: {errors} error{errors !== 1 ? "s" : ""}, {warns} warning
        {warns !== 1 ? "s" : ""}
      </div>
      <ul className="syntax__list">
        {issues.map((i, n) => (
          <li key={n} data-sev={i.severity}>
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveStream({ text }: { text: string }) {
  return (
    <div className="live">
      <div className="live__head">
        <span className="live__pulse" /> Analyzing…
      </div>
      <pre className="live__text">{text || "​"}</pre>
    </div>
  );
}

function Result({ mode, result }: { mode: AnalysisMode; result: unknown }) {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if ("raw" in r && typeof r.raw === "string")
    return <pre className="result__raw">{r.raw}</pre>;

  const summary = (r.summary ?? {}) as Record<string, unknown>;
  return (
    <div className="result">
      {Object.keys(summary).length > 0 && (
        <div className="scorecards">
          {Object.entries(summary).map(([k, v]) => (
            <div className="scorecard" key={k}>
              <div className="scorecard__val">{fmt(v)}</div>
              <div className="scorecard__key">{humanize(k)}</div>
            </div>
          ))}
        </div>
      )}
      <details className="result__detail" open>
        <summary>Full {mode} output</summary>
        <pre>{JSON.stringify(r.details ?? r, null, 2)}</pre>
      </details>
    </div>
  );
}

function fmt(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}
function humanize(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
