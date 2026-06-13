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

  // ── JSON modes: scorecards + structured cockpit (assess/deps) or JSON ──
  const summary = (r.summary ?? {}) as Record<string, unknown>;
  const details =
    r.details && typeof r.details === "object"
      ? (r.details as Record<string, unknown>)
      : null;

  const hasCockpit = mode === "assess" || mode === "dependencies";

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

      {details && mode === "assess" && <AssessCockpit d={details} />}
      {details && mode === "dependencies" && <DependenciesCockpit d={details} />}

      {details ? (
        <details className="result__detail">
          <summary>{hasCockpit ? "View raw JSON" : "Structured data"}</summary>
          <pre>{JSON.stringify(details, null, 2)}</pre>
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

// ── Assess cockpit ───────────────────────────────────────────────────────
function AssessCockpit({ d }: { d: Record<string, unknown> }) {
  const readiness = asObj(d.readiness);
  const breakdown = asArr(readiness.breakdown);
  const effort = asObj(d.effort);
  const phases = asArr(effort.phases);
  const risks = asArr(d.risks);
  const deps = asObj(d.dependencies);

  const depGroups: [string, string[]][] = (
    [
      ["Copybooks", deps.copybooks],
      ["Called programs", deps.called_programs],
      ["DB2 tables", deps.db2_tables],
      ["CICS", deps.cics_transactions],
      ["Files", deps.files],
    ] as [string, unknown][]
  )
    .map(([label, v]) => [label, depList(v)] as [string, string[]])
    .filter(([, v]) => v.length > 0);

  return (
    <div style={COCKPIT_STYLE}>
      {breakdown.length > 0 && (
        <Section title="Readiness breakdown">
          {breakdown.map((f, i) => (
            <div key={i} style={FACTOR_ROW_STYLE}>
              <div style={FACTOR_HEAD_STYLE}>
                <span>{str(f.factor)}</span>
                <span style={FACTOR_SCORE_STYLE}>{n(f.score)}</span>
              </div>
              <ScoreBar score={n(f.score)} />
              {f.note ? <div style={NOTE_STYLE}>{str(f.note)}</div> : null}
            </div>
          ))}
        </Section>
      )}

      {phases.length > 0 && (
        <Section
          title={`Effort — ${n(effort.total_days)} day${n(effort.total_days) === 1 ? "" : "s"}`}
        >
          <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={TH_STYLE}>Phase</th>
                  <th style={TH_STYLE}>Days</th>
                  <th style={TH_STYLE}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p, i) => (
                  <tr key={i}>
                    <td style={TD_STYLE}>{str(p.phase)}</td>
                    <td style={TD_STYLE}>{n(p.days)}</td>
                    <td style={TD_STYLE}>{str(p.description)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {risks.length > 0 && (
        <Section title="Risks">
          {risks.map((rk, i) => (
            <div key={i} style={CARD_STYLE}>
              <div style={CARD_HEAD_STYLE}>
                <SevTag level={rk.level} />
                <span style={CARD_TITLE_STYLE}>{str(rk.title)}</span>
              </div>
              {rk.description ? <div style={NOTE_STYLE}>{str(rk.description)}</div> : null}
              {rk.mitigation ? (
                <div style={MITIGATION_STYLE}>
                  <span style={MIT_LABEL_STYLE}>Mitigation</span>
                  {str(rk.mitigation)}
                </div>
              ) : null}
            </div>
          ))}
        </Section>
      )}

      {(depGroups.length > 0 || deps.verdict) && (
        <Section title="Dependencies">
          {depGroups.map(([label, items]) => (
            <div key={label} style={DEP_ROW_STYLE}>
              <span style={DEP_LABEL_STYLE}>{label}</span>
              <span style={CHIPS_STYLE}>
                {items.map((x, i) => (
                  <code key={i} style={INLINE_CODE_STYLE}>
                    {x}
                  </code>
                ))}
              </span>
            </div>
          ))}
          {deps.verdict ? <div style={NOTE_STYLE}>{str(deps.verdict)}</div> : null}
        </Section>
      )}
    </div>
  );
}

// ── Dependencies cockpit ───────────────────────────────────────────────────
function DependenciesCockpit({ d }: { d: Record<string, unknown> }) {
  const callers = asArr(d.callers);
  const callees = asArr(d.callees);
  const cycles = asArr(d.cycles);
  const impacts = asArr(d.change_impact);
  const verdict = str(d.verdict);

  const relList = (rows: Record<string, unknown>[]) =>
    rows.map((c, i) => (
      <div key={i} style={REL_ROW_STYLE}>
        <div style={REL_HEAD_STYLE}>
          <span style={REL_NAME_STYLE}>{str(c.name)}</span>
          <RelTag rel={c.relationship} />
        </div>
        {c.why_it_matters ? <div style={NOTE_STYLE}>{str(c.why_it_matters)}</div> : null}
      </div>
    ));

  return (
    <div style={COCKPIT_STYLE}>
      {callers.length > 0 && (
        <Section title={`Callers (${callers.length})`}>{relList(callers)}</Section>
      )}
      {callees.length > 0 && (
        <Section title={`Callees (${callees.length})`}>{relList(callees)}</Section>
      )}

      {cycles.length > 0 && (
        <Section title="Cycles">
          {cycles.map((cy, i) => (
            <div key={i} style={CARD_STYLE}>
              <div style={CHIPS_STYLE}>
                {(Array.isArray(cy.members) ? cy.members : []).map((m, j) => (
                  <code key={j} style={INLINE_CODE_STYLE}>
                    {str(m)}
                  </code>
                ))}
              </div>
              {cy.risk ? <div style={NOTE_STYLE}>{str(cy.risk)}</div> : null}
              {cy.break_strategy ? (
                <div style={MITIGATION_STYLE}>
                  <span style={MIT_LABEL_STYLE}>Break strategy</span>
                  {str(cy.break_strategy)}
                </div>
              ) : null}
            </div>
          ))}
        </Section>
      )}

      {impacts.length > 0 && (
        <Section title="Change impact">
          {impacts.map((im, i) => (
            <div key={i} style={CARD_STYLE}>
              <div style={CARD_HEAD_STYLE}>
                <SevTag level={im.severity} />
                <span style={CARD_TITLE_STYLE}>{str(im.scenario)}</span>
              </div>
              {Array.isArray(im.affected) && im.affected.length > 0 ? (
                <div style={CHIPS_STYLE}>
                  {im.affected.map((a, j) => (
                    <code key={j} style={INLINE_CODE_STYLE}>
                      {str(a)}
                    </code>
                  ))}
                </div>
              ) : null}
              {im.safeguard ? (
                <div style={MITIGATION_STYLE}>
                  <span style={MIT_LABEL_STYLE}>Safeguard</span>
                  {str(im.safeguard)}
                </div>
              ) : null}
            </div>
          ))}
        </Section>
      )}

      {verdict ? (
        <Section title="Verdict">
          <div style={NOTE_STYLE}>{verdict}</div>
        </Section>
      ) : null}
    </div>
  );
}

// ── Shared cockpit primitives ──────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>{title}</div>
      {children}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 75 ? "#34d399" : pct >= 50 ? "#fbbf24" : "#f87171";
  return (
    <div style={BAR_TRACK_STYLE}>
      <div style={{ ...BAR_FILL_STYLE, width: `${pct}%`, background: color }} />
    </div>
  );
}

function SevTag({ level }: { level: unknown }) {
  const b = band(level);
  const c = SEV_COLOR[b];
  return (
    <span style={{ ...TAG_STYLE, color: c, borderColor: `${c}66`, background: `${c}1f` }}>
      {b}
    </span>
  );
}

function RelTag({ rel }: { rel: unknown }) {
  const direct = str(rel).toLowerCase() === "direct";
  const c = direct ? "#7dd3fc" : "#94a3b8";
  return (
    <span style={{ ...TAG_STYLE, color: c, borderColor: `${c}55`, background: `${c}1a` }}>
      {direct ? "direct" : "transitive"}
    </span>
  );
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

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 1;
}
function isTableDivider(line: string): boolean {
  const t = line.trim();
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

// ── data accessors ──
const asArr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (v == null ? "" : String(v));
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const depList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : str(asObj(x).name))).filter(Boolean)
    : [];
function band(v: unknown): "Low" | "Medium" | "High" {
  const s = str(v).toLowerCase();
  if (s.startsWith("high")) return "High";
  if (s.startsWith("med")) return "Medium";
  return "Low";
}
const SEV_COLOR: Record<string, string> = {
  High: "#f87171",
  Medium: "#fbbf24",
  Low: "#34d399",
};

// ── styles ──
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
const UL_STYLE: React.CSSProperties = { margin: "8px 0", paddingLeft: 18, listStyle: "disc" };
const LI_STYLE: React.CSSProperties = {
  lineHeight: 1.6,
  fontSize: 14,
  margin: "4px 0",
  color: "rgba(226,232,240,0.86)",
};
const STRONG_STYLE: React.CSSProperties = { fontWeight: 600, color: "var(--text, #f1f5f9)" };
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
  margin: "10px 0",
  overflowX: "auto",
  borderRadius: 10,
  border: "1px solid var(--line, rgba(148,163,184,0.16))",
};
const TABLE_STYLE: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13.5 };
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

const COCKPIT_STYLE: React.CSSProperties = { marginTop: 4 };
const SECTION_STYLE: React.CSSProperties = { margin: "18px 0" };
const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "rgba(226,232,240,0.55)",
  margin: "0 0 10px",
};
const FACTOR_ROW_STYLE: React.CSSProperties = { margin: "11px 0" };
const FACTOR_HEAD_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 13.5,
  color: "var(--text, #e2e8f0)",
  marginBottom: 5,
};
const FACTOR_SCORE_STYLE: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  color: "rgba(226,232,240,0.65)",
};
const BAR_TRACK_STYLE: React.CSSProperties = {
  height: 6,
  borderRadius: 999,
  background: "var(--surface-2, rgba(148,163,184,0.14))",
  overflow: "hidden",
};
const BAR_FILL_STYLE: React.CSSProperties = { height: "100%", borderRadius: 999 };
const NOTE_STYLE: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: "rgba(226,232,240,0.7)",
  marginTop: 6,
};
const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--line, rgba(148,163,184,0.16))",
  borderRadius: 10,
  padding: "11px 13px",
  margin: "8px 0",
  background: "var(--surface-2, rgba(148,163,184,0.04))",
};
const CARD_HEAD_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const CARD_TITLE_STYLE: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: "var(--text, #f1f5f9)",
};
const TAG_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
const MITIGATION_STYLE: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  marginTop: 8,
  color: "rgba(226,232,240,0.82)",
};
const MIT_LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#7dd3fc",
  marginRight: 6,
};
const DEP_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "baseline",
  margin: "7px 0",
  flexWrap: "wrap",
};
const DEP_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(226,232,240,0.55)",
  minWidth: 110,
};
const CHIPS_STYLE: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const REL_ROW_STYLE: React.CSSProperties = {
  padding: "9px 0",
  borderBottom: "1px solid var(--line, rgba(148,163,184,0.10))",
};
const REL_HEAD_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const REL_NAME_STYLE: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: "var(--text, #f1f5f9)",
};

function fmt(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}
function humanize(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
