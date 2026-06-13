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
              liveText={state.liveText}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// ── Result cockpit ───────────────────────────────────────────────────
// Modernize is a non-JSON mode: it streams markdown (prose + fenced
// python/java). We render that markdown directly — prose as text, code in
// labeled panes — instead of JSON-stringifying it (which escapes newlines).
// The JSON modes (explain/assess/extract) keep scorecards + pretty JSON.

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

  // ── Modernize: render the streamed markdown, not the escaped object ──
  if (mode === "modernize") {
    const md = modernizeText(result, liveText);
    if (!md.trim()) return null;
    return (
      <div className="pg__result">
        {meta}
        <ModernizeBody markdown={md} />
      </div>
    );
  }

  // ── JSON modes: scorecards + pretty JSON detail (unchanged) ──
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const summary = (r.summary ?? {}) as Record<string, unknown>;

  return (
    <div className="pg__result">
      {meta}
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

// Render markdown as prose + labeled code panes.
function ModernizeBody({ markdown }: { markdown: string }) {
  const parts = splitMarkdown(markdown);
  return (
    <div className="pg__md">
      {parts.map((p, i) =>
        p.type === "code" ? (
          <CodePane key={i} lang={p.lang} code={p.code} />
        ) : (
          p.text.trim() && (
            <div key={i} className="pg__prose" style={PROSE_STYLE}>
              {p.text.trim()}
            </div>
          )
        ),
      )}
    </div>
  );
}

function CodePane({ lang, code }: { lang: string; code: string }) {
  const accent = LANG_ACCENT[lang] ?? "var(--pg-accent, #94a3b8)";
  return (
    <div style={CODE_WRAP_STYLE}>
      <div style={{ ...CODE_HEAD_STYLE, color: accent }}>
        {lang.toUpperCase()}
      </div>
      <pre className="pg__live-text" style={CODE_PRE_STYLE}>
        {code.replace(/\n+$/, "")}
      </pre>
    </div>
  );
}

// Prefer the streamed text (ground-truth markdown). Fall back to any string
// field on the result object, then last-resort stringify.
function modernizeText(result: unknown, liveText: string): string {
  if (liveText && liveText.trim()) return liveText;
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const k of ["markdown", "text", "content", "raw", "answer", "output", "details"]) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return JSON.stringify(r, null, 2);
  }
  return "";
}

type MdPart =
  | { type: "prose"; text: string }
  | { type: "code"; lang: string; code: string };

function splitMarkdown(md: string): MdPart[] {
  const parts: MdPart[] = [];
  const fence = /```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md)) !== null) {
    if (m.index > last) {
      parts.push({ type: "prose", text: md.slice(last, m.index) });
    }
    parts.push({
      type: "code",
      lang: (m[1] || "code").toLowerCase(),
      code: m[2],
    });
    last = fence.lastIndex;
  }
  if (last < md.length) parts.push({ type: "prose", text: md.slice(last) });
  return parts;
}

const LANG_ACCENT: Record<string, string> = {
  python: "#7dd3fc",
  java: "#fbbf24",
  cobol: "#34d399",
};

const PROSE_STYLE: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  lineHeight: 1.65,
  fontSize: 14,
  margin: "10px 0",
  color: "rgba(226,232,240,0.86)",
};

const CODE_WRAP_STYLE: React.CSSProperties = {
  marginTop: 12,
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid rgba(148,163,184,0.16)",
  background: "rgba(148,163,184,0.04)",
};

const CODE_HEAD_STYLE: React.CSSProperties = {
  padding: "7px 13px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.09em",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  background: "rgba(148,163,184,0.07)",
  borderBottom: "1px solid rgba(148,163,184,0.14)",
};

const CODE_PRE_STYLE: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  border: "none",
  background: "transparent",
};

function fmt(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}
function humanize(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
