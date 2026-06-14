// app/api/estate/[id]/graph/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  loadEstateGraph,
  callChainDownstream,
  type CallChainRow,
} from "@/lib/db/lineage";
import { toReactFlow, cycleNodesFromChains } from "@/lib/graph/reactflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: estateId } = await params;

  try {
    const graph = await loadEstateGraph(db, estateId);

    const programIds = graph.nodes
      .filter((n) => n.type === "program")
      .map((n) => n.id);

    const chains: CallChainRow[][] = await Promise.all(
      programIds.map((pid) => callChainDownstream(db, estateId, pid)),
    );
    const cycleNodes = cycleNodesFromChains(chains);

    const rf = toReactFlow(graph, cycleNodes);
    return NextResponse.json(rf, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[/api/estate/${estateId}/graph] failed:`, err);
    return NextResponse.json(
      { error: "Failed to load estate graph." },
      { status: 500 },
    );
  }
}
