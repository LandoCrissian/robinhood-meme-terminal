import "./vnext/vnext-terminal.css";
import { notFound } from "next/navigation";
import { vNextProductionShellReady } from "../lib/vnext/release-readiness";
import { VNextTerminalShell } from "./vnext/vnext-terminal-shell";

export const dynamic = "force-dynamic";
export { metadata } from "./vnext/page";

export default function Home() {
  if (!vNextProductionShellReady(process.env)) notFound();
  return <VNextTerminalShell />;
}
