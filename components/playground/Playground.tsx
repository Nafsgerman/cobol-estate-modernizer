"use client";

// =============================================================================
// Playground — paste any legacy code, one click triages then analyzes.
// The gate is invisible until it matters: blocking verdict grays the modes
// and offers a streamed "Fix it" repair pass.
// =============================================================================
import { useCallback, useRef, useState } from "react";
import type { AnalysisMode } from "@/lib/ai/core";
import { usePlayground } from "./usePlayground";

const MODES: { id: AnalysisMode; label: string; blurb: string }[] = [
  { id: "explain", label: "Explain", blurb: "Purpose, complexity, rules" },
  { id: "modernize", label: "Modernize", blurb: "Python + Java equivalents" },
  { id: "assess", label: "Assess", blurb: "Readiness, effort, risk" },
  { id: "extract", label: "Extract", blurb: "Business rules → tickets" },
];

const PLACEHOLDER = `Paste any legacy program here — COBOL, PL/I, HLASM, JCL …

The triage agent detects the language and checks the syntax
before any analysis runs.`;

export function Playground() {
  const [source, setSource] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const onFixedCode = useCallback((code: string) => {
    setSource(code);
    taRef.current?.focus();
  }, []);

  const { state, analyze, fix, sourceEdited } = usePlayground(onFixedCode);

  const busy =
    state.phase === "triaging" ||
    state.phase === "analyzing" ||
    state.phase === "fixing";
  const blocked = state.phase === "blocked";
  const modesDisabled = busy || blocked || source.trim().length === 0;

  return (
    <div className="pg">
      <header className="pg__header">
        <div className="pg__eyebrow">LEGACY CODE PLAYGROUND</div>
        <h1 className="pg__title">Paste. Triage. Analyze.</h1>
        <p className="pg__sub">
          A fast agent identifies the language and gates the syntax before any
          deep analysis runs — broken code never reaches the expensive model.
        </p>
      </header>

      <div className="pg__grid">
        {/* ── Editor ── */}
        <section className="pg__editor-col">
          <div className="pg__editor-frame" data-blocked={blocked || undefined}>
            <div className="pg__editor-bar">
              <span className="pg__dot pg__dot--r" />
              <span className="pg__dot pg__dot--y" />
              <span className="pg__dot pg__dot--g" />
              <span className="pg__editor-name">source</span>
              {state.triage && (
                <span
                  className="pg__lang"
                  data-verdict={state.triage.verdict}
                >
                  {state.triage.languageLabel} · {state.triage.verdict}
                </span>
              )}
            </div>
            <textarea
              ref={taRef}
              className="pg__editor"
              value={source}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              onChange={(e) => {
                setSource(e.target.value);
                sourceEdited();
              }}
            />
          </div>

          <div className="pg__modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                className="pg__mode"
                disabled={modesDisabled}
                onClick={() => analyze(source, m.id)}
              >
                <span className="pg__mode-label">{m.label}</span>
                <span className="pg__mode-blurb">{m.blurb}</span>
              </button>
            ))}
          </div>

          {blocked && state.triage && (
            <div className="pg__blocked">
              <div className="pg__blocked-head">
                ✕ Syntax errors — analysis gated
              </div>
              <ul className="pg__issues">
                {state.triage.issues.map((i, n) => (
                  <li key={n} data-sev={i.severity}>
                    <span className="pg__issue-line">
                      {i.line ? `L${i.line}` : "—"}
                    </span>
                    <span>
                      {i.message}
                      <em className="pg__issue-hint">{i.hint}</em>
                    </span>
                  </li>
                ))}
              </ul>
              <button
                className="pg__fix"
                onClick={() => fix(source)}
                disabled={busy}
              >
                ✦ Fix it for me
              </button>
            </div>
          )}

          {state.fixNotes.length > 0 && (
            <div className="pg__fixed">
              <div className="pg__fixed-head">✓ Code repaired</div>
              <ul>
                {state.fixNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <div className="pg__fixed-cta">
                Re-run any analysis — the corrected source is in the editor.
              </div>
            </div>
          )}
        </section>

        {/* ── Output ── */}
        <section className="pg__output">
          {state.phase === "idle" && !state.fixNotes.length && (
            <div className="pg__empty">
              <div className="pg__empty-glyph">⌁</div>
              Paste code and choose an analysis.
              <span>The triage agent runs automatically first.</span>
            </div>
          )}

          {busy && (
            <div className="pg__live">
              <div className="pg__live-head">
                <span className="pg__pulse" />
                {state.phase === "triaging" && "Detecting language, checking syntax…"}
                {state.phase === "analyzing" &&
                  (state.triage
                    ? `${state.triage.languageLabel} · syntax ${state.triage.verdict} — analyzing…`
                    : "Analyzing…")}
                {state.phase === "fixing" && "Repairing source…"}
              </div>
              {state.liveText && (
                <pre className="pg__live-text">{state.liveText}</pre>
              )}
            </div>
          )}

          {state.phase === "error" && (
            <div className="pg__error">{state.error}</div>
          )}

          {state.phase === "done" && (
            <Result
              mode={state.resultMode}
              result={state.result}
              triage={state.triage}
              usage={state.usage}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// ── Result cockpit (scorecards + detail) ─────────────────────────────

function Result({
  mode,
  result,
  triage,
  usage,
}: {
  mode: AnalysisMode | null;
  result: unknown;
  triage: { languageLabel: string; verdict: string } | null;
  usage: { totalTokens: number; totalCostUsd: number } | null;
}) {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const summary = (r.summary ?? {}) as Record<string, unknown>;

  return (
    <div className="pg__result">
      {triage && (
        <div className="pg__result-meta">
          {triage.languageLabel} · syntax {triage.verdict}
          {usage &&
            ` · ${usage.totalTokens.toLocaleString()} tokens · $${usage.totalCostUsd.toFixed(4)}`}
        </div>
      )}
      {"raw" in r && typeof r.raw === "string" ? (
        <pre className="pg__raw">{r.raw}</pre>
      ) : (
        <>
          {Object.keys(summary).length > 0 && (
            <div className="pg__cards">
              {Object.entries(summary).map(([k, v]) => (
                <div className="pg__card" key={k}>
                  <div className="pg__card-val">{fmt(v)}</div>
                  <div className="pg__card-key">{humanize(k)}</div>
                </div>
              ))}
            </div>
          )}
          <details className="pg__detail" open>
            <summary>Full {mode} output</summary>
            <pre>{JSON.stringify(r.details ?? r, null, 2)}</pre>
          </details>
        </>
      )}
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
