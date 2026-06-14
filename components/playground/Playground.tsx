"use client";

// =============================================================================
// Playground — paste any legacy code, one click triages then analyzes.
// The gate is advisory: a blocking verdict grays the modes and offers both a
// streamed "Fix it" repair pass AND an "Analyze anyway" override, so a triage
// false-positive can never trap valid code. The verdict is cached per source
// (see usePlayground), so switching modes never re-flips the gate.
//
// Structured rendering is shared with the estate panel via
// components/analysis/cockpits.tsx — the playground never re-implements a
// cockpit, so the two surfaces stay identical by construction.
// =============================================================================
import { useCallback, useRef, useState } from "react";
import type { AnalysisMode } from "@/lib/ai/core";
import { usePlayground } from "./usePlayground";
import {
  Cockpit,
  ModernizeBody,
  pickMarkdown,
  fmt,
  humanize,
} from "@/components/analysis/cockpits";

const MODES: { id: AnalysisMode; label: string; blurb: string }[] = [
  { id: "explain", label: "Explain", blurb: "Purpose, complexity, rules" },
  { id: "modernize", label: "Modernize", blurb: "Python + Java equivalents" },
  { id: "assess", label: "Assess", blurb: "Readiness, effort, risk" },
  { id: "extract", label: "Extract", blurb: "Business rules → tickets" },
];

const PLACEHOLDER = `Paste any legacy program here — COBOL, PL/I, HLASM, JCL …

The triage agent detects the language and checks the syntax
before any analysis runs.`;

const ANYWAY_BTN: React.CSSProperties = {
  padding: "10px 16px",
  background: "transparent",
  border: "1px solid var(--line)",
  borderRadius: 10,
  color: "var(--text-dim)",
  cursor: "pointer",
  font: "600 12.5px ui-monospace, monospace",
};

export function Playground() {
  const [source, setSource] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const onFixedCode = useCallback((code: string) => {
    setSource(code);
    taRef.current?.focus();
  }, []);

  const { state, analyze, analyzeAnyway, fix, sourceEdited } =
    usePlayground(onFixedCode);

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
                <span className="pg__lang" data-verdict={state.triage.verdict}>
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
                ⚠ Possible syntax issues — analysis gated
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
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="pg__fix"
                  onClick={() => fix(source)}
                  disabled={busy}
                >
                  ✦ Fix it for me
                </button>
                <button
                  type="button"
                  style={ANYWAY_BTN}
                  onClick={() => analyzeAnyway(source)}
                  disabled={busy}
                >
                  Analyze anyway →
                </button>
              </div>
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
              liveText={state.liveText}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// ── Result ────────────────────────────────────────────────────────────
// Modernize streams markdown (prose + fenced python/java) → ModernizeBody.
// JSON modes (explain/assess/extract) → surface-owned scorecards on top, then
// the shared Cockpit. Raw JSON is one collapsed toggle away. All structured
// rendering is imported from the shared module — nothing is duplicated here.
function Result({
  mode,
  result,
  triage,
  usage,
  liveText,
}: {
  mode: AnalysisMode | null;
  result: unknown;
  triage: { languageLabel: string; verdict: string } | null;
  usage: { totalTokens: number; totalCostUsd: number } | null;
  liveText: string;
}) {
  const meta = triage ? (
    <div className="pg__result-meta">
      {triage.languageLabel} · syntax {triage.verdict}
      {usage &&
        ` · ${usage.totalTokens.toLocaleString()} tokens · $${usage.totalCostUsd.toFixed(4)}`}
    </div>
  ) : null;

  // ── Modernize: prefer the streamed markdown (ground truth), else the result ──
  if (mode === "modernize") {
    const md =
      liveText && liveText.trim()
        ? liveText
        : result && typeof result === "object"
          ? pickMarkdown(result as Record<string, unknown>)
          : typeof result === "string"
            ? result
            : "";
    if (!md.trim()) return null;
    return (
      <div className="pg__result">
        {meta}
        <ModernizeBody markdown={md} />
      </div>
    );
  }

  // ── JSON modes ──
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  if ("raw" in r && typeof r.raw === "string") {
    return (
      <div className="pg__result">
        {meta}
        <pre className="pg__raw">{r.raw}</pre>
      </div>
    );
  }

  const summary = (r.summary ?? {}) as Record<string, unknown>;
  const details =
    r.details && typeof r.details === "object"
      ? (r.details as Record<string, unknown>)
      : null;

  return (
    <div className="pg__result">
      {meta}
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

      {details && mode && <Cockpit mode={mode} details={details} />}

      {details && (
        <details className="pg__detail">
          <summary>View raw JSON</summary>
          <pre>{JSON.stringify(details, null, 2)}</pre>
        </details>
      )}

      {!details && Object.keys(summary).length === 0 && (
        <details className="pg__detail" open>
          <summary>Full {mode} output</summary>
          <pre>{JSON.stringify(r, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
