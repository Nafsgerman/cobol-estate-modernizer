"use client";

import { useCallback, useRef, useState } from "react";
import { readStreamableValue } from "ai/rsc";
import { analyzeProgram, type StreamEvent } from "@/app/actions/analyze";
import type { AnalysisMode, UsageCost } from "@/lib/ai/core";
import type { SyntaxIssue } from "@/lib/cobol/syntax";

export interface AnalysisState {
  status: "idle" | "streaming" | "done" | "error";
  runId: string | null;
  liveText: string;
  syntax: SyntaxIssue[];
  result: unknown | null;
  usage: UsageCost | null;
  error: string | null;
}

const INITIAL: AnalysisState = {
  status: "idle",
  runId: null,
  liveText: "",
  syntax: [],
  result: null,
  usage: null,
  error: null,
};

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL);
  const runToken = useRef(0);

  const run = useCallback(
    async (estateId: string, programId: string, mode: AnalysisMode) => {
      const mine = ++runToken.current;
      setState({ ...INITIAL, status: "streaming" });
      try {
        const { stream } = await analyzeProgram(estateId, programId, mode);
        for await (const ev of readStreamableValue(stream)) {
          if (mine !== runToken.current || !ev) continue;
          apply(setState, ev);
        }
      } catch (err) {
        if (mine !== runToken.current) return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "Analysis failed.",
        }));
      }
    },
    [],
  );

  const reset = useCallback(() => {
    runToken.current++;
    setState(INITIAL);
  }, []);

  return { state, run, reset };
}

function apply(
  setState: React.Dispatch<React.SetStateAction<AnalysisState>>,
  ev: StreamEvent,
): void {
  switch (ev.type) {
    case "run":
      setState((s) => ({ ...s, runId: ev.runId }));
      break;
    case "syntax":
      setState((s) => ({ ...s, syntax: ev.issues }));
      break;
    case "delta":
      setState((s) => ({ ...s, liveText: s.liveText + ev.text }));
      break;
    case "done":
      setState((s) => ({
        ...s,
        status: "done",
        runId: ev.runId,
        result: ev.result,
        usage: ev.usage,
      }));
      break;
    case "error":
      setState((s) => ({ ...s, status: "error", error: ev.message }));
      break;
  }
}
