"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { RFNodeData } from "@/lib/graph/reactflow";

// Estate node. Program vs copybook differ by accent; cycle membership gets the
// amber breathing ring — the one loud signal, because a circular CALL chain is
// what blocks a clean migration.

function EstateNodeBase({ data, selected }: NodeProps & { data: RFNodeData }) {
  const isProgram = data.nodeType === "program";
  return (
    <div
      className="estate-node"
      data-cycle={data.inCycle || undefined}
      data-selected={selected || undefined}
      data-kind={data.nodeType}
    >
      <Handle type="target" position={Position.Left} className="rf-handle" />
      <div className="estate-node__head">
        <span className="estate-node__tag">{isProgram ? "PROG" : "COPY"}</span>
        <span className="estate-node__name">{data.label}</span>
        {data.inCycle && <span className="estate-node__cycle">CYCLE</span>}
      </div>
      <div className="estate-node__meta">
        <span className="estate-node__deg" title="callers in / callees out">
          <span className="in">↘ {data.inDegree}</span>
          <span className="out">{data.outDegree} ↗</span>
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="rf-handle" />
    </div>
  );
}

export const EstateNode = memo(EstateNodeBase);
