import { Playground } from "@/components/playground/Playground";
import "@/components/playground/playground.css";

export const maxDuration = 60; // triage + Sonnet stream headroom

export const metadata = {
  title: "Playground · Legacy Code Analyzer",
  description:
    "Paste any legacy program — a triage agent detects the language and gates the syntax before deep analysis runs.",
};

export default function PlaygroundPage() {
  return <Playground />;
}
