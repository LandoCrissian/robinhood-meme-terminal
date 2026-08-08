import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { vnextShellAvailable } from "../../lib/vnext/vnext-shell-access";
import { VNextTerminalShell } from "./vnext-terminal-shell";

export const metadata: Metadata = {
  title: "RMT Terminal VNext Preview",
  description: "A non-executable design preview of the next RMT trading terminal."
};

export default function VNextPreviewPage() {
  if (!vnextShellAvailable(process.env)) notFound();

  return <VNextTerminalShell />;
}
