"use client";

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
import type { ReactFlowGraph, RFNodeData } from "@/lib/graph/reactflow";
import type { AnalysisMode } from "@/lib/ai/core";

const nodeTypes: NodeTypes = { estateNode: EstateNode };

export function EstateGraph({ estateId }: { estateId: string }) {
  const [graph, setGraph] = useState<ReactFlowGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<AnalysisMode>("explain");

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/estate/${estateId}/graph`)
      .then((r) => {
        if (!r.ok) throw new Error(`Graph request failed (${r.status})`);
        return r.json() as Promise<ReactFlowGraph>;
      })
      .then((g) => live && (setGraph(g), setLoading(false)))
      .catch((e) => live && (setLoadError(String(e.message ?? e)), setLoading(false)));
    return () => {
      live = false;
    };
  }, [estateId]);

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

  if (loading) return <div className="graph-status">Loading estate…</div>;
  if (loadError)
    return <div className="graph-status graph-status--err">{loadError}</div>;
  if (!graph || graph.nodes.length === 0)
    return <div className="graph-status">No programs in this estate yet.</div>;

  // only programs are analyzable (copybooks have no PROCEDURE DIVISION)
  const analyzable = selectedData?.nodeType === "program";

  return (
    <div className="estate">
      <div className="estate__canvas">
        <div className="estate__hud">
          <span>{graph.stats.nodes} nodes</span>
          <span>{graph.stats.edges} edges</span>
          {graph.stats.cyclic && (
            <span className="estate__hud-cycle">cycle detected</span>
          )}
        </div>
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
              (n.data as RFNodeData)?.inCycle ? "var(--cycle)" : "var(--edge-muted)"
            }
            maskColor="rgba(8,11,18,0.7)"
          />
        </ReactFlow>
      </div>

      {selected && selectedData && analyzable && (
        <AnalysisPanel
          estateId={estateId}
          programId={selected}
          node={selectedData}
          mode={mode}
          onModeChange={setMode}
          onClose={() => setSelected(null)}
        />
      )}
      {selected && selectedData && !analyzable && (
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
