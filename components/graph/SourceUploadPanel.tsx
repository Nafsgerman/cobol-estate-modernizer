"use client";

import { useState, useCallback, useRef } from "react";
import { updateProgramSource } from "@/app/actions/estate-source";
import type { TriageResult } from "@/lib/ai/triage";

interface Props {
  programId: string;
  programName: string;
  onSaved: () => void;
}

type Phase = "idle" | "saving" | "error";

export function SourceUploadPanel({ programId, programName, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const reset = useCallback(() => {
    setSource("");
    setPhase("idle");
    setTriage(null);
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!source.trim()) return;
    setPhase("saving");
    setError(null);
    try {
      const result = await updateProgramSource(programId, source);
      setTriage(result.triage);
      if (!result.ok) {
        setPhase("error");
        setError(result.error ?? "Save failed.");
        return;
      }
      setOpen(false);
      reset();
      // Delay reload by 800ms to let Aurora propagate the write
      setTimeout(() => onSaved(), 800);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  }, [programId, source, reset, onSaved]);

  const handleChange = useCallback((val: string) => {
    setSource(val);
    setPhase("idle");
    setTriage(null);
    setError(null);
  }, []);

  if (!open) {
    return (
      <button
        className="source-upload__trigger"
        onClick={() => { setOpen(true); setTimeout(() => taRef.current?.focus(), 50); }}
      >
        ↑ Update source
      </button>
    );
  }

  const busy = phase === "saving";
  const canSave = source.trim().length > 0 && !busy;

  return (
    <div className="source-upload">
      <div className="source-upload__head">
        <span>Update source — {programName}</span>
        <button className="source-upload__cancel" onClick={() => { setOpen(false); reset(); }}>
          ✕
        </button>
      </div>

      <textarea
        ref={taRef}
        className="source-upload__editor"
        value={source}
        placeholder={`Paste corrected COBOL source for ${programName}…`}
        spellCheck={false}
        onChange={(e) => handleChange(e.target.value)}
      />

      {triage && phase === "error" && (
        <div className="source-upload__triage" data-verdict={triage.verdict}>
          {triage.languageLabel} · {triage.verdict}
          {triage.issues.length > 0 && (
            <ul className="source-upload__issues">
              {triage.issues.map((i, n) => (
                <li key={n} data-sev={i.severity}>
                  {i.line ? `L${i.line} ` : ""}{i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <div className="source-upload__error">{error}</div>}

      <div className="source-upload__actions">
        <button
          className="source-upload__save"
          disabled={!canSave}
          onClick={handleSave}
        >
          {phase === "saving" ? "Saving…" : "Save to Aurora →"}
        </button>
        <span className="source-upload__hint">
          Triage-gated · blocking syntax rejected
        </span>
      </div>
    </div>
  );
}