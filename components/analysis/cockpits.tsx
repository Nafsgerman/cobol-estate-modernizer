"use client";

// =============================================================================
// components/analysis/cockpits.tsx — single source of truth for analysis
// rendering, shared by the estate panel (AnalysisPanel) and the playground.
//
// JSON modes (explain/assess/extract/dependencies) → structured cockpits.
// Modernize → markdown prose + labeled code panes.
// All styling is theme-token-driven (var(--surface-2)/--line/--text) so it
// renders native on both surfaces with no CSS duplication.
// =============================================================================
import type * as React from "react";
import type { AnalysisMode } from "@/lib/ai/core";

type Obj = Record<string, unknown>;

// ── public: render the structured body for a finished JSON-mode result ──
export function Cockpit({ mode, details }: { mode: AnalysisMode; details: Obj }) {
  switch (mode) {
    case "explain":
      return <ExplainCockpit d={details} />;
    case "assess":
      return <AssessCockpit d={details} />;
    case "extract":
      return <ExtractCockpit d={details} />;
    case "dependencies":
      return <DependenciesCockpit d={details} />;
    default:
      return null;
  }
}

// ── public: pull modernize markdown off a result object ──
export function pickMarkdown(r: Obj): string {
  for (const k of ["analysis", "markdown", "text", "content", "answer", "output"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

export function fmt(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}
export function humanize(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Explain ────────────────────────────────────────────────────────────────
function ExplainCockpit({ d }: { d: Obj }) {
  const purpose = asObj(d.purpose);
  const tags = Array.isArray(purpose.tags) ? purpose.tags : [];
  const cx = asObj(d.complexity);
  const variables = asArr(d.variables);
  const rules = asArr(d.business_rules);

  const metrics: [string, React.ReactNode][] = [
    ["Compute statements", n(cx.compute_statements)],
    ["Perform calls", n(cx.perform_calls)],
    ["Copybooks", n(cx.copybooks)],
    ["CICS calls", n(cx.cics_calls)],
    ["DB2 queries", n(cx.db2_queries)],
    ["File I/O", cx.file_io ? "Yes" : "No"],
  ];

  return (
    <div style={COCKPIT}>
      {(purpose.description || tags.length > 0) && (
        <Section title="Purpose">
          {purpose.description ? <div style={NOTE}>{str(purpose.description)}</div> : null}
          {tags.length > 0 && (
            <div style={{ ...CHIPS, marginTop: 8 }}>
              {tags.map((t, i) => (
                <span key={i} style={CHIP}>
                  {str(t)}
                </span>
              ))}
            </div>
          )}
        </Section>
      )}

      {Object.keys(cx).length > 0 && (
        <Section title="Complexity">
          {metrics.map(([label, val]) => (
            <KV key={label} label={label} value={val} />
          ))}
          {cx.verdict ? <div style={NOTE}>{str(cx.verdict)}</div> : null}
        </Section>
      )}

      {variables.length > 0 && (
        <Section title={`Variables (${variables.length})`}>
          <Table head={["Name", "Picture", "Description"]}>
            {variables.map((v, i) => (
              <tr key={i}>
                <td style={TD}>
                  <code style={CODE}>{str(v.name)}</code>
                </td>
                <td style={TD}>
                  <code style={CODE}>{str(v.picture)}</code>
                </td>
                <td style={TD}>{str(v.description)}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {rules.length > 0 && (
        <Section title={`Business rules (${rules.length})`}>
          {rules.map((rl, i) => (
            <div key={i} style={CARD}>
              <div style={CARD_HEAD}>
                {rl.id ? <span style={ID_BADGE}>{str(rl.id)}</span> : null}
                <CategoryChip category={rl.category} />
              </div>
              <div style={STATEMENT}>{str(rl.statement)}</div>
              {rl.location ? <div style={LOCATION}>{str(rl.location)}</div> : null}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

// ── Extract ────────────────────────────────────────────────────────────────
function ExtractCockpit({ d }: { d: Obj }) {
  const rules = asArr(d.rules);
  const deps = asObj(d.data_dependencies);
  const depGroups = groups([
    ["DB2 tables", deps.db2_tables],
    ["VSAM files", deps.vsam_files],
    ["Sequential files", deps.sequential_files],
    ["Copybooks", deps.copybooks],
  ]);

  return (
    <div style={COCKPIT}>
      {rules.length > 0 && (
        <Section title={`Business rules → tickets (${rules.length})`}>
          {rules.map((rl, i) => {
            const jt = asObj(rl.jira_ticket);
            const criteria = Array.isArray(rl.acceptance_criteria) ? rl.acceptance_criteria : [];
            return (
              <div key={i} style={CARD}>
                <div style={CARD_HEAD}>
                  {rl.id ? <span style={ID_BADGE}>{str(rl.id)}</span> : null}
                  <PriorityTag level={rl.priority} />
                  <CategoryChip category={rl.category} />
                </div>
                <div style={STATEMENT}>{str(rl.statement)}</div>
                {rl.location ? <div style={LOCATION}>{str(rl.location)}</div> : null}
                {criteria.length > 0 && (
                  <ul style={{ ...UL, marginTop: 8 }}>
                    {criteria.map((c, j) => (
                      <li key={j} style={LI}>
                        {str(c)}
                      </li>
                    ))}
                  </ul>
                )}
                {Object.keys(jt).length > 0 && (
                  <div style={JIRA}>
                    <div style={JIRA_HEAD}>
                      <span style={JIRA_LABEL}>JIRA</span>
                      <span style={JIRA_TITLE}>{str(jt.title)}</span>
                    </div>
                    <div style={{ ...CHIPS, marginTop: 8 }}>
                      {jt.kind ? <span style={CHIP}>{cap(str(jt.kind))}</span> : null}
                      {jt.story_points != null ? <span style={CHIP}>{n(jt.story_points)} pts</span> : null}
                      {jt.priority ? <PriorityTag level={jt.priority} /> : null}
                    </div>
                    {jt.body ? <div style={NOTE}>{str(jt.body)}</div> : null}
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {(depGroups.length > 0 || deps.verdict) && (
        <Section title="Data dependencies">
          {depGroups.map(([label, items]) => (
            <DepRow key={label} label={label} items={items} />
          ))}
          {deps.verdict ? <div style={NOTE}>{str(deps.verdict)}</div> : null}
        </Section>
      )}
    </div>
  );
}

// ── Assess ─────────────────────────────────────────────────────────────────
function AssessCockpit({ d }: { d: Obj }) {
  const readiness = asObj(d.readiness);
  const breakdown = asArr(readiness.breakdown);
  const effort = asObj(d.effort);
  const phases = asArr(effort.phases);
  const risks = asArr(d.risks);
  const deps = asObj(d.dependencies);
  const depGroups = groups([
    ["Copybooks", deps.copybooks],
    ["Called programs", deps.called_programs],
    ["DB2 tables", deps.db2_tables],
    ["CICS", deps.cics_transactions],
    ["Files", deps.files],
  ]);

  return (
    <div style={COCKPIT}>
      {breakdown.length > 0 && (
        <Section title="Readiness breakdown">
          {breakdown.map((f, i) => (
            <div key={i} style={FACTOR_ROW}>
              <div style={FACTOR_HEAD}>
                <span>{str(f.factor)}</span>
                <span style={FACTOR_SCORE}>{n(f.score)}</span>
              </div>
              <ScoreBar score={n(f.score)} />
              {f.note ? <div style={NOTE}>{str(f.note)}</div> : null}
            </div>
          ))}
        </Section>
      )}

      {phases.length > 0 && (
        <Section title={`Effort — ${n(effort.total_days)} day${n(effort.total_days) === 1 ? "" : "s"}`}>
          <Table head={["Phase", "Days", "Detail"]}>
            {phases.map((p, i) => (
              <tr key={i}>
                <td style={TD}>{str(p.phase)}</td>
                <td style={TD}>{n(p.days)}</td>
                <td style={TD}>{str(p.description)}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {risks.length > 0 && (
        <Section title="Risks">
          {risks.map((rk, i) => (
            <div key={i} style={CARD}>
              <div style={CARD_HEAD}>
                <SevTag level={rk.level} />
                <span style={CARD_TITLE}>{str(rk.title)}</span>
              </div>
              {rk.description ? <div style={NOTE}>{str(rk.description)}</div> : null}
              {rk.mitigation ? (
                <div style={MITIGATION}>
                  <span style={MIT_LABEL}>Mitigation</span>
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
            <DepRow key={label} label={label} items={items} />
          ))}
          {deps.verdict ? <div style={NOTE}>{str(deps.verdict)}</div> : null}
        </Section>
      )}
    </div>
  );
}

// ── Dependencies ───────────────────────────────────────────────────────────
function DependenciesCockpit({ d }: { d: Obj }) {
  const callers = asArr(d.callers);
  const callees = asArr(d.callees);
  const cycles = asArr(d.cycles);
  const impacts = asArr(d.change_impact);
  const verdict = str(d.verdict);

  const relList = (rows: Obj[]) =>
    rows.map((c, i) => (
      <div key={i} style={REL_ROW}>
        <div style={REL_HEAD}>
          <span style={REL_NAME}>{str(c.name)}</span>
          <RelTag rel={c.relationship} />
        </div>
        {c.why_it_matters ? <div style={NOTE}>{str(c.why_it_matters)}</div> : null}
      </div>
    ));

  return (
    <div style={COCKPIT}>
      {callers.length > 0 && <Section title={`Callers (${callers.length})`}>{relList(callers)}</Section>}
      {callees.length > 0 && <Section title={`Callees (${callees.length})`}>{relList(callees)}</Section>}

      {cycles.length > 0 && (
        <Section title="Cycles">
          {cycles.map((cy, i) => (
            <div key={i} style={CARD}>
              <div style={CHIPS}>
                {(Array.isArray(cy.members) ? cy.members : []).map((m, j) => (
                  <code key={j} style={CODE}>
                    {str(m)}
                  </code>
                ))}
              </div>
              {cy.risk ? <div style={NOTE}>{str(cy.risk)}</div> : null}
              {cy.break_strategy ? (
                <div style={MITIGATION}>
                  <span style={MIT_LABEL}>Break strategy</span>
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
            <div key={i} style={CARD}>
              <div style={CARD_HEAD}>
                <SevTag level={im.severity} />
                <span style={CARD_TITLE}>{str(im.scenario)}</span>
              </div>
              {Array.isArray(im.affected) && im.affected.length > 0 ? (
                <div style={CHIPS}>
                  {im.affected.map((a, j) => (
                    <code key={j} style={CODE}>
                      {str(a)}
                    </code>
                  ))}
                </div>
              ) : null}
              {im.safeguard ? (
                <div style={MITIGATION}>
                  <span style={MIT_LABEL}>Safeguard</span>
                  {str(im.safeguard)}
                </div>
              ) : null}
            </div>
          ))}
        </Section>
      )}

      {verdict ? (
        <Section title="Verdict">
          <div style={NOTE}>{verdict}</div>
        </Section>
      ) : null}
    </div>
  );
}

// ── Modernize: markdown prose + labeled code panes ──────────────────────────
export function ModernizeBody({ markdown }: { markdown: string }) {
  const parts = splitMarkdown(markdown);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
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
    <div style={CODE_WRAP}>
      <div style={{ ...CODE_HEAD, color: accent }}>{lang.toUpperCase()}</div>
      <pre style={CODE_PRE}>{code.replace(/\n+$/, "")}</pre>
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
        <ul key={`ul-${key++}`} style={UL}>
          {items.map((li, i) => (
            <li key={i} style={LI}>
              {renderInline(li)}
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const t = lines[idx].trim();
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
      out.push(<hr key={`hr-${key++}`} style={HR} />);
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
      <p key={`p-${key++}`} style={P}>
        {renderInline(t)}
      </p>,
    );
  }
  flushList();
  return <div>{out}</div>;
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
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
function MdTable({ header, rows }: { header: string[]; rows: string[][] }) {
  const cols = header.length;
  return (
    <Table head={header.map((h) => renderInline(h))}>
      {rows.map((row, ri) => (
        <tr key={ri}>
          {Array.from({ length: cols }).map((_, ci) => (
            <td key={ci} style={TD}>
              {renderInline(row[ci] ?? "")}
            </td>
          ))}
        </tr>
      ))}
    </Table>
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
    if (tok.startsWith("**"))
      nodes.push(
        <strong key={k++} style={STRONG}>
          {tok.slice(2, -2)}
        </strong>,
      );
    else
      nodes.push(
        <code key={k++} style={CODE}>
          {tok.slice(1, -1)}
        </code>,
      );
    last = re.lastIndex;
  }
  if (last < s.length) nodes.push(s.slice(last));
  return nodes;
}
type MdPart = { type: "prose"; text: string } | { type: "code"; lang: string; code: string };
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

// ── shared primitives ───────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={SECTION}>
      <div style={SECTION_TITLE}>{title}</div>
      {children}
    </div>
  );
}
function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div style={TABLE_WRAP}>
      <table style={TABLE}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function DepRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div style={DEP_ROW}>
      <span style={DEP_LABEL}>{label}</span>
      <span style={CHIPS}>
        {items.map((x, i) => (
          <code key={i} style={CODE}>
            {x}
          </code>
        ))}
      </span>
    </div>
  );
}
function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 75 ? "#34d399" : pct >= 50 ? "#fbbf24" : "#f87171";
  return (
    <div style={BAR_TRACK}>
      <div style={{ ...BAR_FILL, width: `${pct}%`, background: color }} />
    </div>
  );
}
function SevTag({ level }: { level: unknown }) {
  const b = band(level);
  const c = SEV_COLOR[b];
  return <span style={{ ...TAG, color: c, borderColor: `${c}66`, background: `${c}1f` }}>{b}</span>;
}
function PriorityTag({ level }: { level: unknown }) {
  const b = prioBand(level);
  const c = PRIO_COLOR[b];
  return <span style={{ ...TAG, color: c, borderColor: `${c}66`, background: `${c}1f` }}>{b}</span>;
}
function RelTag({ rel }: { rel: unknown }) {
  const direct = str(rel).toLowerCase() === "direct";
  const c = direct ? "#7dd3fc" : "#94a3b8";
  return (
    <span style={{ ...TAG, color: c, borderColor: `${c}55`, background: `${c}1a` }}>
      {direct ? "direct" : "transitive"}
    </span>
  );
}
function CategoryChip({ category }: { category: unknown }) {
  const label = str(category).replace(/_/g, " ");
  if (!label) return null;
  return <span style={CHIP}>{cap(label)}</span>;
}
function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={KV_ROW}>
      <span style={KV_LABEL}>{label}</span>
      <span style={KV_VAL}>{value}</span>
    </div>
  );
}

// ── accessors ──
const asArr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const asObj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string => (v == null ? "" : String(v));
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const depList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : str(asObj(x).name))).filter(Boolean) : [];
const groups = (pairs: [string, unknown][]): [string, string[]][] =>
  pairs.map(([l, v]) => [l, depList(v)] as [string, string[]]).filter(([, v]) => v.length > 0);
function band(v: unknown): "Low" | "Medium" | "High" {
  const s = str(v).toLowerCase();
  if (s.startsWith("high")) return "High";
  if (s.startsWith("med")) return "Medium";
  return "Low";
}
function prioBand(v: unknown): "Critical" | "High" | "Medium" | "Low" {
  const s = str(v).toLowerCase();
  if (s.startsWith("crit")) return "Critical";
  if (s.startsWith("high")) return "High";
  if (s.startsWith("med")) return "Medium";
  return "Low";
}
const SEV_COLOR: Record<string, string> = { High: "#f87171", Medium: "#fbbf24", Low: "#34d399" };
const PRIO_COLOR: Record<string, string> = {
  Critical: "#fb7185",
  High: "#fb923c",
  Medium: "#fbbf24",
  Low: "#34d399",
};
const LANG_ACCENT: Record<string, string> = { python: "#7dd3fc", java: "#fbbf24", cobol: "#34d399" };

// ── styles (theme-token-driven) ──
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
const P: React.CSSProperties = { lineHeight: 1.65, fontSize: 14, margin: "9px 0", color: "rgba(226,232,240,0.86)" };
const UL: React.CSSProperties = { margin: "8px 0", paddingLeft: 18, listStyle: "disc" };
const LI: React.CSSProperties = { lineHeight: 1.6, fontSize: 14, margin: "4px 0", color: "rgba(226,232,240,0.86)" };
const STRONG: React.CSSProperties = { fontWeight: 600, color: "var(--text, #f1f5f9)" };
const CODE: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "0.88em",
  padding: "1px 5px",
  borderRadius: 5,
  background: "var(--surface-2, rgba(148,163,184,0.12))",
  color: "#a5b4fc",
};
const HR: React.CSSProperties = { border: "none", borderTop: "1px solid var(--line, rgba(148,163,184,0.16))", margin: "18px 0" };
const TABLE_WRAP: React.CSSProperties = {
  margin: "10px 0",
  overflowX: "auto",
  borderRadius: 10,
  border: "1px solid var(--line, rgba(148,163,184,0.16))",
};
const TABLE: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13.5 };
const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "9px 12px",
  fontWeight: 600,
  color: "var(--text, #f1f5f9)",
  background: "var(--surface-2, rgba(148,163,184,0.08))",
  borderBottom: "1px solid var(--line, rgba(148,163,184,0.18))",
  whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  padding: "8px 12px",
  color: "rgba(226,232,240,0.86)",
  borderBottom: "1px solid var(--line, rgba(148,163,184,0.10))",
  verticalAlign: "top",
  lineHeight: 1.55,
};
const CODE_WRAP: React.CSSProperties = {
  marginTop: 12,
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid var(--line, rgba(148,163,184,0.16))",
  background: "var(--surface-2, rgba(148,163,184,0.04))",
};
const CODE_HEAD: React.CSSProperties = {
  padding: "7px 13px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.09em",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  background: "var(--surface-2, rgba(148,163,184,0.07))",
  borderBottom: "1px solid var(--line, rgba(148,163,184,0.14))",
};
const CODE_PRE: React.CSSProperties = {
  margin: 0,
  padding: 14,
  overflowX: "auto",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.55,
  whiteSpace: "pre",
  color: "var(--text, #e2e8f0)",
};
const COCKPIT: React.CSSProperties = { marginTop: 4 };
const SECTION: React.CSSProperties = { margin: "18px 0" };
const SECTION_TITLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "rgba(226,232,240,0.55)",
  margin: "0 0 10px",
};
const FACTOR_ROW: React.CSSProperties = { margin: "11px 0" };
const FACTOR_HEAD: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 13.5,
  color: "var(--text, #e2e8f0)",
  marginBottom: 5,
};
const FACTOR_SCORE: React.CSSProperties = { fontVariantNumeric: "tabular-nums", color: "rgba(226,232,240,0.65)" };
const BAR_TRACK: React.CSSProperties = {
  height: 6,
  borderRadius: 999,
  background: "var(--surface-2, rgba(148,163,184,0.14))",
  overflow: "hidden",
};
const BAR_FILL: React.CSSProperties = { height: "100%", borderRadius: 999 };
const NOTE: React.CSSProperties = { fontSize: 13, lineHeight: 1.55, color: "rgba(226,232,240,0.7)", marginTop: 6 };
const STATEMENT: React.CSSProperties = { fontSize: 14, lineHeight: 1.55, color: "var(--text, #e2e8f0)", marginTop: 8 };
const CARD: React.CSSProperties = {
  border: "1px solid var(--line, rgba(148,163,184,0.16))",
  borderRadius: 10,
  padding: "11px 13px",
  margin: "8px 0",
  background: "var(--surface-2, rgba(148,163,184,0.04))",
};
const CARD_HEAD: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const CARD_TITLE: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: "var(--text, #f1f5f9)" };
const TAG: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
const CHIP: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 500,
  padding: "2px 9px",
  borderRadius: 999,
  border: "1px solid var(--line, rgba(148,163,184,0.22))",
  background: "var(--surface-2, rgba(148,163,184,0.08))",
  color: "rgba(226,232,240,0.78)",
  whiteSpace: "nowrap",
};
const ID_BADGE: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 7px",
  borderRadius: 6,
  background: "var(--surface-2, rgba(148,163,184,0.12))",
  color: "#a5b4fc",
  whiteSpace: "nowrap",
};
const LOCATION: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  color: "rgba(226,232,240,0.5)",
  marginTop: 6,
};
const MITIGATION: React.CSSProperties = { fontSize: 13, lineHeight: 1.55, marginTop: 8, color: "rgba(226,232,240,0.82)" };
const MIT_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#7dd3fc",
  marginRight: 6,
};
const DEP_ROW: React.CSSProperties = { display: "flex", gap: 10, alignItems: "baseline", margin: "7px 0", flexWrap: "wrap" };
const DEP_LABEL: React.CSSProperties = { fontSize: 12, color: "rgba(226,232,240,0.55)", minWidth: 110 };
const CHIPS: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const REL_ROW: React.CSSProperties = { padding: "9px 0", borderBottom: "1px solid var(--line, rgba(148,163,184,0.10))" };
const REL_HEAD: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const REL_NAME: React.CSSProperties = { fontWeight: 600, fontSize: 14, color: "var(--text, #f1f5f9)" };
const KV_ROW: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "5px 0",
  borderBottom: "1px solid var(--line, rgba(148,163,184,0.08))",
  fontSize: 13.5,
};
const KV_LABEL: React.CSSProperties = { color: "rgba(226,232,240,0.6)" };
const KV_VAL: React.CSSProperties = { color: "var(--text, #e2e8f0)", fontVariantNumeric: "tabular-nums", fontWeight: 600 };
const JIRA: React.CSSProperties = {
  marginTop: 10,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--line, rgba(148,163,184,0.14))",
  background: "rgba(125,211,252,0.05)",
};
const JIRA_HEAD: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const JIRA_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.1em",
  color: "#7dd3fc",
  border: "1px solid rgba(125,211,252,0.35)",
  borderRadius: 4,
  padding: "1px 5px",
};
const JIRA_TITLE: React.CSSProperties = { fontWeight: 600, fontSize: 13.5, color: "var(--text, #f1f5f9)" };
