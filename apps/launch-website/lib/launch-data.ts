export const robinhoodChainId = 4663;
export const launchDirectoryLimit = 25;

export function isLaunchAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
}

export type LaunchBlock = {
  blockNumber: string;
  blockHash: string;
  timestamp: string;
};

export type LaunchReceipt = LaunchBlock & {
  transactionHash: string;
  logIndex: number;
};

export type HistoricalLaunch = {
  kind: "historical-rmt";
  classification: "historical" | "retired" | "deployment-test";
  version: 4 | 6;
  token: string;
  factory: string;
  launchId: string;
  name: string;
  symbol: string;
  creator: string | null;
  market: string;
  receipt: LaunchReceipt;
  lifecycle: "curve" | "graduated" | "unknown";
  lifecycleAt: LaunchBlock | LaunchReceipt | null;
  reservedPoolId: string | null;
};

export type LaunchDirectoryData = {
  chainId: typeof robinhoodChainId;
  status: "ready" | "stale" | "unavailable";
  future: "prelaunch";
  finality: "l1-unverified";
  coverage: "verified-snapshot" | "v6-indexed";
  observedAt: string | null;
  checkpoint: LaunchBlock | null;
  launches: HistoricalLaunch[];
  truncated: boolean;
};
