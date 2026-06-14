"use client";

import { useState, useRef } from "react";

interface Reference {
  type: "program" | "copybook" | "rule";
  id: string;
  name: string;
}

interface QueryResult {
  answer: string;
  references: Reference[];
  confidence: "high" | "medium" | "low";
}

interface Props {
  estateId: string;
  onClose: () => void;
  onNodeFocus?: (id: string) => void;
}

const CONF_COLOR: Record<string, string> = {
  high: "var(--ok)",
  medium: "var(--warn)",
  low: "var(--crit)",
};

export function EstateQueryPanel({ estateId, onClose, onNodeFocus }: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setUsage(null);
    try {
      const res = await fetch(`/api/estate/${estateId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Query failed");
      setResult(data.result as QueryResult);
      setUsage(data.usage ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="panel" role="dialog" aria-label="Estate query">
      <header className="panel__head">
        <div>
          <div className="panel__eyebrow">ESTATE QUERY</div>
          <h2 className="panel__title" style={{ fontSize: 18 }}>Ask the estate</h2>
        </div>
        <button className="panel__close" onClick={onClose}>✕</button>
      </header>

      <div className="panel__body">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            autoFocus
            style={{
              flex: 1, padding: "9px 12px",
              background: "var(--surface-2)", border: "1px solid var(--line)",
              borderRadius: 8, color: "var(--text)",
              font: "13px/1.4 ui-sans-serif, system-ui, sans-serif", outline: "none",
            }}
            placeholder="e.g. Which programs access CUSTOMER-DATA?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            disabled={loading}
          />
          <button
            onClick={submit}
            disabled={loading || !question.trim()}
            style={{
              padding: "9px 16px", background: "var(--info)", color: "#0a0e16",
              border: "none", borderRadius: 8,
              font: "600 13px/1 ui-sans-serif, system-ui, sans-serif",
              cursor: "pointer", opacity: loading || !question.trim() ? 0.4 : 1,
            }}
          >
            {loading ? "…" : "Ask"}
          </button>
        </div>

        {!result && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              "Which programs have the highest cyclomatic complexity?",
              "What business rules govern payroll calculations?",
              "Which copybooks are referenced most widely?",
              "List all programs involved in a call cycle.",
            ].map((s) => (
              <button
                key={s}
                onClick={() => { setQuestion(s); inputRef.current?.focus(); }}
                style={{
                  padding: "8px 12px", background: "var(--surface-2)",
                  border: "1px solid var(--line)", borderRadius: 6,
                  color: "var(--text-dim)", font: "12px/1.4 ui-sans-serif, system-ui, sans-serif",
                  textAlign: "left", cursor: "pointer",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-dim)", font: "13px/1 ui-monospace, monospace" }}>
            <span style={{
              display: "inline-block", width: 14, height: 14,
              border: "2px solid var(--line)", borderTopColor: "var(--info)",
              borderRadius: "50%", animation: "eq-spin 0.7s linear infinite",
            }} />
            Querying estate with Haiku…
          </div>
        )}

        {error && (
          <div className="panel__error">{error}</div>
        )}

        {result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ font: "700 10px/1 ui-monospace, monospace", letterSpacing: "0.1em", color: CONF_COLOR[result.confidence] }}>
              {result.confidence.toUpperCase()} CONFIDENCE
            </div>
            <p style={{ font: "13px/1.6 ui-sans-serif, system-ui, sans-serif", color: "var(--text)", margin: 0, whiteSpace: "pre-wrap" }}>
              {result.answer}
            </p>

            {result.references.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ font: "700 10px/1 ui-monospace, monospace", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 2 }}>
                  REFERENCED
                </div>
                {result.references.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => r.type !== "rule" && onNodeFocus?.(r.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", background: "var(--surface-2)",
                      border: "1px solid var(--line)", borderRadius: 6,
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{
                      font: "700 9px/1 ui-monospace, monospace", letterSpacing: "0.1em",
                      color: r.type === "program" ? "var(--info)" : "var(--text-faint)",
                      border: "1px solid var(--line)", padding: "2px 5px", borderRadius: 3, flexShrink: 0,
                    }}>
                      {r.type.toUpperCase()}
                    </span>
                    <span style={{ font: "13px/1 ui-sans-serif, system-ui, sans-serif", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {usage && (
              <div className="panel__usage">
                {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens (Haiku)
              </div>
            )}

            <button
              onClick={() => { setResult(null); setQuestion(""); setTimeout(() => inputRef.current?.focus(), 60); }}
              style={{
                alignSelf: "flex-start", padding: "7px 12px", background: "transparent",
                border: "1px solid var(--line)", borderRadius: 6, color: "var(--text-dim)",
                font: "12px/1 ui-sans-serif, system-ui, sans-serif", cursor: "pointer",
              }}
            >
              Ask another question
            </button>
          </div>
        )}
      </div>
      <style>{`@keyframes eq-spin { to { transform: rotate(360deg); } }`}</style>
    </aside>
  );
}
