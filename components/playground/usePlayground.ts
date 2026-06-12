"use client";

// =============================================================================
// usePlayground — client state machine for the paste-and-analyze flow.
// Gate logic lives here: a blocking triage verdict disables the modes until
// the source is edited (verdict goes stale the moment the code changes).
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
  | "blocked"     // blocking verdict: modes disabled, Fix offered
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

  /** Source changed → any previous verdict is stale; re-arm the modes. */
  const sourceEdited = useCallback(() => {
    runToken.current++;
    setState(INITIAL);
  }, []);

  const analyze = useCallback(async (source: string, mode: AnalysisMode) => {
    const mine = ++runToken.current;
    setState({ ...INITIAL, phase: "triaging" });
    try {
      const { stream } = await analyzeSource(source, mode);
      for await (const ev of readStreamableValue(stream)) {
        if (mine !== runToken.current || !ev) continue;
        applyEvent(setState, ev);
      }
    } catch (err) {
      if (mine !== runToken.current) return;
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Analysis failed.",
      }));
    }
  }, []);

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

  return { state, analyze, fix, sourceEdited };
}

function applyEvent(
  setState: React.Dispatch<React.SetStateAction<PlaygroundState>>,
  ev: PlaygroundEvent,
): void {
  switch (ev.type) {
    case "triage_start":
      setState((s) => ({ ...s, phase: "triaging" }));
      break;
    case "triage":
      setState((s) => ({
        ...s,
        triage: ev.result,
        phase: ev.result.verdict === "blocking" ? "blocked" : s.phase,
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
