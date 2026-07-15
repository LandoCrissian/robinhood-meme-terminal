import type { LaunchFeedItem } from "./launch-feed";

export type CreatorExposureTone = "unknown" | "tracked" | "notable" | "high";

function creatorPercent(bps: number) {
  if (bps === 0) return "0%";
  if (bps < 10) return "<0.1%";
  return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function creatorFlowSuffix(flow: LaunchFeedItem["creatorFlow"]) {
  if (flow === "buying") return " · net buying";
  if (flow === "selling") return " · net selling";
  return "";
}

export function describeCreatorExposure(launch: LaunchFeedItem) {
  const bps = launch.creatorOutsideCurveBps;
  if (bps === undefined) {
    return { tone: "unknown" as const, label: "Creator position syncing" };
  }
  const tone: CreatorExposureTone = bps >= 2_500 ? "high" : bps >= 1_000 ? "notable" : "tracked";
  return {
    tone,
    label: tone === "high"
      ? `High creator · ${creatorPercent(bps)} outside curve${creatorFlowSuffix(launch.creatorFlow)}`
      : `Creator ${creatorPercent(bps)} outside curve${creatorFlowSuffix(launch.creatorFlow)}`
  };
}
