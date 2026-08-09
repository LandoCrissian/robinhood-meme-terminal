import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readVNextReleaseReadiness } from "../../lib/vnext/release-readiness";
import { VNextTerminalShell } from "./vnext-terminal-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RMT Terminal VNext",
  description: "RMT's Robinhood Chain trading terminal with wallet-held spend balance and verified execution.",
  robots: {
    index: false,
    follow: false
  }
};

export default function VNextPreviewPage() {
  const readiness = readVNextReleaseReadiness(process.env);
  if (!readiness.shellEnabled || !readiness.configurationConsistent) notFound();

  return <VNextTerminalShell />;
}
