import { EstateGraph } from "@/components/graph/EstateGraph";
import "@/components/graph/estate.css";

export const metadata = {
  title: "Estate · COBOL Modernizer",
  description: "Dependency graph and AI analysis for a COBOL estate.",
};

export default async function EstatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main style={{ width: "100vw", height: "100vh" }}>
      <EstateGraph estateId={id} />
    </main>
  );
}
