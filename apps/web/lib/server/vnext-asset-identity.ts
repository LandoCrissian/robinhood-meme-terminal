import type { Address } from "viem";
import {
  createVNextExecutionIdentityAuthority,
  type VNextExecutionIdentityReadOptions
} from "./vnext-execution-identity-authority";

export {
  createVNextExecutionIdentityAuthority,
  VNextExecutionIdentityConflictError,
  vNextExecutionIdentityErrorResponse,
  type VNextExecutionIdentityReadOptions,
  type VNextExecutionIdentityDependencies,
  type VNextTrustedAssetIdentity,
  type VNextIdentityConflict
} from "./vnext-execution-identity-authority";
export type { VNextTrustedAssetIdentity as VNextVerifiedAssetIdentity } from "./vnext-execution-identity-authority";

// One read-only authority per process. Persistence remains owned by the indexer.
const executionIdentityAuthority = createVNextExecutionIdentityAuthority({
  readLive: async (address) => {
    const { readRobinhoodTokenIdentityEvidence } = await import("./universal-market-resolver");
    return readRobinhoodTokenIdentityEvidence(address);
  }
});

/** Pass { scheduleRevalidation: task => after(task) } from a request lifecycle. */
export function readVNextVerifiedAssetIdentity(
  address: Address,
  options: VNextExecutionIdentityReadOptions = {}
) {
  return executionIdentityAuthority.read(address, options);
}

// Only positive, independently observed contract/decimals evidence belongs here.
export const blockVNextExecutionIdentityOnPositiveConflict = executionIdentityAuthority.blockOnPositiveConflict;
