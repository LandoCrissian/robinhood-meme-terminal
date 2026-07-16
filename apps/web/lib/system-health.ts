export type SystemHealthState = "operational" | "degraded";

export type SystemHealthCheck = {
  key: "rpc" | "registry" | "factory" | "economics" | "trading" | "graduation";
  label: string;
  state: SystemHealthState;
  detail: string;
};

export type SystemHealthReleaseEvidence = {
  mode: "testnet" | "configuration-error" | "v6-cutover";
  registryAddress: string | null;
  factoryAddress: string | null;
  factoryVersion: string | null;
  factoryStartBlock: string;
  registryConfiguredExplicitly: boolean;
  registryConfigurationValid: boolean;
  factoryStartBlockConfiguredExplicitly: boolean;
  factoryStartBlockConfigurationValid: boolean;
};

export type SystemHealthReport = {
  ok: boolean;
  network: string;
  chainId: number;
  latestBlock: string;
  blockAgeSeconds: number | null;
  latencyMs: number;
  checkedAt: string;
  releaseEvidence: SystemHealthReleaseEvidence;
  checks: SystemHealthCheck[];
};
