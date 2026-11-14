import type { HistoricalLaunch } from "../../lib/launch-data";

export const robinhoodExplorer = "https://robinhoodchain.blockscout.com";

export const launchLifecycleLabel: Record<HistoricalLaunch["lifecycle"], string> = {
  curve: "Bonding curve",
  graduated: "Graduated",
  unknown: "Unknown",
};

export const launchClassificationLabel: Record<HistoricalLaunch["classification"], string> = {
  historical: "Historical RMT",
  retired: "Retired RMT",
  "deployment-test": "RMT deployment test",
};
