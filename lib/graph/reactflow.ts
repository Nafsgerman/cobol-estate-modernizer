// =============================================================================
// lib/graph/reactflow.ts — transform the estate graph loaders' output into a
// React Flow payload, laid out with dagre server-side. Cycle detection comes
// from the recursive CTE (callChainDownstream's is_cycle), NOT re-derived here.
// =============================================================================
import dagre from "@dagrejs/dagre";
import type { GraphNode, GraphEdge, CallChainRow } from "@/lib/db/lineage";

export interface RFNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string; // 'program' | 'copybook'
  inDegree: number;
  outDegree: number;
  inCycle: boolean;
}

export interface RFNode {
  id: string;
  type: "estateNode";
  position: { x: number; y: number };
  data: RFNodeData;
  width: number;
  height: number;
}

export interface RFEdge {
  id: string;
  source: string;
  target: string;
  type: "smoothstep";
  animated: boolean;
  data: { kind: string; isCycleEdge: boolean };
}

export interface ReactFlowGraph {
  nodes: RFNode[];
  edges: RFEdge[];
  stats: { nodes: number; edges: number; cyclic: boolean };
}

const BASE_W = 200;
const BASE_H = 60;

function sizeFor(inDeg: number, outDeg: number) {
  const scale = Math.min(1.6, 1 + (inDeg + outDeg) * 0.08);
  return { w: Math.round(BASE_W * scale), h: Math.round(BASE_H * scale) };
}

/**
 * @param graph     output of loadEstateGraph(db, estateId)
 * @param cycleNodeIds program ids the CTE flagged is_cycle (optional; when
 *                     provided, those nodes + their mutual edges are styled as
 *                     the cycle). Pass the union of is_cycle rows across roots,
 *                     or leave empty to skip cycle styling.
 */
export function toReactFlow(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  cycleNodeIds: Set<string> = new Set(),
): ReactFlowGraph {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    outDegree.set(n.id, 0);
  }
  for (const e of graph.edges) {
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 90, nodesep: 48, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, { w: number; h: number }>();
  for (const n of graph.nodes) {
    const s = sizeFor(inDegree.get(n.id) ?? 0, outDegree.get(n.id) ?? 0);
    sizes.set(n.id, s);
    g.setNode(n.id, { width: s.w, height: s.h });
  }

  // A 'call' edge whose endpoints are both in a cycle is a cycle edge; exclude
  // it from dagre ranking so the A↔B loop doesn't break layering.
  const isCycleEdge = (e: GraphEdge) =>
    cycleNodeIds.has(e.source) && cycleNodeIds.has(e.target);

  for (const e of graph.edges) {
    if (!isCycleEdge(e)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const nodes: RFNode[] = graph.nodes.map((n) => {
    const pos = g.node(n.id);
    const s = sizes.get(n.id)!;
    return {
      id: n.id,
      type: "estateNode",
      position: { x: (pos?.x ?? 0) - s.w / 2, y: (pos?.y ?? 0) - s.h / 2 },
      width: s.w,
      height: s.h,
      data: {
        label: n.label,
        nodeType: n.type,
        inDegree: inDegree.get(n.id) ?? 0,
        outDegree: outDegree.get(n.id) ?? 0,
        inCycle: cycleNodeIds.has(n.id),
      },
    };
  });

  const edges: RFEdge[] = graph.edges.map((e, i) => {
    const cyc = isCycleEdge(e);
    return {
      id: `${e.source}->${e.target}:${e.kind}:${i}`,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: cyc,
      data: { kind: e.kind, isCycleEdge: cyc },
    };
  });

  return {
    nodes,
    edges,
    stats: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      cyclic: cycleNodeIds.size > 0,
    },
  };
}

/**
 * Derive the set of cycle node-ids for an estate by running the cycle-flagged
 * downstream chain from every program and collecting is_cycle hits. Cheap on
 * H0-scale estates; the CTE is the single source of truth for cycles.
 */
export function cycleNodesFromChains(chains: CallChainRow[][]): Set<string> {
  const ids = new Set<string>();
  for (const chain of chains) {
    for (const row of chain) {
      if (row.is_cycle) {
        // the cycling node and its predecessor in the path both belong to it
        ids.add(row.program_id);
        const prev = row.path[row.path.length - 2];
        if (prev) ids.add(prev);
      }
    }
  }
  return ids;
}
