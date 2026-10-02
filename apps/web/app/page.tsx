import "./vnext/vnext-terminal.css";
import { notFound } from "next/navigation";
import { vNextProductionShellReady } from "../lib/vnext/release-readiness";
import { VNextTerminalShell } from "./vnext/vnext-terminal-shell";
import { parseVNextTerminalLocation } from "../lib/vnext/terminal-location";
import { projectTokenTerminalEntry } from "../lib/vnext/terminal-entry";
import { readLaunchIntelligence } from "../lib/server/launch-intelligence-reader";
import { launchTerminalEntry } from "../lib/vnext/launch-presentation";

export const dynamic = "force-dynamic";
export { metadata } from "./vnext/page";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!vNextProductionShellReady(process.env)) notFound();
  const parameters = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === "string") query.set(key, value);
  }
  const initialLocation = parseVNextTerminalLocation(query.toString());
  let initialMarket = projectTokenTerminalEntry(initialLocation, query.get("project") ?? undefined);
  if (initialLocation.context === "asset" && query.has("launch")) {
    const launches = await readLaunchIntelligence({token:initialLocation.market,limit:50},{timeoutMs:500});
    const launch=launches.entries.find(entry=>entry.launchId===query.get("launch"));
    initialMarket ??= launchTerminalEntry(initialLocation,launch);
  }
  return <VNextTerminalShell initialLocation={initialLocation} initialMarket={initialMarket} />;
}
