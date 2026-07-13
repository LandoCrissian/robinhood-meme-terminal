export type SystemHealthState = "operational" | "degraded";

export type SystemHealthCheck = {
  key: "rpc" | "registry" | "factory" | "economics" | "graduation";
  label: string;
  state: SystemHealthState;
  detail: string;
};

export type SystemHealthReport = {
  ok: boolean;
  network: string;
  chainId: number;
  latestBlock: string;
  checkedAt: string;
  checks: SystemHealthCheck[];
};
