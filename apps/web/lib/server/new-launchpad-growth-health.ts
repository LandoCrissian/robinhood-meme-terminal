import { erc20Abi, keccak256, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { growthVaultAbi, growthVaultDeployerAbi, type GrowthAssets, type GrowthEvidence } from "../launchpad/growth-vault";
import { launchPoolId, type LaunchHealth, type NewLaunchRecord } from "../launchpad/launch-record";
import { sameHex } from "./new-launchpad-receipt";

const positionsAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint256 info)",
]);
const outcomes = ["no_attempt", "added", "insufficient_assets", "price_outside_review", "below_minimum", "settlement_deferred"] as const;

function assets(native: bigint, tokens: bigint): GrowthAssets {
  return { nativeWei: native.toString(), tokenBaseUnits: tokens.toString() };
}

export async function readGrowthVaultHealth(
  rpc: PublicClient, deployer: Address, positionManager: Address, launch: NewLaunchRecord,
  fees: LaunchHealth["fees"], blockNumber: bigint, timestamp: bigint,
): Promise<GrowthEvidence | undefined> {
  const reserve = launch.feePolicy;
  if (launch.engineVersion !== 2 || !reserve || reserve.reserveBps === 0) return;
  const unavailable = { status: "unknown", reason: "The vault accounting or custody could not be reconciled at this block." } as const;
  try {
    const registered = await rpc.readContract({
      address: deployer, abi: growthVaultDeployerAbi, functionName: "vaultFor", args: [launch.creator, launch.intentId], blockNumber,
    });
    if (sameHex(registered, zeroAddress) || !sameHex(registered, reserve.reserve)) return;
    const bucket = fees.status === "verified" && fees.buckets?.find((entry) => entry.bucket === 2);
    if (!bucket || !sameHex(bucket.recipient, registered)) return unavailable;
    const vault = { address: registered, abi: growthVaultAbi, blockNumber };
    const [firstCode, latestCode, factory, creator, intent, [token, poolId], state, nativeBalance, tokenBalance] = await Promise.all([
      rpc.getCode({ address: registered, blockNumber: BigInt(launch.blockNumber) }),
      rpc.getCode({ address: registered, blockNumber }),
      rpc.readContract({ ...vault, functionName: "factory" }),
      rpc.readContract({ ...vault, functionName: "creator" }),
      rpc.readContract({ ...vault, functionName: "intentId" }),
      rpc.readContract({ ...vault, functionName: "launchContext" }),
      rpc.readContract({ ...vault, functionName: "snapshot" }),
      rpc.getBalance({ address: registered, blockNumber }),
      rpc.readContract({ address: launch.token, abi: erc20Abi, functionName: "balanceOf", args: [registered], blockNumber }),
    ]);
    const outcome = outcomes[state.outcome];
    if (!firstCode || firstCode === "0x" || !latestCode || keccak256(firstCode) !== keccak256(latestCode)
      || !sameHex(factory, launch.factory) || !sameHex(creator, launch.creator) || !sameHex(intent, launch.intentId)
      || !sameHex(token, launch.token) || !sameHex(poolId, launch.poolId) || !outcome
      || state.lastAttemptAt > timestamp || (state.lastAttemptAt === 0n) !== (outcome === "no_attempt")
      || state.nativeCollected !== BigInt(bucket.nativeDistributed) || state.tokenCollected !== BigInt(bucket.tokenDistributed)
      || state.nativeHeld > nativeBalance || state.tokenHeld > tokenBalance
      || state.nativeCollected + state.nativePositionFees !== state.nativeHeld + state.nativeAdded
      || state.tokenCollected + state.tokenPositionFees !== state.tokenHeld + state.tokenAdded) return unavailable;

    let positionCustody: Extract<GrowthEvidence, { status: "verified" }>["positionCustody"] = { status: "not_minted" };
    if (state.positionTokenId > 0n) {
      const position = { address: positionManager, abi: positionsAbi, args: [state.positionTokenId] as const, blockNumber };
      const [owner, liquidity, [poolKey, info]] = await Promise.all([
        rpc.readContract({ ...position, functionName: "ownerOf" }),
        rpc.readContract({ ...position, functionName: "getPositionLiquidity" }),
        rpc.readContract({ ...position, functionName: "getPoolAndPositionInfo" }),
      ]);
      if (!sameHex(owner, registered) || liquidity === 0n || liquidity !== state.liquidityAdded
        || !sameHex(launchPoolId(poolKey), launch.poolId) || (info & 0xffn) !== 0n
        || BigInt.asIntN(24, info >> 8n) !== BigInt(launch.tickLower)
        || BigInt.asIntN(24, info >> 32n) !== BigInt(launch.tickUpper)) return unavailable;
      positionCustody = { status: "locked", positionTokenId: state.positionTokenId.toString(), owner };
    } else if (state.liquidityAdded || state.nativeAdded || state.tokenAdded || state.nativePositionFees || state.tokenPositionFees
      || outcome === "added") return unavailable;

    return {
      status: "verified", vault: registered,
      feesAccrued: assets(BigInt(bucket.nativeClaimable) + state.nativeCollected, BigInt(bucket.tokenClaimable) + state.tokenCollected),
      feesCollected: assets(state.nativeCollected, state.tokenCollected),
      growthPositionFeesCollected: assets(state.nativePositionFees, state.tokenPositionFees),
      reserveHeld: assets(state.nativeHeld, state.tokenHeld),
      liquidityAdded: { ...assets(state.nativeAdded, state.tokenAdded), units: state.liquidityAdded.toString() },
      positionCustody,
      lastReinvestment: { outcome, timestampUnixSeconds: state.lastAttemptAt === 0n ? null : state.lastAttemptAt.toString() },
    };
  } catch {
    return unavailable;
  }
}
