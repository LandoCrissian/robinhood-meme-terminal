import { isHash, type Hash, type PublicClient } from "viem";

export type LaunchpadObservedBlock = { blockNumber: bigint; hash: Hash; timestamp: bigint };

export function canonicalLaunchpadBlock(block: LaunchpadObservedBlock): { blockHash: Hash; requireCanonical: true } {
  return { blockHash: block.hash, requireCanonical: true };
}

export async function readLaunchpadBlock(rpc: PublicClient, blockNumber: bigint, observedHead: bigint): Promise<LaunchpadObservedBlock> {
  if (blockNumber < 0n || blockNumber > observedHead) throw new Error("Launch RPC is behind the requested observation");
  const block = await rpc.getBlock({ blockNumber, includeTransactions: false });
  if (block.number !== blockNumber || !block.hash || !isHash(block.hash)
    || typeof block.timestamp !== "bigint" || block.timestamp < 0n) {
    throw new Error("Canonical launch block unavailable");
  }
  return { blockNumber, hash: block.hash, timestamp: block.timestamp };
}

export function launchpadFinalityEvidence(block?: LaunchpadObservedBlock) {
  return {
    finality: block ? "local_chain_observed" as const : "unavailable" as const,
    l2Observation: block
      ? { status: "observed" as const, blockNumber: block.blockNumber.toString(), blockHash: block.hash }
      : { status: "unavailable" as const, blockNumber: null, blockHash: null },
    // Neither an L2 block tag nor a local checkpoint proves Ethereum inclusion or finality.
    l1Finality: { status: "unverified" as const, reason: "independent_l1_verifier_unconfigured" as const },
  };
}
