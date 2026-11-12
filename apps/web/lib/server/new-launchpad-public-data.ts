import { getAddress, isAddress, parseAbi, parseAbiItem, zeroAddress, type Hash, type PublicClient } from "viem";
import type { NewLaunchRecord } from "../launchpad/launch-record";
import { readLaunchpadRuntime, verifiedLaunchpadRpc, type LaunchpadRuntime } from "./new-launchpad-config";
import { makeLaunchHealth, readLaunchHealth } from "./new-launchpad-health";
import { sameHex } from "./new-launchpad-receipt";
import { LaunchpadStore, type LaunchPageCursor } from "./new-launchpad-store";

export const launchpadPublicOperations = ["list_launches", "get_launch", "get_launch_checks", "get_pool_state", "get_launch_activity"] as const;
export type LaunchpadPublicOperation = typeof launchpadPublicOperations[number];
export type LaunchpadPublicInput = {
  operation: LaunchpadPublicOperation;
  chainId: number;
  token?: string;
  limit?: number;
  cursor?: string;
};

const budgets = { list_launches: 60, get_launch: 60, get_launch_checks: 20, get_pool_state: 20, get_launch_activity: 15 } as const;
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
const positionAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
]);
const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);
const swapEvent = parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)");

export type LaunchCheck = {
  id: string;
  label: string;
  status: "verified" | "failed" | "unknown" | "unsupported";
  detail: string;
};

type ReadStatus = "ready" | "delayed" | "disabled" | "not_found" | "rate_limited" | "invalid";
type PublicResult = { status: ReadStatus; data?: unknown; reason?: string; retryAfterSeconds?: number };
type Cursor = LaunchPageCursor & { anchor?: bigint; poolId?: Hash; anchorHash?: Hash };

function parseCursor(value: string | undefined, forActivity: boolean): Cursor | undefined {
  if (!value) return;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Invalid cursor");
  const text = Buffer.from(value, "base64url").toString("ascii");
  const match = /^(\d{1,15})\.(\d{1,8})(?:\.(\d{1,15})\.([0-9a-f]{16})\.([0-9a-f]{16}))?$/.exec(text);
  if (!match || !!match[3] !== forActivity || Buffer.from(text).toString("base64url") !== value) throw new Error("Invalid cursor");
  return {
    blockNumber: BigInt(match[1]), logIndex: Number(match[2]), anchor: match[3] ? BigInt(match[3]) : undefined,
    poolId: match[4] ? `0x${match[4]}` : undefined, anchorHash: match[5] ? `0x${match[5]}` : undefined,
  };
}

function encodeCursor(item: { blockNumber: string; logIndex: number }, anchor?: { blockNumber: bigint; poolId: Hash; hash: Hash }) {
  const suffix = anchor ? `.${anchor.blockNumber}.${anchor.poolId.slice(2, 18).toLowerCase()}.${anchor.hash.slice(2, 18).toLowerCase()}` : "";
  return Buffer.from(`${item.blockNumber}.${item.logIndex}${suffix}`).toString("base64url");
}

function poolIdentity(launch: NewLaunchRecord) {
  return {
    chainId: launch.chainId, factory: launch.factory, poolManager: launch.poolManager, poolKey: launch.poolKey, poolId: launch.poolId,
  };
}

function launchEvidence(launch: NewLaunchRecord) {
  return {
    ...poolIdentity(launch),
    blockNumber: launch.blockNumber, blockHash: launch.blockHash, timestampUnixSeconds: launch.blockTimestamp ?? null,
    transactionHash: launch.transactionHash, logIndex: launch.logIndex, indexing: launch.indexing,
    finality: "local_chain_observed" as const,
  };
}

function indexEvidence(store: LaunchpadStore) {
  const checkpoint = store.checkpoint();
  return {
    indexedThrough: checkpoint?.number.toString() ?? null,
    indexedBlockHash: checkpoint?.hash ?? null,
    finality: "local_chain_observed" as const,
    freshness: store.status() === "ready" ? "caught_up" : "delayed",
  };
}

async function exactBlock(rpc: PublicClient, blockNumber: bigint) {
  const block = await rpc.getBlock({ blockNumber, includeTransactions: false });
  if (!block.hash || block.number !== blockNumber) throw new Error("Canonical block unavailable");
  return { blockNumber, hash: block.hash, timestamp: block.timestamp };
}

async function assertLaunchCanonical(rpc: PublicClient, launch: NewLaunchRecord) {
  const block = await exactBlock(rpc, BigInt(launch.blockNumber));
  if (!sameHex(block.hash, launch.blockHash)) throw new Error("Launch receipt is no longer canonical");
  return block;
}

async function readPoolState(rpc: PublicClient, config: LaunchpadRuntime, launch: NewLaunchRecord, withHealth: boolean) {
  const expectedHook = config.deployment.engineVersion === 2 ? config.deployment.initializationGuard : zeroAddress;
  if (launch.engineVersion !== config.deployment.engineVersion || !sameHex(launch.poolKey.hooks, expectedHook)
    || !sameHex(launch.factory, config.deployment.factory) || !sameHex(launch.poolManager, config.deployment.poolManager)) {
    throw new Error("Launch identity differs from the configured factory and guard");
  }
  const blockNumber = await rpc.getBlockNumber();
  if (blockNumber < BigInt(launch.blockNumber)) throw new Error("RPC is behind the launch");
  const initial = await exactBlock(rpc, blockNumber);
  const opening = await assertLaunchCanonical(rpc, launch);
  const state = { address: config.deployment.stateView, abi: stateViewAbi, args: [launch.poolId] as const, blockNumber };
  const position = { address: config.deployment.positionManager, abi: positionAbi, args: [BigInt(launch.positionTokenId)] as const, blockNumber };
  const [[sqrtPriceX96, tick, protocolFee, lpFee], activeLiquidity, positionOwner, positionLiquidity, totalSupply] = await Promise.all([
    rpc.readContract({ ...state, functionName: "getSlot0" }),
    rpc.readContract({ ...state, functionName: "getLiquidity" }),
    rpc.readContract({ ...position, functionName: "ownerOf" }),
    rpc.readContract({ ...position, functionName: "getPositionLiquidity" }),
    rpc.readContract({ address: launch.token, abi: supplyAbi, functionName: "totalSupply", blockNumber }),
  ]);
  const positionState = { positionOwner, positionLiquidity: positionLiquidity.toString(), activeLiquidity: activeLiquidity.toString() };
  const health = withHealth ? await readLaunchHealth(rpc, config.deployment.stateView, launch, positionState, opening, initial) : undefined;
  if (!sameHex(initial.hash, (await exactBlock(rpc, blockNumber)).hash)) throw new Error("Pool state changed branches during verification");
  return {
    sqrtPriceX96: sqrtPriceX96.toString(), tick, protocolFee, lpFee, ...positionState, totalSupply: totalSupply.toString(),
    ...(health ? { health } : {}),
    launchEvidence: launchEvidence(launch),
    evidence: {
      ...poolIdentity(launch), blockNumber: blockNumber.toString(), blockHash: initial.hash,
      timestampUnixSeconds: initial.timestamp.toString(), freshness: "observed_at_chain_head", finality: "local_chain_observed",
    },
  };
}

function makeChecks(launch: NewLaunchRecord, state?: Awaited<ReturnType<typeof readPoolState>>): LaunchCheck[] {
  const custodyMatches = state && sameHex(state.positionOwner, launch.factory) && state.positionLiquidity === launch.liquidity;
  const supplyMatches = state && state.totalSupply === launch.totalSupply;
  const guarded = launch.engineVersion === 2;
  return [
    { id: "factory_origin", label: "Factory origin", status: state ? "verified" : "unknown", detail: state ? "The canonical launch receipt came from the pinned local factory." : "The stored launch receipt could not be rechecked against the current chain." },
    { id: "pool_funding", label: "Initial liquidity", status: state ? "verified" : "unknown", detail: state ? `The launch funded ${launch.amount0} wei of native ETH and ${launch.amount1} base units of the token.` : "The recorded launch deposits await a current canonical-chain check." },
    { id: "fixed_supply", label: "Fixed token supply", status: state ? (supplyMatches ? "verified" : "failed") : "unknown", detail: supplyMatches ? `The standard fixed-supply token reports ${launch.totalSupply} base units.` : "Current supply must match the factory's recorded fixed supply." },
    { id: "lp_lock", label: "Permanent LP custody", status: state ? (custodyMatches ? "verified" : "failed") : "unknown", detail: custodyMatches ? "The immutable factory still owns the position NFT with its original liquidity." : "Position ownership and liquidity must match the launch receipt." },
    guarded
      ? { id: "initialization_guard", label: "Initialization-only guard", status: state ? "verified" : "unknown", detail: "The canonical pool key records the factory-bound initialization guard and a 0.30% static LP fee tier." }
      : { id: "hookless_pool", label: "Hookless v4 pool", status: state ? "verified" : "unknown", detail: "The factory's pool key records zero hooks and a 0.30% static LP fee tier." },
    ...(guarded ? [{
      id: "fee_commitment", label: "Immutable fee allocation",
      status: state?.health?.fees.status === "verified" ? "verified" as const : "unknown" as const,
      detail: state?.health?.fees.status === "verified"
        ? "Current collected balances, distributions and rounding dust reconcile with the canonical launch fee policy."
        : "Current fee accounting has not been verified against the canonical launch commitment.",
    }] : []),
    { id: "external_routing", label: "External routing", status: "unknown", detail: "No external indexing or routing observation is recorded for this local launch." },
  ];
}

async function readActivity(rpc: PublicClient, launch: NewLaunchRecord, limit: number, cursor: Cursor | undefined) {
  const head = await rpc.getBlockNumber();
  const anchor = cursor?.anchor ?? head;
  if (anchor > head || anchor < BigInt(launch.blockNumber)
    || (cursor?.poolId && !launch.poolId.toLowerCase().startsWith(cursor.poolId))) throw new Error("Activity cursor expired or belongs to another pool");
  const anchorBlock = await exactBlock(rpc, anchor);
  if (cursor?.anchorHash && !anchorBlock.hash.toLowerCase().startsWith(cursor.anchorHash)) throw new Error("Activity cursor was reorganized");
  await assertLaunchCanonical(rpc, launch);
  const floor = anchor > BigInt(launch.blockNumber) + 127n ? anchor - 127n : BigInt(launch.blockNumber);
  const toBlock = cursor?.blockNumber ?? anchor;
  if (toBlock > anchor || toBlock < floor) throw new Error("Activity cursor is outside the available range");
  const logs = await rpc.getLogs({ address: launch.poolManager, event: swapEvent, args: { id: launch.poolId }, strict: true, fromBlock: floor, toBlock });
  if (!sameHex(anchorBlock.hash, (await exactBlock(rpc, anchor)).hash)) throw new Error("Activity branch changed during verification");
  const events = logs.flatMap((log) => {
    const { args, blockNumber, blockHash, transactionHash, logIndex } = log;
    if (log.removed || blockNumber === null || !blockHash || !transactionHash || logIndex === null || !sameHex(log.address, launch.poolManager)
      || !sameHex(args.id, launch.poolId) || blockNumber < floor || blockNumber > toBlock
      || (cursor && blockNumber === cursor.blockNumber && logIndex >= cursor.logIndex)) return [];
    return [{ type: "swap" as const, blockNumber: blockNumber.toString(), blockHash, transactionHash, logIndex,
      amount0: args.amount0.toString(), amount1: args.amount1.toString(), sqrtPriceX96: args.sqrtPriceX96.toString(), tick: args.tick, fee: args.fee }];
  }).sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber) || b.logIndex - a.logIndex);
  const unique = [...new Map(events.map((event) => [`${event.transactionHash}:${event.logIndex}`, event])).values()];
  const page = unique.slice(0, limit);
  const blocks = new Map([...new Set(page.map((event) => event.blockNumber))].map((number) => [number, exactBlock(rpc, BigInt(number))]));
  const activity = await Promise.all(page.map(async (event) => {
    const block = await blocks.get(event.blockNumber);
    if (!block || !sameHex(block.hash, event.blockHash)) throw new Error("Pool activity is no longer canonical");
    return { ...event, timestampUnixSeconds: block.timestamp.toString() };
  }));
  return {
    activity,
    nextCursor: unique.length > limit ? encodeCursor(page[page.length - 1], { blockNumber: anchor, poolId: launch.poolId, hash: anchorBlock.hash }) : null,
    launchEvidence: launchEvidence(launch),
    evidence: {
      ...poolIdentity(launch), blockNumber: anchor.toString(), blockHash: anchorBlock.hash,
      timestampUnixSeconds: anchorBlock.timestamp.toString(), fromBlock: floor.toString(), freshness: "observed_at_anchor",
      coverage: "bounded_pool_swap_events", finality: "local_chain_observed",
    },
  };
}

export async function readLaunchpadPublicData(input: LaunchpadPublicInput): Promise<PublicResult> {
  const { operation, chainId, token, cursor, limit } = input;
  const isList = operation === "list_launches";
  const isActivity = operation === "get_launch_activity";
  if (!launchpadPublicOperations.includes(operation) || !Number.isSafeInteger(chainId) || chainId <= 0
    || (isList ? token !== undefined : typeof token !== "string" || !isAddress(token))
    || ((cursor !== undefined || limit !== undefined) && !isList && !isActivity)
    || (cursor !== undefined && (typeof cursor !== "string" || cursor.length === 0))
    || (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20))) {
    return { status: "invalid", reason: "Use a supported operation, an exact chain and token, and a bounded page." };
  }
  let pageCursor: Cursor | undefined;
  try { pageCursor = parseCursor(cursor, isActivity); }
  catch { return { status: "invalid", reason: "Invalid page cursor." }; }

  let store: LaunchpadStore | undefined;
  try {
    const config = readLaunchpadRuntime();
    if (!config || config.deployment.chainId !== chainId) return { status: "disabled", reason: "Public launch data is unavailable for this chain." };
    store = new LaunchpadStore(config.databasePath, config.scope);
    const retryAfterSeconds = store.consumePublicQuota(operation, budgets[operation]);
    if (retryAfterSeconds) return { status: "rate_limited", reason: "Launch data read limit reached.", retryAfterSeconds };
    const pageSize = limit ?? 10;
    if (isList) {
      const rows = store.readPage(pageSize + 1, pageCursor);
      const launches = rows.slice(0, pageSize);
      return { status: store.status(), data: { chainId, launches, nextCursor: rows.length > pageSize ? encodeCursor(launches[launches.length - 1]) : null, evidence: indexEvidence(store) } };
    }

    const launch = store.read({ token: getAddress(token!) })[0];
    if (!launch) return store.status() === "ready" ? { status: "not_found", reason: "No verified launch for this token." }
      : { status: "delayed", reason: "The launch index is catching up." };
    if (operation === "get_launch") return { status: store.status(), data: { launch, evidence: launchEvidence(launch), index: indexEvidence(store) } };

    try {
      const rpc = await verifiedLaunchpadRpc(config);
      if (isActivity) return { status: "ready", data: await readActivity(rpc, launch, pageSize, pageCursor) };
      const state = await readPoolState(rpc, config, launch, operation === "get_launch_checks");
      return operation === "get_pool_state" ? { status: "ready", data: state }
        : { status: "ready", data: { checks: makeChecks(launch, state), health: state.health, launchEvidence: state.launchEvidence,
          evidence: { ...state.evidence, factoryRuntimeHash: config.contracts.factory.runtimeHash,
            initializationGuardRuntimeHash: config.guard?.runtimeHash ?? null } } };
    } catch {
      return {
        status: "delayed", reason: "Current canonical chain evidence is unavailable.",
        ...(operation === "get_launch_checks" ? { data: { checks: makeChecks(launch), health: makeLaunchHealth(launch),
          evidence: { ...launchEvidence(launch), freshness: "unavailable" } } } : {}),
      };
    }
  } catch {
    return { status: "delayed", reason: "Launch data is temporarily unavailable." };
  } finally {
    store?.close();
  }
}
