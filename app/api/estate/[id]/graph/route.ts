import { NextResponse } from 'next/server'

type GraphNode = {
  id: string
}

type GraphEdge = {
  source: string
  target: string
}

type GraphResponse = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // The `id` will be used to load a specific estate's dependency graph later.
  await params

  const data: GraphResponse = {
    nodes: [],
    edges: [],
  }

  return NextResponse.json(data)
}
