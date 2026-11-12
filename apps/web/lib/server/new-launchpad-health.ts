import { parseAbi, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { launchFeeLedgerAbi, type LaunchHealth, type NewLaunchRecord } from "../launchpad/launch-record";
import { readLaunchHolderTrend } from "./new-launchpad-holders";
import { readLaunchFeePolicy, sameHex, sameLaunchFeePolicy } from "./new-launchpad-receipt";

const activeLiquidityAbi = parseAbi(["function getLiquidity(bytes32 poolId) view returns (uint128)"]);

type ObservedBlock = { blockNumber: bigint; hash: Hash; timestamp: bigint };
type ObservedPosition = { positionOwner: Address; positionLiquidity: string; activeLiquidity: string };

export function makeLaunchHealth(launch: NewLaunchRecord, position?: ObservedPosition): LaunchHealth {
  const custody = position
    ? (sameHex(position.positionOwner, launch.factory) && position.positionLiquidity === launch.liquidity ? "verified" : "failed")
    : "unknown";
  const legacyPolicy = {
    creator: launch.creator, treasury: zeroAddress, reserve: zeroAddress,
    creatorBps: 10_000, treasuryBps: 0, reserveBps: 0,
  };
  return {
    liquidity: {
      initialNativeWei: launch.amount0, initialTokenBaseUnits: launch.amount1, positionTokenId: launch.positionTokenId,
      initialPositionLiquidity: launch.liquidity, currentPositionLiquidity: position?.positionLiquidity ?? null,
      activePoolLiquidity: position?.activeLiquidity ?? null, custody: { owner: position?.positionOwner ?? null, status: custody },
    },
    creator: {
      initialTokenAllocation: (BigInt(launch.totalSupply) - BigInt(launch.amount1)).toString(),
      vesting: position ? "none" : "unknown",
    },
    permissions: {
      status: position ? "verified" : "unknown",
      initializationGuard: position && launch.engineVersion === 2 ? launch.poolKey.hooks : null,
      factoryAdmin: position ? false : null, tokenMintAuthority: position ? false : null,
      principalWithdrawal: position ? false : null, feePolicyMutable: position ? false : null,
    },
    fees: {
      status: position && launch.engineVersion !== 2 ? "legacy" : "unknown",
      policy: launch.engineVersion === 2 ? launch.feePolicy ?? null : legacyPolicy, buckets: null, totals: null,
    },
    trends: {
      liquidity: { status: "unknown", reason: "Two comparable canonical active-liquidity observations are unavailable." },
      holders: { status: "unknown", reason: "Complete holder inventories at comparable blocks are unavailable." },
    },
  };
}

async function observedFees(rpc: PublicClient, launch: NewLaunchRecord, blockNumber: bigint): Promise<LaunchHealth["fees"]> {
  const commitment = launch.feePolicy;
  if (!commitment) throw new Error("Canonical fee commitment unavailable");
  const feeCall = { address: launch.factory, abi: launchFeeLedgerAbi, blockNumber };
  const [policy, totals, ...buckets] = await Promise.all([
    readLaunchFeePolicy(rpc, launch.factory, launch.token, blockNumber),
    rpc.readContract({ ...feeCall, functionName: "feeTotals", args: [launch.token] }),
    ...([0, 1, 2] as const).map((bucket) =>
      rpc.readContract({ ...feeCall, functionName: "feeBucket", args: [launch.token, bucket] })),
  ] as const);
  if (!sameLaunchFeePolicy(commitment, policy)) throw new Error("Current fee policy differs from the canonical commitment");

  const [nativeAccrued, tokenAccrued, nativeRoundingDust, tokenRoundingDust] = totals;
  const recipients = [policy.creator, policy.treasury, policy.reserve] as const;
  const allocations = [policy.creatorBps, policy.treasuryBps, policy.reserveBps] as const;
  let nativeAllocated = 0n;
  let tokenAllocated = 0n;
  const verifiedBuckets = ([0, 1, 2] as const).map((bucket) => {
    const [recipient, nativeClaimable, tokenClaimable, nativeDistributed, tokenDistributed] = buckets[bucket];
    const nativeEntitlement = nativeAccrued * BigInt(allocations[bucket]) / 10_000n;
    const tokenEntitlement = tokenAccrued * BigInt(allocations[bucket]) / 10_000n;
    if (!sameHex(recipient, recipients[bucket]) || nativeClaimable + nativeDistributed !== nativeEntitlement
      || tokenClaimable + tokenDistributed !== tokenEntitlement) throw new Error("Fee recipient or entitlement does not reconcile");
    nativeAllocated += nativeEntitlement;
    tokenAllocated += tokenEntitlement;
    return { bucket, recipient, nativeClaimable: nativeClaimable.toString(), tokenClaimable: tokenClaimable.toString(),
      nativeDistributed: nativeDistributed.toString(), tokenDistributed: tokenDistributed.toString() };
  });
  if (nativeAllocated + nativeRoundingDust !== nativeAccrued || tokenAllocated + tokenRoundingDust !== tokenAccrued) {
    throw new Error("Fee accounting does not reconcile");
  }
  return {
    status: "verified", policy, buckets: verifiedBuckets,
    totals: { nativeAccrued: nativeAccrued.toString(), tokenAccrued: tokenAccrued.toString(),
      nativeRoundingDust: nativeRoundingDust.toString(), tokenRoundingDust: tokenRoundingDust.toString() },
  };
}

function liquiditySample(block: ObservedBlock, activeLiquidity: string) {
  return { blockNumber: block.blockNumber.toString(), blockHash: block.hash,
    timestampUnixSeconds: block.timestamp.toString(), activeLiquidity };
}

export async function readLaunchHealth(
  rpc: PublicClient, stateView: Address, launch: NewLaunchRecord, position: ObservedPosition,
  opening: ObservedBlock, current: ObservedBlock,
): Promise<LaunchHealth> {
  const health = makeLaunchHealth(launch, position);
  const compareLiquidity = current.blockNumber >= opening.blockNumber + 2n && current.timestamp > opening.timestamp;
  const [fees, openingLiquidity, holderTrend] = await Promise.all([
    launch.engineVersion === 2 ? observedFees(rpc, launch, current.blockNumber).catch(() => health.fees) : health.fees,
    compareLiquidity ? rpc.readContract({
      address: stateView, abi: activeLiquidityAbi, functionName: "getLiquidity", args: [launch.poolId],
      blockNumber: opening.blockNumber,
    }).catch(() => undefined) : undefined,
    readLaunchHolderTrend(rpc, launch, { number: current.blockNumber, hash: current.hash, timestamp: current.timestamp })
      .catch(() => health.trends.holders),
  ]);
  health.fees = fees;
  health.trends.holders = holderTrend;
  if (openingLiquidity !== undefined) {
    health.trends.liquidity = {
      status: "observed", from: liquiditySample(opening, openingLiquidity.toString()),
      to: liquiditySample(current, position.activeLiquidity),
    };
  }
  return health;
}
