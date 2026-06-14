"use client";

import { useState, useRef, useEffect } from "react";

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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNodeFocus?: (id: string, type?: "program" | "copybook") => void;
}

const CONF_COLOR: Record<string, string> = {
  high: "var(--ok)",
  medium: "var(--warn)",
  low: "var(--crit)",
};

export function EstateQueryPanel({ estateId, open, onOpenChange, onNodeFocus }: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

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
    <>
      <button
        className="eq-trigger"
        onClick={() => onOpenChange(!open)}
        aria-label="Query estate"
      >
        <span style={{ fontSize: 15 }}>⌕</span>
        <span>Query Estate</span>
      </button>

      {open && <div className="eq-backdrop" onClick={() => onOpenChange(false)} />}

      <aside className={`eq-panel${open ? " eq-panel--open" : ""}`} role="dialog">
        <header className="eq-panel__head">
          <div>
            <div className="panel__eyebrow">ESTATE QUERY</div>
            <h2 className="panel__title" style={{ fontSize: 16 }}>Ask anything about this estate</h2>
          </div>
          <button className="panel__close" onClick={() => onOpenChange(false)}>✕</button>
        </header>

        <div className="eq-panel__body">
          <div className="eq-input-row">
            <input
              ref={inputRef}
              className="eq-input"
              placeholder="e.g. Which programs access CUSTOMER-DATA?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              disabled={loading}
            />
            <button className="eq-submit" onClick={submit} disabled={loading || !question.trim()}>
              {loading ? "…" : "Ask"}
            </button>
          </div>

          {!result && !loading && (
            <div className="eq-suggestions">
              {[
                "Which programs have the highest cyclomatic complexity?",
                "What business rules govern payroll calculations?",
                "Which copybooks are referenced most widely?",
                "List all programs involved in a call cycle.",
              ].map((s) => (
                <button key={s} className="eq-suggestion" onClick={() => { setQuestion(s); inputRef.current?.focus(); }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {loading && (
            <div className="eq-loading">
              <span className="eq-spinner" />
              Querying estate with Haiku…
            </div>
          )}

          {error && <div className="panel__error" style={{ marginTop: 12 }}>{error}</div>}

          {result && (
            <div className="eq-result">
              <div className="eq-result__conf" style={{ color: CONF_COLOR[result.confidence] }}>
                {result.confidence.toUpperCase()} CONFIDENCE
              </div>
              <p className="eq-result__answer">{result.answer}</p>

              {result.references.length > 0 && (
                <div className="eq-refs">
                  <div className="eq-refs__label">REFERENCED</div>
                  {result.references.map((r) => (
                    <button
                      key={r.id}
                      className="eq-ref"
                      data-type={r.type}
                      onClick={() => {
                        if (r.type !== "rule" && onNodeFocus) {
                          onNodeFocus(r.id, r.type as "program" | "copybook");
                        }
                      }}
                    >
                      <span className="eq-ref__type">{r.type.toUpperCase()}</span>
                      <span className="eq-ref__name">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {usage && (
                <div className="panel__usage" style={{ marginTop: 12 }}>
                  {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens (Haiku)
                </div>
              )}

              <button className="eq-ask-again" onClick={() => { setResult(null); setQuestion(""); setTimeout(() => inputRef.current?.focus(), 60); }}>
                Ask another question
              </button>
            </div>
          )}
        </div>
      </aside>

      <style>{`
        .eq-trigger {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 12px;
          background: color-mix(in srgb, var(--surface) 90%, transparent);
          border: 1px solid var(--line); border-radius: 8px;
          color: var(--text-dim); font: 500 12px/1 ui-monospace, monospace;
          cursor: pointer; backdrop-filter: blur(8px);
          transition: border-color 0.15s, color 0.15s;
        }
        .eq-trigger:hover { border-color: var(--info); color: var(--text); }
        .eq-backdrop { position: fixed; inset: 0; z-index: 19; }
        .eq-panel {
          position: fixed; top: 0; right: 0; height: 100%; width: 420px; z-index: 20;
          display: flex; flex-direction: column;
          background: var(--surface); border-left: 1px solid var(--line);
          transform: translateX(100%);
          transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .eq-panel--open { transform: translateX(0); }
        .eq-panel__head {
          display: flex; align-items: flex-start; justify-content: space-between;
          padding: 20px 20px 16px; border-bottom: 1px solid var(--line);
        }
        .eq-panel__body { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
        .eq-input-row { display: flex; gap: 8px; }
        .eq-input {
          flex: 1; padding: 9px 12px; background: var(--surface-2);
          border: 1px solid var(--line); border-radius: 8px; color: var(--text);
          font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; outline: none;
          transition: border-color 0.15s;
        }
        .eq-input:focus { border-color: var(--info); }
        .eq-input::placeholder { color: var(--text-faint); }
        .eq-submit {
          padding: 9px 16px; background: var(--info); color: #0a0e16;
          border: none; border-radius: 8px; font: 600 13px/1 ui-sans-serif, system-ui, sans-serif;
          cursor: pointer; transition: opacity 0.15s;
        }
        .eq-submit:disabled { opacity: 0.4; cursor: not-allowed; }
        .eq-suggestions { display: flex; flex-direction: column; gap: 6px; }
        .eq-suggestion {
          padding: 8px 12px; background: var(--surface-2); border: 1px solid var(--line);
          border-radius: 6px; color: var(--text-dim); font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
          text-align: left; cursor: pointer; transition: border-color 0.15s, color 0.15s;
        }
        .eq-suggestion:hover { border-color: var(--info); color: var(--text); }
        .eq-loading { display: flex; align-items: center; gap: 10px; color: var(--text-dim); font: 13px/1 ui-monospace, monospace; padding: 12px 0; }
        .eq-spinner {
          display: inline-block; width: 14px; height: 14px;
          border: 2px solid var(--line); border-top-color: var(--info);
          border-radius: 50%; animation: eq-spin 0.7s linear infinite;
        }
        @keyframes eq-spin { to { transform: rotate(360deg); } }
        .eq-result { display: flex; flex-direction: column; gap: 10px; }
        .eq-result__conf { font: 700 10px/1 ui-monospace, monospace; letter-spacing: 0.1em; }
        .eq-result__answer { font: 13px/1.6 ui-sans-serif, system-ui, sans-serif; color: var(--text); margin: 0; white-space: pre-wrap; }
        .eq-refs { display: flex; flex-direction: column; gap: 5px; }
        .eq-refs__label { font: 700 10px/1 ui-monospace, monospace; letter-spacing: 0.08em; color: var(--text-faint); margin-bottom: 2px; }
        .eq-ref {
          display: flex; align-items: center; gap: 8px; padding: 7px 10px;
          background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px;
          cursor: pointer; text-align: left; transition: border-color 0.15s;
        }
        .eq-ref:hover { border-color: var(--info); }
        .eq-ref__type { font: 700 9px/1 ui-monospace, monospace; letter-spacing: 0.1em; color: var(--text-faint); border: 1px solid var(--line); padding: 2px 5px; border-radius: 3px; flex-shrink: 0; }
        .eq-ref[data-type="program"] .eq-ref__type { color: var(--info); border-color: color-mix(in srgb, var(--info) 30%, transparent); }
        .eq-ref[data-type="rule"] .eq-ref__type { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
        .eq-ref__name { font: 13px/1 ui-sans-serif, system-ui, sans-serif; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .eq-ask-again {
          align-self: flex-start; padding: 7px 12px; background: transparent;
          border: 1px solid var(--line); border-radius: 6px; color: var(--text-dim);
          font: 12px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .eq-ask-again:hover { border-color: var(--info); color: var(--text); }
      `}</style>
    </>
  );
}
