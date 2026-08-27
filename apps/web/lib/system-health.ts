export type SystemHealthState = "operational" | "degraded";

export type SystemHealthCheck = {
  key: "rpc" | "curated-registry" | "curated-markets";
  label: string;
  state: SystemHealthState;
  detail: string;
};

export type TerminalHealthEvidence = {
  curatedRegistryReady: boolean;
  curatedMarketsVerified: boolean;
  curatedMarketCount: number;
  historicalMarketIndexerRequired: false;
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
