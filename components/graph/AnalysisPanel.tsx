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

// Modernize streams markdown; render it live. JSON modes stream JSON — leave raw
// until the structured Result takes over on "done".
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

  // ── JSON modes: scorecards + collapsible structured detail ──
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

function pickMarkdown(r: Record<string, unknown>): string {
  for (const k of ["analysis", "markdown", "text", "content", "answer", "output"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

// ── Markdown renderer: prose (formatted) + labeled code panes ────────────────
function ModernizeBody({ markdown }: { markdown: string }) {
  const parts = splitMarkdown(markdown);
  return (
    <div className="result__md">
      {parts.map((p, i) =>
        p.type === "code" ? (
          <CodePane key={i} lang={p.lang} code={p.code} />
        ) : (
          p.text.trim() && <MarkdownProse key={i} text={p.text} />
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

// Block-level markdown: headings, tables, bullet lists, rules, paragraphs.
// Inline bold/code handled by renderInline. No dependency.
function MarkdownProse({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      const items = [...list];
      out.push(
        <ul key={`ul-${key++}`} style={UL_STYLE}>
          {items.map((li, i) => (
            <li key={i} style={LI_STYLE}>
              {renderInline(li)}
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const t = raw.trim();

    if (!t) {
      flushList();
      continue;
    }

    // Table: a header row of pipes followed by a |---|---| separator row.
    if (isTableRow(t) && idx + 1 < lines.length && isTableDivider(lines[idx + 1])) {
      flushList();
      const header = splitRow(t);
      const rows: string[][] = [];
      let j = idx + 2;
      while (j < lines.length && isTableRow(lines[j].trim())) {
        rows.push(splitRow(lines[j].trim()));
        j++;
      }
      out.push(<MdTable key={`tbl-${key++}`} header={header} rows={rows} />);
      idx = j - 1;
      continue;
    }

    if (/^---+$/.test(t) || /^___+$/.test(t)) {
      flushList();
      out.push(<hr key={`hr-${key++}`} style={HR_STYLE} />);
      continue;
    }

    const heading = t.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList();
      out.push(
        <div key={`h-${key++}`} style={headingStyle(heading[1].length)}>
          {renderInline(heading[2])}
        </div>,
      );
      continue;
    }

    const bullet = t.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }

    flushList();
    out.push(
      <p key={`p-${key++}`} style={P_STYLE}>
        {renderInline(t)}
      </p>,
    );
  }
  flushList();
  return <div className="result__prose">{out}</div>;
}

// ── Table helpers ──
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 1;
}
function isTableDivider(line: string): boolean {
  const t = line.trim();
  // |---|:--:|---| style rows: only pipes, dashes, colons, spaces, and >=1 dash.
  return isTableRow(t) && /^\|[\s:|-]*\|$/.test(t) && t.includes("-");
}
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function MdTable({ header, rows }: { header: string[]; rows: string[][] }) {
  const cols = header.length;
  return (
    <div style={TABLE_WRAP_STYLE}>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} style={TH_STYLE}>
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {Array.from({ length: cols }).map((_, ci) => (
                <td key={ci} style={TD_STYLE}>
                  {renderInline(row[ci] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Inline **bold** and `code`.
function renderInline(s: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) nodes.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={k++} style={STRONG_STYLE}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code key={k++} style={INLINE_CODE_STYLE}>
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = re.lastIndex;
  }
  if (last < s.length) nodes.push(s.slice(last));
  return nodes;
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

function headingStyle(level: number): React.CSSProperties {
  const sizes = [0, 19, 17, 15, 14, 13, 13];
  return {
    fontSize: sizes[level] ?? 14,
    fontWeight: 600,
    color: "var(--text, #f1f5f9)",
    margin: level <= 2 ? "20px 0 8px" : "16px 0 6px",
    letterSpacing: "-0.01em",
  };
}

const P_STYLE: React.CSSProperties = {
  lineHeight: 1.65,
  fontSize: 14,
  margin: "9px 0",
  color: "rgba(226,232,240,0.86)",
};

const UL_STYLE: React.CSSProperties = {
  margin: "8px 0",
  paddingLeft: 18,
  listStyle: "disc",
};

const LI_STYLE: React.CSSProperties = {
  lineHeight: 1.6,
  fontSize: 14,
  margin: "4px 0",
  color: "rgba(226,232,240,0.86)",
};

const STRONG_STYLE: React.CSSProperties = {
  fontWeight: 600,
  color: "var(--text, #f1f5f9)",
};

const INLINE_CODE_STYLE: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "0.88em",
  padding: "1px 5px",
  borderRadius: 5,
  background: "var(--surface-2, rgba(148,163,184,0.12))",
  color: "#a5b4fc",
};

const HR_STYLE: React.CSSProperties = {
  border: "none",
  borderTop: "1px solid var(--line, rgba(148,163,184,0.16))",
  margin: "18px 0",
};

const TABLE_WRAP_STYLE: React.CSSProperties = {
  margin: "12px 0",
  overflowX: "auto",
  borderRadius: 10,
  border: "1px solid var(--line, rgba(148,163,184,0.16))",
};

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13.5,
};

const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "9px 12px",
  fontWeight: 600,
  color: "var(--text, #f1f5f9)",
  background: "var(--surface-2, rgba(148,163,184,0.08))",
  borderBottom: "1px solid var(--line, rgba(148,163,184,0.18))",
  whiteSpace: "nowrap",
};

const TD_STYLE: React.CSSProperties = {
  padding: "8px 12px",
  color: "rgba(226,232,240,0.86)",
  borderBottom: "1px solid var(--line, rgba(148,163,184,0.10))",
  verticalAlign: "top",
  lineHeight: 1.55,
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
