import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readVNextReleaseReadiness } from "../../lib/vnext/release-readiness";
import { VNextTerminalShell } from "./vnext-terminal-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Robinhood Meme Terminal | RMT",
  description: "Scan Robinhood Chain markets, manage wallet-held balances, and prepare independently verified trades from one terminal.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: "Robinhood Meme Terminal | RMT",
    description: "Scan Robinhood Chain markets, manage wallet-held balances, and prepare independently verified trades from one terminal.",
    url: "/",
    images: ["/brand/rmt-master-logo.png"]
  },
  twitter: {
    card: "summary",
    title: "Robinhood Meme Terminal | RMT",
    description: "Scan Robinhood Chain markets, manage wallet-held balances, and prepare independently verified trades from one terminal.",
    images: ["/brand/rmt-master-logo.png"]
  }
};

export default function VNextProductionPage() {
  const readiness = readVNextReleaseReadiness(process.env);
  if (!readiness.shellEnabled || !readiness.configurationConsistent) notFound();

  return <VNextTerminalShell />;
}
