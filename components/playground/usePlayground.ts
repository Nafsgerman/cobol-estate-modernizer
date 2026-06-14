"use client";

// =============================================================================
// usePlayground — client state machine for the paste-and-analyze flow.
// Gate logic: a blocking triage verdict disables the modes until the source is
// edited (verdict goes stale the moment the code changes) OR the user clicks
// "Analyze anyway" (force). The verdict is cached per source, so switching modes
// on unchanged code reuses it instead of re-running triage — which keeps the
// gate stable (no flip between modes) and avoids a second Haiku call.
// =============================================================================
import { useCallback, useRef, useState } from "react";
import { readStreamableValue } from "ai/rsc";
import {
  analyzeSource,
  fixSource,
  type PlaygroundEvent,
} from "@/app/actions/playground";
import type { AnalysisMode, UsageCost } from "@/lib/ai/core";
import type { TriageResult } from "@/lib/ai/triage";

export type Phase =
  | "idle"        // nothing run yet, or source edited since last verdict
  | "triaging"    // Haiku gate running
  | "blocked"     // blocking verdict: modes disabled, Fix / Analyze-anyway offered
  | "analyzing"   // Sonnet streaming
  | "fixing"      // repair pass streaming
  | "done"
  | "error";

export interface PlaygroundState {
  phase: Phase;
  triage: TriageResult | null;
  liveText: string;
  result: unknown | null;
  resultMode: AnalysisMode | null;
  usage: UsageCost | null;
  fixNotes: string[];
  error: string | null;
}

const INITIAL: PlaygroundState = {
  phase: "idle",
  triage: null,
  liveText: "",
  result: null,
  resultMode: null,
  usage: null,
  fixNotes: [],
  error: null,
};

export function usePlayground(onFixedCode: (code: string) => void) {
  const [state, setState] = useState<PlaygroundState>(INITIAL);
  const runToken = useRef(0);
  // Cached verdict for the exact source it was computed on.
  const triagedRef = useRef<{ source: string; result: TriageResult } | null>(null);
  // Last mode the user attempted — drives "Analyze anyway".
  const lastModeRef = useRef<AnalysisMode>("explain");

  /** Source changed → any previous verdict is stale; re-arm the modes. */
  const sourceEdited = useCallback(() => {
    runToken.current++;
    triagedRef.current = null;
    setState(INITIAL);
  }, []);

  const analyze = useCallback(
    async (source: string, mode: AnalysisMode, opts?: { force?: boolean }) => {
      const force = opts?.force ?? false;
      lastModeRef.current = mode;
      // Reuse the cached verdict only if it was computed on this exact source.
      const cachedTriage =
        triagedRef.current && triagedRef.current.source === source
          ? triagedRef.current.result
          : null;

      const mine = ++runToken.current;
      setState({ ...INITIAL, phase: "triaging" });
      try {
        const { stream } = await analyzeSource(source, mode, {
          cachedTriage,
          force,
        });
        for await (const ev of readStreamableValue(stream)) {
          if (mine !== runToken.current || !ev) continue;
          if (ev.type === "triage") {
            triagedRef.current = { source, result: ev.result };
          }
          applyEvent(setState, ev, { force });
        }
      } catch (err) {
        if (mine !== runToken.current) return;
        setState((s) => ({
          ...s,
          phase: "error",
          error: err instanceof Error ? err.message : "Analysis failed.",
        }));
      }
    },
    [],
  );

  /** Override the gate: run the last-attempted mode despite a blocking verdict. */
  const analyzeAnyway = useCallback(
    (source: string) => analyze(source, lastModeRef.current, { force: true }),
    [analyze],
  );

  const fix = useCallback(
    async (source: string) => {
      const issues =
        state.triage?.issues.map(({ line, message, hint }) => ({
          line,
          message,
          hint,
        })) ?? [];
      const mine = ++runToken.current;
      setState((s) => ({ ...s, phase: "fixing", liveText: "", error: null }));
      try {
        const { stream } = await fixSource(source, issues);
        for await (const ev of readStreamableValue(stream)) {
          if (mine !== runToken.current || !ev) continue;
          if (ev.type === "fixed") {
            triagedRef.current = null; // fixed code is new source → fresh verdict
            onFixedCode(ev.code);
            setState((s) => ({
              ...s,
              phase: "idle", // fixed code is new source → fresh slate
              triage: null,
              liveText: "",
              fixNotes: ev.notes,
            }));
          } else {
            applyEvent(setState, ev);
          }
        }
      } catch (err) {
        if (mine !== runToken.current) return;
        setState((s) => ({
          ...s,
          phase: "error",
          error: err instanceof Error ? err.message : "Fix failed.",
        }));
      }
    },
    [state.triage, onFixedCode],
  );

  return { state, analyze, analyzeAnyway, fix, sourceEdited };
}

function applyEvent(
  setState: React.Dispatch<React.SetStateAction<PlaygroundState>>,
  ev: PlaygroundEvent,
  opts?: { force?: boolean },
): void {
  switch (ev.type) {
    case "triage_start":
      setState((s) => ({ ...s, phase: "triaging" }));
      break;
    case "triage":
      setState((s) => ({
        ...s,
        triage: ev.result,
        // Forced runs never gate, even on a blocking verdict.
        phase:
          ev.result.verdict === "blocking" && !opts?.force ? "blocked" : s.phase,
      }));
      break;
    case "analyzing":
      setState((s) =>
        s.phase === "fixing" ? s : { ...s, phase: "analyzing", liveText: "" },
      );
      break;
    case "delta":
      setState((s) => ({ ...s, liveText: s.liveText + ev.text }));
      break;
    case "done":
      setState((s) => ({
        ...s,
        phase: "done",
        result: ev.result,
        resultMode: ev.mode,
        usage: ev.usage,
      }));
      break;
    case "error":
      setState((s) => ({ ...s, phase: "error", error: ev.message }));
      break;
    case "fixed":
      // handled inline in fix(); no-op here
      break;
  }
}
