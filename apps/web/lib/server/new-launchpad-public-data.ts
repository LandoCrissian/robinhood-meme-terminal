import { encodeAbiParameters, getAddress, isAddress, isHash, keccak256, parseAbi, parseAbiItem, zeroAddress, type Hash, type PublicClient } from "viem";
import { launchPoolId, type NewLaunchRecord } from "../launchpad/launch-record";
import { readLaunchpadRuntime, verifiedGrowthVaultDeployer, verifiedLaunchpadRpc, type LaunchpadRuntime } from "./new-launchpad-config";
import { canonicalLaunchpadBlock, launchpadFinalityEvidence, readLaunchpadBlock, type LaunchpadObservedBlock } from "./new-launchpad-finality";
import { makeLaunchHealth, readLaunchHealth } from "./new-launchpad-health";
import { readGrowthVaultHealth } from "./new-launchpad-growth-health";
import { sameHex } from "./new-launchpad-receipt";
import { LaunchpadStore, type LaunchCheckpoint, type LaunchPageCursor } from "./new-launchpad-store";

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
const MAX_ACTIVITY_LOGS = 1_024;

export type LaunchCheck = {
  id: string;
  label: string;
  status: "verified" | "failed" | "unknown" | "unsupported";
  detail: string;
};

type ReadStatus = "ready" | "delayed" | "disabled" | "not_found" | "rate_limited" | "invalid";
type PublicResult = {
  status: ReadStatus;
  data?: unknown;
  evidence?: ReturnType<typeof indexEvidence> | ReturnType<typeof launchpadFinalityEvidence>;
  reason?: string;
  retryAfterSeconds?: number;
};
type Cursor = LaunchPageCursor & { anchor?: bigint; binding?: string };
const cursorIdentity = [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }] as const;

function parseCursor(value: string | undefined, forActivity: boolean): Cursor | undefined {
  if (!value) return;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Invalid cursor");
  const text = Buffer.from(value, "base64url").toString("ascii");
  const match = /^(\d{1,15})\.(\d{1,8})(?:\.(\d{1,15})\.([A-Za-z0-9_-]{43}))?$/.exec(text);
  if (!match || !!match[3] !== forActivity || Buffer.from(text).toString("base64url") !== value) throw new Error("Invalid cursor");
  return {
    blockNumber: BigInt(match[1]), logIndex: Number(match[2]), anchor: match[3] ? BigInt(match[3]) : undefined,
    binding: match[4],
  };
}

function activityCursorBinding(launch: NewLaunchRecord, hash: Hash) {
  const digest = keccak256(encodeAbiParameters(cursorIdentity, [BigInt(launch.chainId), launch.factory, launch.poolManager, launch.poolId, hash]));
  return Buffer.from(digest.slice(2), "hex").toString("base64url");
}

function encodeCursor(item: { blockNumber: string; logIndex: number }, anchor?: LaunchpadObservedBlock, launch?: NewLaunchRecord) {
  const suffix = anchor && launch ? `.${anchor.blockNumber}.${activityCursorBinding(launch, anchor.hash)}` : "";
  return Buffer.from(`${item.blockNumber}.${item.logIndex}${suffix}`).toString("base64url");
}

function poolIdentity(launch: NewLaunchRecord) {
  return {
    chainId: launch.chainId, factory: launch.factory, poolManager: launch.poolManager, poolKey: launch.poolKey, poolId: launch.poolId,
  };
}

function launchEvidence(launch: NewLaunchRecord, block?: LaunchpadObservedBlock) {
  return {
    ...poolIdentity(launch),
    blockNumber: launch.blockNumber, blockHash: launch.blockHash,
    timestampUnixSeconds: block?.timestamp.toString() ?? launch.blockTimestamp ?? null,
    transactionHash: launch.transactionHash, logIndex: launch.logIndex, indexing: launch.indexing,
    ...launchpadFinalityEvidence(block),
  };
}

function indexEvidence(config: LaunchpadRuntime, store: LaunchpadStore, page?: Awaited<ReturnType<typeof verifyIndexPage>>) {
  const { chainId, factory, poolManager } = config.deployment;
  const caughtUp = page?.checkpoint && page.checkpoint.blockNumber >= page.head - config.confirmations && store.status() === "ready";
  return {
    chainId, factory, poolManager,
    indexedThrough: page?.checkpoint?.blockNumber.toString() ?? null,
    indexedBlockHash: page?.checkpoint?.hash ?? null,
    timestampUnixSeconds: page?.checkpoint?.timestamp.toString() ?? null,
    ...launchpadFinalityEvidence(page?.checkpoint),
    freshness: caughtUp ? "caught_up" as const : "delayed" as const,
  };
}

async function assertBlockUnchanged(rpc: PublicClient, block: LaunchpadObservedBlock, head: bigint) {
  const current = await readLaunchpadBlock(rpc, block.blockNumber, head);
  if (!sameHex(current.hash, block.hash) || current.timestamp !== block.timestamp) {
    throw new Error("Canonical launch evidence changed during verification");
  }
}

async function assertLaunchCanonical(rpc: PublicClient, launch: NewLaunchRecord, head: bigint) {
  const block = await readLaunchpadBlock(rpc, BigInt(launch.blockNumber), head);
  if (!sameHex(block.hash, launch.blockHash) || (launch.blockTimestamp !== undefined && block.timestamp.toString() !== launch.blockTimestamp)) {
    throw new Error("Launch receipt is no longer canonical");
  }
  return block;
}

function assertPoolIdentity({ deployment }: LaunchpadRuntime, launch: NewLaunchRecord) {
  const expectedHook = deployment.engineVersion === 2 ? deployment.initializationGuard : zeroAddress;
  const { poolKey } = launch;
  if (launch.chainId !== deployment.chainId || launch.engineVersion !== deployment.engineVersion
    || !sameHex(launch.factory, deployment.factory) || !sameHex(launch.poolManager, deployment.poolManager)
    || !sameHex(poolKey.currency0, zeroAddress) || !sameHex(poolKey.currency1, launch.token)
    || !sameHex(poolKey.hooks, expectedHook) || poolKey.fee !== 3000 || poolKey.tickSpacing !== 60
    || !sameHex(launch.poolId, launchPoolId(poolKey))) {
    throw new Error("Launch identity differs from the configured chain, manager or full pool key");
  }
}

async function verifyIndexPage(
  rpc: PublicClient, config: LaunchpadRuntime, checkpoint: LaunchCheckpoint | undefined, launches: NewLaunchRecord[],
) {
  const head = await rpc.getBlockNumber({ cacheTime: 0 });
  const anchor = await readLaunchpadBlock(rpc, head, head);
  const expected = new Map<bigint, Hash>();
  if (checkpoint) expected.set(checkpoint.number, checkpoint.hash);
  for (const launch of launches) {
    assertPoolIdentity(config, launch);
    const height = BigInt(launch.blockNumber);
    if (launch.indexing === "indexed" && (!checkpoint || height > checkpoint.number)) throw new Error("Indexed launch has no covering checkpoint");
    const hash = expected.get(height);
    if (hash && !sameHex(hash, launch.blockHash)) throw new Error("Launch page contains conflicting block hashes");
    expected.set(height, launch.blockHash);
  }
  const blocks = new Map(await Promise.all([...expected].map(async ([height, hash]) => {
    const block = height === head ? anchor : await readLaunchpadBlock(rpc, height, head);
    if (!sameHex(block.hash, hash)) throw new Error("Launch page was reorganized");
    return [height, block] as const;
  })));
  for (const launch of launches) {
    if (launch.blockTimestamp !== undefined && blocks.get(BigInt(launch.blockNumber))?.timestamp.toString() !== launch.blockTimestamp) {
      throw new Error("Launch page contains contradictory timestamps");
    }
  }
  await Promise.all([anchor, ...[...blocks.values()].filter((block) => block.blockNumber !== head)]
    .map((block) => assertBlockUnchanged(rpc, block, head)));
  return { head, blocks, checkpoint: checkpoint ? blocks.get(checkpoint.number) : undefined };
}

async function readPoolState(rpc: PublicClient, config: LaunchpadRuntime, launch: NewLaunchRecord, withHealth: boolean) {
  const blockNumber = await rpc.getBlockNumber({ cacheTime: 0 });
  const initial = await readLaunchpadBlock(rpc, blockNumber, blockNumber);
  const opening = await assertLaunchCanonical(rpc, launch, blockNumber);
  if (initial.blockNumber === opening.blockNumber && !sameHex(initial.hash, opening.hash)) {
    throw new Error("Launch and pool state have contradictory block hashes");
  }
  const block = canonicalLaunchpadBlock(initial);
  const state = { address: config.deployment.stateView, abi: stateViewAbi, args: [launch.poolId] as const, ...block };
  const position = { address: config.deployment.positionManager, abi: positionAbi, args: [BigInt(launch.positionTokenId)] as const, ...block };
  const [[sqrtPriceX96, tick, protocolFee, lpFee], activeLiquidity, positionOwner, positionLiquidity, totalSupply] = await Promise.all([
    rpc.readContract({ ...state, functionName: "getSlot0" }),
    rpc.readContract({ ...state, functionName: "getLiquidity" }),
    rpc.readContract({ ...position, functionName: "ownerOf" }),
    rpc.readContract({ ...position, functionName: "getPositionLiquidity" }),
    rpc.readContract({ address: launch.token, abi: supplyAbi, functionName: "totalSupply", ...block }),
  ]);
  const positionState = { positionOwner, positionLiquidity: positionLiquidity.toString(), activeLiquidity: activeLiquidity.toString() };
  const health = withHealth ? await readLaunchHealth(rpc, config.deployment.stateView, launch, positionState, opening, initial) : undefined;
  if (health && launch.feePolicy?.reserveBps && config.growthVaultDeployer) {
    const deployer = await verifiedGrowthVaultDeployer(config, rpc, blockNumber);
    health.growth = deployer
      ? await readGrowthVaultHealth(rpc, deployer, config.deployment.positionManager, launch, health.fees, blockNumber, initial.timestamp)
      : { status: "unknown", reason: "The optional vault registry could not be verified at this block." };
  }
  await Promise.all([assertBlockUnchanged(rpc, initial, blockNumber), assertBlockUnchanged(rpc, opening, blockNumber)]);
  return {
    sqrtPriceX96: sqrtPriceX96.toString(), tick, protocolFee, lpFee, ...positionState, totalSupply: totalSupply.toString(),
    ...(health ? { health } : {}),
    launchEvidence: launchEvidence(launch, opening),
    evidence: {
      ...poolIdentity(launch), blockNumber: blockNumber.toString(), blockHash: initial.hash,
      timestampUnixSeconds: initial.timestamp.toString(), freshness: "observed_at_chain_head", ...launchpadFinalityEvidence(initial),
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
  const head = await rpc.getBlockNumber({ cacheTime: 0 });
  const anchor = cursor?.anchor ?? head;
  const anchorBlock = await readLaunchpadBlock(rpc, anchor, head);
  if (cursor?.binding && cursor.binding !== activityCursorBinding(launch, anchorBlock.hash)) throw new Error("Activity cursor expired or belongs to another pool");
  if (anchor < BigInt(launch.blockNumber)) throw new Error("Activity anchor precedes the launch");
  const opening = await assertLaunchCanonical(rpc, launch, head);
  if (anchor === opening.blockNumber && !sameHex(anchorBlock.hash, opening.hash)) throw new Error("Activity and launch block disagree");
  const floor = anchor > BigInt(launch.blockNumber) + 127n ? anchor - 127n : BigInt(launch.blockNumber);
  const toBlock = cursor?.blockNumber ?? anchor;
  if (toBlock > anchor || toBlock < floor) throw new Error("Activity cursor is outside the available range");
  const logs = await rpc.getLogs({ address: launch.poolManager, event: swapEvent, args: { id: launch.poolId }, strict: true, fromBlock: floor, toBlock });
  if (logs.length > MAX_ACTIVITY_LOGS) throw new Error("RPC exceeded bounded activity coverage");
  const events = logs.map((log) => {
    const { args, blockNumber, blockHash, transactionHash, logIndex } = log;
    if (log.removed || blockNumber === null || !blockHash || !isHash(blockHash) || !transactionHash || !isHash(transactionHash)
      || logIndex === null || !Number.isSafeInteger(logIndex) || logIndex < 0 || !sameHex(log.address, launch.poolManager)
      || !sameHex(args.id, launch.poolId) || blockNumber < floor || blockNumber > toBlock) {
      throw new Error("RPC returned activity outside the requested pool or range");
    }
    return { type: "swap" as const, blockNumber: blockNumber.toString(), blockHash: blockHash.toLowerCase(), transactionHash: transactionHash.toLowerCase(), logIndex,
      amount0: args.amount0.toString(), amount1: args.amount1.toString(), sqrtPriceX96: args.sqrtPriceX96.toString(), tick: args.tick, fee: args.fee };
  });
  const byPosition = new Map<string, typeof events[number]>();
  const byTransactionLog = new Map<string, string>();
  const blockHashes = new Map<string, string>();
  for (const event of events) {
    const position = `${event.blockNumber}:${event.logIndex}`;
    const identity = `${event.transactionHash}:${event.logIndex}`;
    const previous = byPosition.get(position);
    const previousHash = blockHashes.get(event.blockNumber);
    if ((previousHash && previousHash !== event.blockHash) || (previous && JSON.stringify(previous) !== JSON.stringify(event))
      || (byTransactionLog.has(identity) && byTransactionLog.get(identity) !== position)) throw new Error("RPC returned contradictory activity logs");
    blockHashes.set(event.blockNumber, event.blockHash);
    byPosition.set(position, event);
    byTransactionLog.set(identity, position);
  }
  const unique = [...byPosition.values()]
    .filter((event) => !cursor || event.blockNumber !== cursor.blockNumber.toString() || event.logIndex < cursor.logIndex)
    .sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber) || b.logIndex - a.logIndex);
  const page = unique.slice(0, limit);
  const blocks = new Map([...new Set(page.map((event) => event.blockNumber))].map((number) => [number, readLaunchpadBlock(rpc, BigInt(number), head)]));
  const activity = await Promise.all(page.map(async (event) => {
    const block = await blocks.get(event.blockNumber);
    if (!block || !sameHex(block.hash, event.blockHash)
      || (block.blockNumber === anchor && !sameHex(block.hash, anchorBlock.hash))
      || (block.blockNumber === opening.blockNumber && !sameHex(block.hash, opening.hash))) throw new Error("Pool activity is no longer canonical");
    return { ...event, timestampUnixSeconds: block.timestamp.toString() };
  }));
  const observedBlocks = new Map([[anchorBlock.blockNumber, anchorBlock], [opening.blockNumber, opening]]);
  for (const observed of await Promise.all(blocks.values())) observedBlocks.set(observed.blockNumber, observed);
  await Promise.all([...observedBlocks.values()].map((block) => assertBlockUnchanged(rpc, block, head)));
  return {
    activity,
    nextCursor: unique.length > limit ? encodeCursor(page[page.length - 1], anchorBlock, launch) : null,
    launchEvidence: launchEvidence(launch, opening),
    evidence: {
      ...poolIdentity(launch), blockNumber: anchor.toString(), blockHash: anchorBlock.hash,
      timestampUnixSeconds: anchorBlock.timestamp.toString(), fromBlock: floor.toString(), freshness: "observed_at_anchor",
      coverage: "bounded_pool_swap_events", ...launchpadFinalityEvidence(anchorBlock),
    },
  };
}

const runtime = { config: readLaunchpadRuntime, rpc: verifiedLaunchpadRpc };

export async function readLaunchpadPublicData(input: LaunchpadPublicInput, services = runtime): Promise<PublicResult> {
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
    const config = services.config();
    if (!config || config.deployment.chainId !== chainId) return { status: "disabled", reason: "Public launch data is unavailable for this chain." };
    const activeStore = store = new LaunchpadStore(config.databasePath, config.scope);
    const retryAfterSeconds = store.consumePublicQuota(operation, budgets[operation]);
    if (retryAfterSeconds) return { status: "rate_limited", reason: "Launch data read limit reached.", retryAfterSeconds };
    const pageSize = limit ?? 10;
    const readRpc = async () => {
      const rpc = await services.rpc(config);
      if (await rpc.getChainId() !== chainId) throw new Error("Launch RPC returned the wrong chain");
      return rpc;
    };
    const verifyPage = async (checkpoint: LaunchCheckpoint | undefined, launches: NewLaunchRecord[], rpc?: PublicClient) => {
      const page = checkpoint || launches.length ? await verifyIndexPage(rpc ?? await readRpc(), config, checkpoint, launches) : undefined;
      const latest = activeStore.checkpoint();
      if (latest?.number !== checkpoint?.number || latest?.hash !== checkpoint?.hash) throw new Error("Launch index changed during verification");
      return page;
    };
    if (isList) {
      const checkpoint = store.checkpoint();
      const rows = store.readPage(pageSize + 1, pageCursor);
      const launches = rows.slice(0, pageSize);
      const page = await verifyPage(checkpoint, launches);
      const evidence = indexEvidence(config, store, page);
      return { status: evidence.freshness === "caught_up" ? "ready" : "delayed",
        data: { chainId, launches, nextCursor: rows.length > pageSize ? encodeCursor(launches[launches.length - 1]) : null, evidence } };
    }

    const launch = store.read({ token: getAddress(token!) })[0];
    if (!launch) {
      const page = await verifyPage(store.checkpoint(), []);
      const evidence = indexEvidence(config, store, page);
      if (evidence.freshness !== "caught_up") return { status: "delayed", reason: "The launch index is catching up.", evidence };
      return { status: "not_found", reason: "No verified launch for this token.", evidence };
    }

    try {
      assertPoolIdentity(config, launch);
      const rpc = await readRpc();
      if (operation === "get_launch") {
        const page = await verifyPage(store.checkpoint(), [launch], rpc);
        const block = page?.blocks.get(BigInt(launch.blockNumber));
        if (!block) throw new Error("Canonical launch block unavailable");
        return { status: store.status(), data: { launch, evidence: launchEvidence(launch, block), index: indexEvidence(config, store, page) } };
      }
      if (isActivity) return { status: "ready", data: await readActivity(rpc, launch, pageSize, pageCursor) };
      const state = await readPoolState(rpc, config, launch, operation === "get_launch_checks");
      return operation === "get_pool_state" ? { status: "ready", data: state }
        : { status: "ready", data: { checks: makeChecks(launch, state), health: state.health, launchEvidence: state.launchEvidence,
          evidence: { ...state.evidence, factoryRuntimeHash: config.contracts.factory.runtimeHash,
            initializationGuardRuntimeHash: config.guard?.runtimeHash ?? null } } };
    } catch {
      return {
        status: "delayed", reason: "Current canonical chain evidence is unavailable.", evidence: launchpadFinalityEvidence(),
        ...(operation === "get_launch_checks" ? { data: { checks: makeChecks(launch), health: makeLaunchHealth(launch),
          evidence: { ...launchEvidence(launch), freshness: "unavailable" } } } : {}),
      };
    }
  } catch {
    return { status: "delayed", reason: "Launch data is temporarily unavailable.", evidence: launchpadFinalityEvidence() };
  } finally {
    store?.close();
  }
}
