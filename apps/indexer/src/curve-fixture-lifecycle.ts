import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, parseAbi, parseEventLogs, toHex, zeroAddress,
  type Address, type Hash, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import type { CurveFixtureBinding, BlockEvidence, CurveLaunchRegistration } from "./curve-launch-evidence.js";
import { assertFixtureNativeProof } from "./curve-fixture-native-proof.js";

const unit = 10n ** 18n;
const threshold = 2n * unit;
const virtualEth = 4n * unit;
const feeBps = 100;
const bps = 10_000n;
const minTick = -887_220;
const maxTick = 887_220;

// Base Sepolia identities from the pinned #594 fixture manifest. This fixture only uses chain 31337.
export const poolManager = "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408";
export const positionManager = "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80";
export const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const fixtureRouter = "0x8702463e73f74d0b6765aBceb314Ef07aCb92650";
export const fixtureQuoter = "0x5e6B8B8AFA7e5CEF6C09dd2A67aBA9FB12C75623";
const stateView = "0x571291b572ed32ce6751a2cb2486ebee8defb9b4";
const dependencies = [
  [poolManager, "0x03c45db6d09b14da7c1f7239a5a49697f976d395277e6d2acb6fbed3f9e0249f"],
  [positionManager, "0xe8329b35b8b34290b6cf03affc0836f7b23205229cc96ffdc66544b93112c076"],
  [permit2, "0xdcde65555316946c298e4c60c6213eb5c3aeab4354d1f3fac5427236bcbb9ebe"],
  [stateView, "0x0e54f1b36938b15a1d4207f9cfe5e13eee61c5393c7a498e859d5bdc86999c39"],
  [fixtureRouter, "0x2aa613cbe4bce524d53cb3ed1d6a8924d9ef1ccd00b250b64aa77c8eb376bf7e"],
  [fixtureQuoter, "0x146bee3fc52c77af0dea3bb02e5d733841cd7e682e359c9b08b6ab2b36797c7f"],
] as const;
const factoryAbi = parseAbi(["function graduationEngine() view returns (address)", "function curveForToken(address token) view returns (address)"]);
const keyFields = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export const lifecycleCurveAbi = parseAbi([
  "function buy(uint256 minimumTokenOut,uint256 deadline) payable returns (uint256)",
  "function sell(uint256 amountIn,uint256 minimumEthOut,uint256 deadline) returns (uint256)",
  "function graduate(uint256 deadline)", "function buyAndGraduate(uint256 minimumTokenOut,uint256 deadline) payable returns (uint256)",
  "function active() view returns (bool)", "function graduated() view returns (bool)", "function sold() view returns (uint256)",
  "function backingReserve() view returns (uint256)", "function graduationSold() view returns (uint256)", "function token() view returns (address)",
  "function GRADUATION_BACKING() view returns (uint256)", "function VIRTUAL_ETH() view returns (uint256)", "function TRADE_FEE_BPS() view returns (uint256)",
  "function graduationEngine() view returns (address)", "function nativeDust() view returns (uint256)", "function tokenDust() view returns (uint256)",
  "function poolId() view returns (bytes32)", "function positionTokenId() view returns (uint256)",
  "event CurveTrade(address indexed account,bool indexed isBuy,uint256 tokenAmount,uint256 grossNative,uint256 fee,uint256 nativeRefund,uint256 sold,uint256 backingReserve)",
  "event CurveGraduated(bytes32 indexed poolId,uint256 indexed positionTokenId,uint256 nativeUsed,uint256 tokenUsed,uint256 nativeDust,uint256 tokenDust)",
]);
const graduationAbi = parseAbi([
  "function factory() view returns (address)", "function poolManager() view returns (address)", "function positionManager() view returns (address)",
  "function permit2() view returns (address)", "function initializationGuard() view returns (address)",
  "function positions(address token) view returns (uint256 tokenId,uint128 liquidity)",
  "function canonicalPoolKey(address token) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
  "event CurveGraduated(address indexed token,address indexed curve,bytes32 indexed poolId,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint160 sqrtPriceX96,uint256 positionTokenId,uint128 liquidity,uint128 nativeUsed,uint128 tokenUsed,uint128 nativeDust,uint128 tokenDust)",
]);
const registryAbi = parseAbi(["function project(address token) view returns (address factory,address curve,uint32 version,address engine,uint64 migrations)"]);
const guardAbi = parseAbi(["function poolManager() view returns (address)", "function graduationEngine() view returns (address)"]);
const ledgerAbi = parseAbi([
  "function activeCurve() view returns (address)", "function totalAccrued() view returns (uint256)", "function totalClaimed() view returns (uint256)",
  "function bucketAccrued(uint256 bucket) view returns (uint256)",
  "event CurveFeesAccrued(uint256 fee,uint256 creatorAmount,uint256 treasuryAmount,uint256 operatingAmount,uint256 futureReserveAmount)",
]);
const positionAbi = parseAbi([
  "function poolManager() view returns (address)", "function permit2() view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)", "function getApproved(uint256 tokenId) view returns (address)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)",
]);
export const fixturePoolManagerAbi = parseAbi([
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
  "event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)",
]);
const stateAbi = parseAbi([
  "function poolManager() view returns (address)",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);

export type FixtureGraduationBinding = { graduationEngine: Address; graduationHash: Hash; guard: Address; guardHash: Hash };
export type LogProof = BlockEvidence & { transactionHash: Hash; logIndex: number };
export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type FixtureTrade = LogProof & {
  side: "buy" | "sell"; account: Address; tokenWei: string; nativeWei: string; feeWei: string; nativeRefundWei: string;
  backingWei: string; soldWei: string;
};
export type FixtureGraduation = LogProof & {
  poolId: Hash; poolKey: PoolKey; positionTokenId: string; owner: Address; liquidityWei: string;
  nativeUsedWei: string; tokenUsedWei: string; nativeDustWei: string; tokenDustWei: string;
  poolManager: Address; positionManager: Address; sqrtPriceX96: string;
};
type PoolSpot = { spotSqrtPriceX96: string; spotTick: number; poolLiquidityWei: string };
export type FixtureLifecycleState = {
  phase: "curve" | "eligible" | "graduated"; activeCurve: Address; observed: BlockEvidence;
  backingWei: string; soldWei: string; inventoryWei: string; graduationBackingWei: string; graduationSoldWei: string; feeBps: number;
  graduation?: FixtureGraduation & PoolSpot;
};
export type FixtureCursor = {
  launch: CurveLaunchRegistration; grossFees: bigint; latestTrade?: FixtureTrade; graduation?: FixtureGraduation;
};
export type FixtureTx = {
  from: Address; to: Address | null; hash: Hash; value: bigint; input: Hex; chainId?: number | null;
  blockNumber: bigint | null; blockHash: Hash | null; transactionIndex?: number | null;
};

const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
export const poolIdentity = (key: PoolKey) => keccak256(encodeAbiParameters([{ name: "key", type: "tuple", components: [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
] }], [key]));

function requireProof(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error("Fixture lifecycle verification failed: " + reason);
}

export async function verifyFixtureGraduationDeployment(rpc: PublicClient, binding: CurveFixtureBinding, graduation: FixtureGraduationBinding) {
  const blockNumber = binding.deploymentBlock;
  const contract = { address: graduation.graduationEngine, abi: graduationAbi, blockNumber } as const;
  const guard = { address: graduation.guard, abi: guardAbi, blockNumber } as const;
  const positions = { address: positionManager, abi: positionAbi, blockNumber } as const;
  const [bound, engineFactory, manager, position, permit, recordedGuard, guardManager, guardEngine, positionsManager, positionsPermit, viewManager] = await Promise.all([
    rpc.readContract({ address: binding.factory, abi: factoryAbi, blockNumber, functionName: "graduationEngine" }),
    rpc.readContract({ ...contract, functionName: "factory" }), rpc.readContract({ ...contract, functionName: "poolManager" }),
    rpc.readContract({ ...contract, functionName: "positionManager" }), rpc.readContract({ ...contract, functionName: "permit2" }),
    rpc.readContract({ ...contract, functionName: "initializationGuard" }), rpc.readContract({ ...guard, functionName: "poolManager" }),
    rpc.readContract({ ...guard, functionName: "graduationEngine" }), rpc.readContract({ ...positions, functionName: "poolManager" }),
    rpc.readContract({ ...positions, functionName: "permit2" }),
    rpc.readContract({ address: stateView, abi: stateAbi, blockNumber, functionName: "poolManager" }),
    ...[...dependencies, [graduation.graduationEngine, graduation.graduationHash], [graduation.guard, graduation.guardHash]].map(async ([address, expected]) => {
      const code = await rpc.getCode({ address, blockNumber });
      requireProof(code && same(keccak256(code), expected), "dependency runtime identity");
    }),
  ]);
  requireProof(same(bound, graduation.graduationEngine) && same(engineFactory, binding.factory) && same(manager, poolManager)
    && same(position, positionManager) && same(permit, permit2) && same(recordedGuard, graduation.guard)
    && same(guardManager, poolManager) && same(guardEngine, graduation.graduationEngine) && same(positionsManager, poolManager)
    && same(positionsPermit, permit2) && same(viewManager, poolManager) && (BigInt(graduation.guard) & 0x3fffn) === 0x2000n, "graduation dependency bindings");
  const canonical = await rpc.getBlock({ blockNumber });
  requireProof(same(canonical.hash, binding.deploymentBlockHash), "deployment anchor changed");
}

export async function verifyFixtureLifecycleRuntime(rpc: PublicClient, binding: CurveFixtureBinding,
  graduation: FixtureGraduationBinding, blockNumber: bigint) {
  const pins = [...dependencies, [binding.factory, binding.factoryRuntimeHash], [binding.projectRegistry, binding.projectRegistryRuntimeHash],
    [graduation.graduationEngine, graduation.graduationHash], [graduation.guard, graduation.guardHash]] as const;
  await Promise.all(pins.map(async ([address, expected]) => {
    const code = await rpc.getCode({ address, blockNumber });
    requireProof(code && same(keccak256(code), expected), "runtime changed at lifecycle checkpoint");
  }));
}

export function feeBuckets(total: bigint, share: number) {
  const platform = total / 10n;
  const operations = platform / 2n;
  const project = total - platform;
  const treasury = project * BigInt(share) / 9_000n;
  return [project - treasury, treasury, operations, platform - operations];
}

export function receiptLogs(transaction: FixtureTx, receipt: TransactionReceipt, block: BlockEvidence, index: number, recipient: Address) {
  const logs = receipt.logs;
  requireProof(transaction.chainId === 31337 && same(transaction.to, recipient) && same(receipt.to, recipient) && same(receipt.from, transaction.from)
    && same(receipt.blockHash, block.blockHash) && receipt.blockNumber.toString() === block.blockNumber && same(receipt.transactionHash, transaction.hash)
    && transaction.blockNumber === receipt.blockNumber && same(transaction.blockHash, receipt.blockHash)
    && transaction.transactionIndex === index && receipt.transactionIndex === index && (receipt.status === "success" || receipt.status === "reverted")
    && Array.isArray(logs) && logs.length <= 128, "transaction envelope");
  const seen = new Set<number>();
  for (const log of logs) {
    requireProof(log.removed === false && same(log.blockHash, block.blockHash) && log.blockNumber === receipt.blockNumber
      && same(log.transactionHash, transaction.hash) && log.transactionIndex === index && log.logIndex !== null
      && Number.isSafeInteger(log.logIndex) && log.logIndex >= 0 && !seen.has(log.logIndex) && log.data.length <= 10_000, "receipt log bounds");
    seen.add(log.logIndex);
  }
  return logs;
}

export async function nativeProof(rpc: PublicClient, tx: FixtureTx, to: Address, payments: Parameters<typeof assertFixtureNativeProof>[2]) {
  const raw = await rpc.request({ method: "debug_traceTransaction", params: [tx.hash, { tracer: "callTracer" }] } as never, { retryCount: 0 });
  assertFixtureNativeProof(raw, { ...tx, to }, payments);
}

export async function indexFixtureCurveTransaction(rpc: PublicClient, binding: FixtureGraduationBinding, cursor: FixtureCursor,
  transaction: FixtureTx, block: BlockEvidence, index: number) {
  let call;
  try { call = decodeFunctionData({ abi: lifecycleCurveAbi, data: transaction.input }); }
  catch { return {}; }
  const launch = cursor.launch;
  const curve = launch.initialCurve;
  if (call.functionName !== "buy" && call.functionName !== "sell" && call.functionName !== "graduate" && call.functionName !== "buyAndGraduate") return {};
  const receipt = await rpc.getTransactionReceipt({ hash: transaction.hash });
  const logs = receiptLogs(transaction, receipt, block, index, curve);
  if (receipt.status === "reverted") {
    requireProof(logs.length === 0, "reverted transaction emitted logs");
    return {};
  }
  requireProof(!cursor.graduation, "curve execution after graduation");
  const curveLogs = logs.filter((log) => same(log.address, curve));
  const tradeLogs = parseEventLogs({ abi: lifecycleCurveAbi, eventName: "CurveTrade", logs: curveLogs, strict: true });
  const graduateLogs = parseEventLogs({ abi: lifecycleCurveAbi, eventName: "CurveGraduated", logs: curveLogs, strict: true });
  const isTrade = call.functionName !== "graduate";
  const doesGraduate = call.functionName === "graduate" || call.functionName === "buyAndGraduate";
  const exactCall = call.functionName === "sell" ? encodeFunctionData({ abi: lifecycleCurveAbi, functionName: "sell", args: call.args })
    : call.functionName === "graduate" ? encodeFunctionData({ abi: lifecycleCurveAbi, functionName: "graduate", args: call.args })
    : encodeFunctionData({ abi: lifecycleCurveAbi, functionName: call.functionName, args: call.args });
  requireProof(tradeLogs.length === Number(isTrade) && graduateLogs.length === Number(doesGraduate) && same(exactCall, transaction.input)
    && BigInt(Date.parse(block.timestamp) / 1_000) <= call.args[call.args.length - 1]!, "calldata and receipt lifecycle mismatch");
  let trade: FixtureTrade | undefined;
  let graduation: FixtureGraduation | undefined;
  const payments: Parameters<typeof assertFixtureNativeProof>[2] = [];
  const ledger = launch.revenueLedger;
  const assetTransfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: logs.filter((log) => same(log.address, launch.token)), strict: true });
  const soldTarget = BigInt(launch.totalSupplyWei) * 3n / 5n;
  let sold = BigInt(cursor.latestTrade?.soldWei ?? "0");
  let backing = BigInt(cursor.latestTrade?.backingWei ?? "0");
  if (isTrade) {
    const event = tradeLogs[0]!;
    const { account, isBuy, tokenAmount, grossNative, fee, nativeRefund, sold: updatedSold, backingReserve } = event.args;
    const wasBuy = call.functionName === "buy" || call.functionName === "buyAndGraduate";
    requireProof(isBuy === wasBuy && same(account, transaction.from) && tokenAmount > 0n && fee > 0n && grossNative > fee
      && fee === ceil(grossNative * BigInt(feeBps), bps), "trade amounts and fee");
    if (isBuy) {
      requireProof(transaction.value === grossNative + nativeRefund && tokenAmount >= call.args[0], "buy limits");
      sold += tokenAmount;
      backing += grossNative - fee;
    } else {
      requireProof(transaction.value === 0n && nativeRefund === 0n && tokenAmount === call.args[0] && grossNative - fee >= call.args[1]!, "sell limits");
      sold -= tokenAmount;
      backing -= grossNative;
    }
    const virtualToken = BigInt(launch.totalSupplyWei) * 18n / 10n;
    requireProof(sold >= 0n && sold <= soldTarget && backing >= 0n && backing <= threshold && updatedSold === sold && backingReserve === backing
      && ceil(virtualEth * virtualToken, virtualToken - sold) - virtualEth === backing, "trade reserve conservation");
    const moved = assetTransfers.filter(({ args }) => same(args.from, isBuy ? curve : account) && same(args.to, isBuy ? account : curve));
    const credits = parseEventLogs({ abi: ledgerAbi, eventName: "CurveFeesAccrued", logs: logs.filter((log) => same(log.address, ledger)), strict: true });
    const after = feeBuckets(cursor.grossFees + fee, launch.treasuryShareBps);
    const before = feeBuckets(cursor.grossFees, launch.treasuryShareBps);
    const amounts = after.map((amount, bucket) => amount - before[bucket]!);
    const credit = credits[0]?.args;
    requireProof(moved.length === 1 && moved[0]?.args.value === tokenAmount && credits.length === 1 && credit && credit.fee === fee
      && credit.creatorAmount === amounts[0] && credit.treasuryAmount === amounts[1] && credit.operatingAmount === amounts[2]
      && credit.futureReserveAmount === amounts[3], "token movement and fee allocations");
    payments.push({ from: curve, to: account, amount: isBuy ? nativeRefund : grossNative - fee }, { from: curve, to: ledger, amount: fee });
    trade = { ...block, transactionHash: transaction.hash, logIndex: event.logIndex, side: isBuy ? "buy" : "sell",
      account, tokenWei: tokenAmount.toString(), nativeWei: grossNative.toString(), feeWei: fee.toString(),
      nativeRefundWei: nativeRefund.toString(), soldWei: sold.toString(), backingWei: backing.toString() };
  }
  if (doesGraduate) {
    if (!isTrade) requireProof(transaction.value === 0n, "standalone graduation value");
    const event = parseEventLogs({ abi: graduationAbi, eventName: "CurveGraduated", strict: true,
      logs: logs.filter((log) => same(log.address, binding.graduationEngine)) });
    const result = event[0]?.args;
    const curveResult = graduateLogs[0]?.args;
    requireProof(event.length === 1 && result && curveResult && sold === soldTarget && backing === threshold, "graduation threshold and receipt");
    const { poolKey, poolId, positionTokenId, liquidity, nativeUsed, tokenUsed, nativeDust, tokenDust, sqrtPriceX96 } = result;
    requireProof(same(result.token, launch.token) && same(result.curve, curve) && same(poolKey.currency0, zeroAddress)
      && same(poolKey.currency1, launch.token) && same(poolKey.hooks, binding.guard) && poolKey.fee === 3_000 && poolKey.tickSpacing === 60
      && same(poolIdentity(poolKey), poolId) && same(curveResult.poolId, poolId) && curveResult.positionTokenId === positionTokenId
      && curveResult.nativeUsed === nativeUsed && curveResult.tokenUsed === tokenUsed && curveResult.nativeDust === nativeDust
      && curveResult.tokenDust === tokenDust && nativeUsed + nativeDust === backing && tokenUsed + tokenDust === BigInt(launch.totalSupplyWei) - sold
      && positionTokenId > 0n && sqrtPriceX96 > 0n && liquidity > 0n && nativeUsed > 0n && tokenUsed > 0n, "graduation amounts and full PoolKey");
    const managerLogs = logs.filter((log) => same(log.address, poolManager));
    const init = parseEventLogs({ abi: fixturePoolManagerAbi, eventName: "Initialize", logs: managerLogs, strict: true });
    const funding = parseEventLogs({ abi: fixturePoolManagerAbi, eventName: "ModifyLiquidity", logs: managerLogs, strict: true });
    const mint = parseEventLogs({ abi: parseAbi(["event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"]), eventName: "Transfer",
      logs: logs.filter((log) => same(log.address, positionManager)), strict: true });
    const tokenDeposit = assetTransfers.filter(({ args }) => same(args.to, poolManager));
    requireProof(init.length === 1 && init[0] && same(init[0].args.id, poolId) && same(poolIdentity(init[0].args), poolId)
      && init[0].args.sqrtPriceX96 === sqrtPriceX96 && funding.length === 1 && funding[0] && same(funding[0].args.id, poolId)
      && same(funding[0].args.sender, positionManager) && funding[0].args.tickLower === minTick && funding[0].args.tickUpper === maxTick
      && funding[0].args.liquidityDelta === liquidity && same(funding[0].args.salt, toHex(positionTokenId, { size: 32 }))
      && mint.length === 1 && mint[0] && same(mint[0].args.from, zeroAddress) && same(mint[0].args.to, binding.graduationEngine)
      && mint[0].args.tokenId === positionTokenId && tokenDeposit.length === 1 && tokenDeposit[0]
      && same(tokenDeposit[0].args.from, binding.graduationEngine) && tokenDeposit[0].args.value === tokenUsed, "canonical v4 initialization, position mint and funding");
    payments.push({ from: curve, to: binding.graduationEngine, amount: backing }, { from: binding.graduationEngine, to: curve, amount: nativeDust },
      { from: positionManager, to: poolManager, amount: nativeUsed });
    graduation = { ...block, transactionHash: transaction.hash, logIndex: event[0]!.logIndex, poolId, poolKey,
      positionTokenId: positionTokenId.toString(), owner: binding.graduationEngine, liquidityWei: liquidity.toString(),
      nativeUsedWei: nativeUsed.toString(), tokenUsedWei: tokenUsed.toString(), nativeDustWei: nativeDust.toString(),
      tokenDustWei: tokenDust.toString(), poolManager, positionManager, sqrtPriceX96: sqrtPriceX96.toString() };
  }
  await nativeProof(rpc, transaction, curve, payments);
  if (trade) {
    cursor.latestTrade = trade;
    cursor.grossFees += BigInt(trade.feeWei);
  }
  if (graduation) cursor.graduation = graduation;
  return { trade, graduation };
}

export async function fixtureLifecycleState(rpc: PublicClient, binding: FixtureGraduationBinding, cursor: FixtureCursor,
  observed: BlockEvidence): Promise<FixtureLifecycleState> {
  const { launch, latestTrade, graduation, grossFees } = cursor;
  const { initialCurve: address, token } = launch;
  const blockNumber = BigInt(observed.blockNumber);
  const curve = { address, abi: lifecycleCurveAbi, blockNumber } as const;
  const ledger = { address: launch.revenueLedger, abi: ledgerAbi, blockNumber } as const;
  const [active, graduated, sold, backing, targetSold, targetBacking, inventory, nativeHeld, current, registry,
    curveEngine, activeAccrual, accrued, claimed, buckets, liveFeeBps, liveVirtualEth, asset] = await Promise.all([
    rpc.readContract({ ...curve, functionName: "active" }), rpc.readContract({ ...curve, functionName: "graduated" }),
    rpc.readContract({ ...curve, functionName: "sold" }), rpc.readContract({ ...curve, functionName: "backingReserve" }),
    rpc.readContract({ ...curve, functionName: "graduationSold" }), rpc.readContract({ ...curve, functionName: "GRADUATION_BACKING" }),
    rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address], blockNumber }),
    rpc.getBalance({ address, blockNumber }),
    rpc.readContract({ address: launch.factory, abi: factoryAbi, functionName: "curveForToken", args: [token], blockNumber }),
    rpc.readContract({ address: launch.projectRegistry, abi: registryAbi, functionName: "project", args: [token], blockNumber }),
    rpc.readContract({ ...curve, functionName: "graduationEngine" }), rpc.readContract({ ...ledger, functionName: "activeCurve" }),
    rpc.readContract({ ...ledger, functionName: "totalAccrued" }), rpc.readContract({ ...ledger, functionName: "totalClaimed" }),
    Promise.all([0n, 1n, 2n, 3n].map((bucket) => rpc.readContract({ ...ledger, functionName: "bucketAccrued", args: [bucket] }))),
    rpc.readContract({ ...curve, functionName: "TRADE_FEE_BPS" }), rpc.readContract({ ...curve, functionName: "VIRTUAL_ETH" }),
    rpc.readContract({ ...curve, functionName: "token" }),
  ]);
  const supply = BigInt(launch.totalSupplyWei);
  requireProof(active && graduated === !!graduation && same(current, address) && same(registry[0], launch.factory)
    && same(registry[1], address) && registry[2] === 1 && same(registry[3], address) && registry[4] === 0n && same(asset, token)
    && same(curveEngine, binding.graduationEngine) && same(activeAccrual, address) && liveFeeBps === BigInt(feeBps) && liveVirtualEth === virtualEth
    && sold === BigInt(latestTrade?.soldWei ?? "0") && backing === (graduation ? 0n : BigInt(latestTrade?.backingWei ?? "0"))
    && nativeHeld === (graduation ? BigInt(graduation.nativeDustWei) : backing)
    && inventory === (graduation ? BigInt(graduation.tokenDustWei) : supply - sold) && targetSold === supply * 3n / 5n
    && targetBacking === threshold && accrued === grossFees && claimed <= accrued && feeBuckets(accrued, launch.treasuryShareBps).every((amount, idx) => amount === buckets[idx]),
    "on-chain lifecycle and event settlement disagree");
  const state: FixtureLifecycleState = {
    phase: graduated ? "graduated" : sold === targetSold && backing === targetBacking ? "eligible" : "curve",
    activeCurve: address, observed, backingWei: backing.toString(), soldWei: sold.toString(), inventoryWei: inventory.toString(),
    graduationBackingWei: targetBacking.toString(), graduationSoldWei: targetSold.toString(), feeBps,
  };
  if (!graduation) return state;
  state.graduation = { ...graduation, ...await verifyFixtureV4Position(rpc, binding, token, graduation, blockNumber) };
  const [pool, curveId, nativeDust, tokenDust] = await Promise.all([
    rpc.readContract({ ...curve, functionName: "poolId" }), rpc.readContract({ ...curve, functionName: "positionTokenId" }),
    rpc.readContract({ ...curve, functionName: "nativeDust" }), rpc.readContract({ ...curve, functionName: "tokenDust" }),
  ]);
  requireProof(same(pool, graduation.poolId) && curveId.toString() === graduation.positionTokenId
    && nativeDust === nativeHeld && tokenDust === inventory, "live v4 curve identity or dust mismatch");
  return state;
}

export async function verifyFixtureV4Position(rpc: PublicClient, binding: FixtureGraduationBinding, token: Address,
  graduation: FixtureGraduation, blockNumber: bigint): Promise<PoolSpot> {
  const id = BigInt(graduation.positionTokenId);
  const position = { address: positionManager, abi: positionAbi, blockNumber, args: [id] } as const;
  const engine = { address: binding.graduationEngine, abi: graduationAbi, blockNumber, args: [token] } as const;
  const view = { address: stateView, abi: stateAbi, blockNumber, args: [graduation.poolId] } as const;
  const [owner, approved, liquidity, positionRecord, enginePosition, canonicalKey, slot, poolLiquidity] = await Promise.all([
    rpc.readContract({ ...position, functionName: "ownerOf" }), rpc.readContract({ ...position, functionName: "getApproved" }),
    rpc.readContract({ ...position, functionName: "getPositionLiquidity" }), rpc.readContract({ ...position, functionName: "getPoolAndPositionInfo" }),
    rpc.readContract({ ...engine, functionName: "positions" }), rpc.readContract({ ...engine, functionName: "canonicalPoolKey" }),
    rpc.readContract({ ...view, functionName: "getSlot0" }), rpc.readContract({ ...view, functionName: "getLiquidity" }),
  ]);
  const [actualKey, info] = positionRecord;
  const pool = graduation.poolId;
  const positionPool = toHex(info >> 56n, { size: 25 });
  requireProof(same(owner, binding.graduationEngine) && same(approved, zeroAddress)
    && liquidity === BigInt(graduation.liquidityWei) && enginePosition[0] === id && enginePosition[1] === liquidity
    && same(poolIdentity(actualKey), pool) && same(poolIdentity(canonicalKey), pool) && same(positionPool, pool.slice(0, 52))
    && BigInt.asIntN(24, info >> 8n) === BigInt(minTick) && BigInt.asIntN(24, info >> 32n) === BigInt(maxTick)
    && (info & 0xffn) === 0n && slot[0] > 0n && poolLiquidity >= liquidity && slot[3] === canonicalKey.fee,
    "live v4 pool or locked principal mismatch");
  return { spotSqrtPriceX96: slot[0].toString(), spotTick: slot[1], poolLiquidityWei: poolLiquidity.toString() };
}
