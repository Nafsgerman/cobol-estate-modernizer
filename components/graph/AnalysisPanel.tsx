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
        {state.status === "streaming" && (
          <LiveStream text={state.liveText} mode={mode} />
        )}
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

// While streaming: Modernize emits markdown (prose + fenced code) — render it
// live so the user never sees a wall of ## and ``` . JSON modes stream JSON,
// which we leave raw until the structured Result takes over on "done".
function LiveStream({ text, mode }: { text: string; mode: AnalysisMode }) {
  return (
    <div className="live">
      <div className="live__head">
        <span className="live__pulse" /> Analyzing…
      </div>
      {mode === "modernize" && text.trim() ? (
        <ModernizeBody markdown={text} />
      ) : (
        <pre className="live__text">{text || "​"}</pre>
      )}
    </div>
  );
}

function Result({ mode, result }: { mode: AnalysisMode; result: unknown }) {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  if ("raw" in r && typeof r.raw === "string")
    return <pre className="result__raw">{r.raw}</pre>;

  // ── Modernize: render streamed markdown as prose + labeled code panes ──
  if (mode === "modernize") {
    const md = pickMarkdown(r);
    if (md.trim()) {
      return (
        <div className="result">
          <ModernizeBody markdown={md} />
        </div>
      );
    }
  }

  // ── JSON modes (explain/assess/extract/dependencies): scorecards + detail ──
  const summary = (r.summary ?? {}) as Record<string, unknown>;
  const structured = r.details && typeof r.details === "object" ? r.details : null;

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

      {structured ? (
        <details className="result__detail">
          <summary>Structured data</summary>
          <pre>{JSON.stringify(structured, null, 2)}</pre>
        </details>
      ) : (
        Object.keys(summary).length === 0 && (
          <details className="result__detail" open>
            <summary>Full {mode} output</summary>
            <pre>{JSON.stringify(r, null, 2)}</pre>
          </details>
        )
      )}
    </div>
  );
}

// Pull the modernize markdown string off the result object, whatever it's keyed as.
function pickMarkdown(r: Record<string, unknown>): string {
  for (const k of ["analysis", "markdown", "text", "content", "answer", "output"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

// ── Markdown renderer: prose + labeled code panes (dependency-free) ──────────
function ModernizeBody({ markdown }: { markdown: string }) {
  const parts = splitMarkdown(markdown);
  return (
    <div className="result__md">
      {parts.map((p, i) =>
        p.type === "code" ? (
          <CodePane key={i} lang={p.lang} code={p.code} />
        ) : (
          p.text.trim() && (
            <div key={i} className="result__prose" style={PROSE_STYLE}>
              {p.text.trim()}
            </div>
          )
        ),
      )}
    </div>
  );
}

function CodePane({ lang, code }: { lang: string; code: string }) {
  const accent = LANG_ACCENT[lang] ?? "var(--text, #94a3b8)";
  return (
    <div style={CODE_WRAP_STYLE}>
      <div style={{ ...CODE_HEAD_STYLE, color: accent }}>{lang.toUpperCase()}</div>
      <pre className="live__text" style={CODE_PRE_STYLE}>
        {code.replace(/\n+$/, "")}
      </pre>
    </div>
  );
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
    if (m.index > last) parts.push({ type: "prose", text: md.slice(last, m.index) });
    parts.push({ type: "code", lang: (m[1] || "code").toLowerCase(), code: m[2] });
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
  border: "1px solid var(--line, rgba(148,163,184,0.16))",
  background: "var(--surface-2, rgba(148,163,184,0.04))",
};

const CODE_HEAD_STYLE: React.CSSProperties = {
  padding: "7px 13px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.09em",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  background: "var(--surface-2, rgba(148,163,184,0.07))",
  borderBottom: "1px solid var(--line, rgba(148,163,184,0.14))",
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
