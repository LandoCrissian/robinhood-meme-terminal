import { getAddress, isAddress } from "viem";

export const VNEXT_LEGACY_ROUTE_DEPENDENCIES = {
  assetWorkspace: {
    routePattern: "/market/[address]",
    retirementGate: "VNext asset workspace completion",
  },
} as const;

/**
 * Temporary compatibility boundary for the production-grade legacy market workspace.
 * Keep this route construction centralized until VNext owns the complete asset workspace.
 */
export function legacyAssetWorkspaceHref(address: string) {
  if (!isAddress(address, { strict: false })) {
    throw new Error("A valid market address is required for the compatibility workspace.");
  }
  return `/market/${getAddress(address)}`;
}
