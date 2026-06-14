// =============================================================================
// app/api/estate/[id]/graph/route.ts
// Loads one estate's graph via the proven lineage loaders, derives cycle nodes
// from the recursive CTE, returns a dagre-laid-out React Flow payload.
// =============================================================================
import { NextResponse } from "next/server";
import { db, warmDb } from "@/lib/db";
import {
  loadEstateGraph,
  callChainDownstream,
  type CallChainRow,
} from "@/lib/db/lineage";
import { toReactFlow, cycleNodesFromChains } from "@/lib/graph/reactflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // pg + dagre need Node

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: estateId } = await params;

  try {
    // Resume a cold Aurora instance on one connection before the parallel
    // chain-query burst below, so concurrent connects don't race a paused DB.
    await warmDb();

    const graph = await loadEstateGraph(db, estateId);

    // Cycle source of truth = the CTE. Run the cycle-flagged chain from each
    // program node and union the is_cycle hits. Cheap at H0 scale.
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
