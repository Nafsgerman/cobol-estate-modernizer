"use client";

// =============================================================================
// EstateGraph — the persistent surface. Loads the estate's call graph from
// Aurora (recursive-CTE cycle detection upstream), renders the React Flow
// canvas, and now lets you GROW the estate: "+ Add program" pastes a COBOL
// program, persists it via saveProgramToEstate, and re-fetches so the new node
// — and any cycle it closes — appears live.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { EstateNode } from "./EstateNode";
import { AnalysisPanel } from "./AnalysisPanel";
import { saveProgramToEstate } from "@/app/actions/estate-write";
import type { ReactFlowGraph, RFNodeData } from "@/lib/graph/reactflow";
import type { AnalysisMode } from "@/lib/ai/core";

const nodeTypes: NodeTypes = { estateNode: EstateNode };

export function EstateGraph({ estateId }: { estateId: string }) {
  const [graph, setGraph] = useState<ReactFlowGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<AnalysisMode>("explain");
  const [adding, setAdding] = useState(false);

  const loadGraph = useCallback(() => {
    setLoading(true);
    return fetch(`/api/estate/${estateId}/graph`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Graph request failed (${r.status})`);
        return r.json() as Promise<ReactFlowGraph>;
      })
      .then((g) => {
        setGraph(g);
        setLoadError(null);
        setLoading(false);
      })
      .catch((e) => {
        setLoadError(String(e.message ?? e));
        setLoading(false);
      });
  }, [estateId]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const nodes = useMemo<Node[]>(
    () =>
      (graph?.nodes ?? []).map((n) => ({
        id: n.id,
        type: "estateNode",
        position: n.position,
        data: n.data,
        selected: n.id === selected,
      })),
    [graph, selected],
  );

  const edges = useMemo<Edge[]>(
    () =>
      (graph?.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        animated: e.animated,
        className: e.data.isCycleEdge ? "edge-cycle" : `edge-${e.data.kind}`,
      })),
    [graph],
  );

  const onNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    setSelected(node.id);
  }, []);

  const selectedData = useMemo<RFNodeData | null>(
    () => graph?.nodes.find((n) => n.id === selected)?.data ?? null,
    [graph, selected],
  );

  if (loading && !graph)
    return <div className="graph-status">Loading estate…</div>;
  if (loadError && !graph)
    return <div className="graph-status graph-status--err">{loadError}</div>;

  const isEmpty = !graph || graph.nodes.length === 0;
  // only programs are analyzable (copybooks have no PROCEDURE DIVISION)
  const analyzable = selectedData?.nodeType === "program";

  return (
    <div className="estate">
      <div className="estate__canvas">
        <div className="estate__hud">
          <span>{graph?.stats.nodes ?? 0} nodes</span>
          <span>{graph?.stats.edges ?? 0} edges</span>
          {graph?.stats.cyclic && (
            <span className="estate__hud-cycle">cycle detected</span>
          )}
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={ADD_BTN}
            title="Paste a COBOL program to add it to this estate"
          >
            + Add program
          </button>
        </div>

        {isEmpty && (
          <div className="graph-status" style={EMPTY_OVERLAY}>
            No programs in this estate yet — use “+ Add program”.
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelected(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              (n.data as RFNodeData)?.inCycle
                ? "var(--cycle)"
                : "var(--edge-muted)"
            }
            maskColor="rgba(8,11,18,0.7)"
          />
        </ReactFlow>
      </div>

      {adding && (
        <AddProgramPanel
          estateId={estateId}
          onClose={() => setAdding(false)}
          onSaved={loadGraph}
        />
      )}

      {!adding && selected && selectedData && analyzable && (
        <AnalysisPanel
          estateId={estateId}
          programId={selected}
          node={selectedData}
          mode={mode}
          onModeChange={setMode}
          onClose={() => setSelected(null)}
        />
      )}
      {!adding && selected && selectedData && !analyzable && (
        <aside className="panel">
          <header className="panel__head">
            <div>
              <div className="panel__eyebrow">COPYBOOK</div>
              <h2 className="panel__title">{selectedData.label}</h2>
            </div>
            <button className="panel__close" onClick={() => setSelected(null)}>
              ✕
            </button>
          </header>
          <div className="panel__body">
            <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
              Copybooks are data definitions and aren&apos;t independently
              analyzed. Select a program node to run analysis.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}

// ── Add-program panel (paste → persist → re-fetch) ──────────────────────
function AddProgramPanel({
  estateId,
  onClose,
  onSaved,
}: {
  estateId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await saveProgramToEstate(estateId, source);
      if (!r.ok) {
        setErr(r.error ?? "Save failed.");
        setBusy(false);
        return;
      }
      setMsg(
        `Saved ${r.programName} · ${r.edgesOut} call${
          r.edgesOut === 1 ? "" : "s"
        } out, ${r.edgesIn} in. Refreshing graph…`,
      );
      onSaved();
      setTimeout(onClose, 900);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
      setBusy(false);
    }
  };

  return (
    <aside className="panel" role="dialog" aria-label="Add program to estate">
      <header className="panel__head">
        <div>
          <div className="panel__eyebrow">ADD PROGRAM</div>
          <h2 className="panel__title">Paste COBOL</h2>
        </div>
        <button className="panel__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="panel__body" style={{ gap: 12, display: "flex", flexDirection: "column" }}>
        <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>
          The program is persisted to Aurora and its <code>CALL</code> edges are
          wired to existing programs — closing a loop lights the cycle ring.
        </p>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          placeholder={"       IDENTIFICATION DIVISION.\n       PROGRAM-ID. MYPROG.\n       ..."}
          style={ADD_TEXTAREA}
        />
        {err && <div style={{ color: "var(--crit)", fontSize: 13 }}>{err}</div>}
        {msg && <div style={{ color: "var(--ok)", fontSize: 13 }}>{msg}</div>}
        <button
          type="button"
          onClick={save}
          disabled={busy || source.trim().length === 0}
          style={{ ...ADD_SAVE, opacity: busy || !source.trim() ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : "Save to estate →"}
        </button>
      </div>
    </aside>
  );
}

const ADD_BTN: React.CSSProperties = {
  marginLeft: "auto",
  padding: "5px 11px",
  background: "var(--surface-2)",
  border: "1px solid var(--line)",
  borderRadius: 7,
  color: "var(--text-dim)",
  cursor: "pointer",
  font: "600 11.5px ui-monospace, monospace",
  letterSpacing: "0.02em",
};
const EMPTY_OVERLAY: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2,
};
const ADD_TEXTAREA: React.CSSProperties = {
  width: "100%",
  minHeight: 300,
  resize: "vertical",
  padding: 14,
  background: "var(--surface-2)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  color: "var(--text)",
  font: "12.5px/1.6 ui-monospace, monospace",
  outline: "none",
};
const ADD_SAVE: React.CSSProperties = {
  padding: "11px 16px",
  background: "var(--info, #7dd3fc)",
  color: "#06121f",
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  font: "700 13px ui-monospace, monospace",
};
