import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VNextTerminalShell } from "./vnext-terminal-shell";

export const metadata: Metadata = {
  title: "RMT Terminal VNext Preview",
  description: "A non-executable design preview of the next RMT trading terminal."
};

export default function VNextPreviewPage() {
  const explicitlyEnabled = process.env.NEXT_PUBLIC_RMT_VNEXT_SHELL_ENABLED === "true";
  if (process.env.VERCEL_ENV === "production" && !explicitlyEnabled) notFound();

  return <VNextTerminalShell />;
}
