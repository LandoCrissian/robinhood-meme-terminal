export type SystemHealthState = "operational" | "degraded";

export type SystemHealthCheck = {
  key: "rpc" | "market-indexer" | "canonical-inventory";
  label: string;
  state: SystemHealthState;
  detail: string;
};

export type TerminalInventoryStatus = "ready" | "partial" | "unavailable";
export type TerminalCanonicalCoverage = "complete" | "partial" | "unavailable";

export type TerminalHealthEvidence = {
  canonicalBrowseEnabled: boolean;
  marketIndexerConfigured: boolean;
  inventoryStatus: TerminalInventoryStatus;
  canonicalCoverage: TerminalCanonicalCoverage;
};

export type SystemHealthReport = {
  schemaVersion: 2;
  product: "rmt-terminal";
  ok: boolean;
  network: string;
  chainId: number;
  latestBlock: string;
  blockAgeSeconds: number | null;
  latencyMs: number;
  checkedAt: string;
  terminalEvidence: TerminalHealthEvidence;
  checks: SystemHealthCheck[];
};
