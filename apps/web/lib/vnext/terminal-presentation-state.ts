import type { VNextDetectedWalletAsset } from "./wallet-assets";

export type VNextWalletReadStatus = "idle" | "loading" | "ready" | "stale" | "error";

export type VNextWalletReadSnapshot = {
  walletAddress: string | null;
  walletKey: string | null;
  assets: VNextDetectedWalletAsset[];
  nativeBalance?: bigint;
  status: VNextWalletReadStatus;
};

export function heldCountIsIndeterminate(status: VNextWalletReadStatus) {
  return status === "idle" || status === "loading" || status === "error";
}

export function heldCountLabel(status: VNextWalletReadStatus, confirmedCount: number): number | "…" {
  return heldCountIsIndeterminate(status) ? "…" : confirmedCount;
}

export type VNextCapitalFlowCardStatus = "loading" | "ready" | "partial" | "unavailable" | "error";

export function capitalFlowStatusLabel(status: VNextCapitalFlowCardStatus) {
  if (status === "loading") return "CHECKING";
  if (status === "ready") return "LIVE";
  if (status === "partial") return "PARTIAL DATA";
  return "DATA UNAVAILABLE";
}
