import {
  decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, parseAbi,
  parseAbiItem, parseEventLogs, toHex, zeroAddress, type Address, type Hash, type Hex, type PublicClient, type TransactionReceipt,
} from "viem";
import type { BlockEvidence } from "./curve-launch-evidence.js";
import { assertFixtureInnerCallProof, assertFixtureNativeProof, fixtureTreasuryClaimInput } from "./curve-fixture-native-proof.js";
import { assertFixtureProjectTreasuryProof, resolveFixtureProjectTreasuryCall,
  type FixtureProjectTreasuryAdmission, type FixtureProjectTreasuryCall } from "./curve-fixture-project-treasury-call.js";
import {
  feeBuckets, fixturePoolManagerAbi, fixtureQuoter, fixtureRouter, nativeProof, permit2, poolIdentity, poolManager, positionManager, receiptLogs,
  verifyFixtureV4Position, type FixtureCursor, type FixtureGraduation, type FixtureGraduationBinding, type FixtureTx, type LogProof,
} from "./curve-fixture-lifecycle.js";

const maxSignedInput = (1n << 127n) - 1n;
const priceScale = 10n ** 36n;
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const safeAbi = parseAbi([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)",
]);
const swapEvent = parseAbiItem("event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)");
const collectionEvent = parseAbiItem("event LpFeesCollected(address indexed token,uint256 indexed positionTokenId,address indexed ledger,uint256 nativeAmount,uint256 tokenAmount)");
const claimEvent = parseAbiItem("event LpFeesClaimed(address indexed recipient,uint256 nativeAmount,uint256 tokenAmount)");
const routerSteps = [{ type: "bytes" }, { type: "bytes[]" }] as const;
const swapFields = [{ type: "tuple", components: [
  { name: "poolKey", type: "tuple", components: [
    { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
  ] },
  { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" },
  { name: "amountOutMinimum", type: "uint128" }, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" },
] }] as const;
const settleFields = [{ type: "address" }, { type: "uint256" }, { type: "bool" }] as const;
const takeFields = [{ type: "address" }, { type: "uint256" }] as const;
const engineAbi = parseAbi([
  "function lpFeeLedger(address token) view returns (address)", "function previewLpFees(address token) view returns (uint256,uint256)",
  "function collectLpFees(address token,uint256 deadline) returns (uint256,uint256)",
]);
const lpLedgerAbi = parseAbi([
  "function token() view returns (address)", "function engine() view returns (address)", "function poolManager() view returns (address)",
  "function creator() view returns (address)", "function treasury() view returns (address)", "function treasuryShareBps() view returns (uint16)",
  "function operatingRecipient() view returns (address)", "function futureReserveRecipient() view returns (address)",
  "function totalAccrued() view returns (uint256,uint256)", "function totalClaimed() view returns (uint256,uint256)",
  "function bucketAccrued(uint256) view returns (uint256,uint256)", "function claimable(address) view returns (uint256,uint256)",
  "function claim() returns (uint256,uint256)", "function claimAsset(bool native) returns (uint256,uint256)",
]);
const policyAbi = parseAbi([
  "function operatingRecipient() view returns (address)", "function futureReserveRecipient() view returns (address)",
]);
const permitAbi = parseAbi(["function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)"]);
const maxPostEvents = 256;

type Role = "creator" | "treasury" | "operations" | "reserve";
type Amount = { nativeWei: string; tokenWei: string };
type Pair = readonly [native: bigint, token: bigint];
export type FixturePostEvent = LogProof & Amount & {
  kind: "v4-buy" | "v4-sell" | "lp-collect" | "lp-claim"; account: Address; feePips?: number;
};
export type FixturePostState = {
  ledger: Address; router: Address; permit2: Address; quoter: Address;
  uncollected: Amount; accrued: Amount; claimed: Amount; balances: Amount;
  beneficiaries: { address: Address; roles: Role[]; claimable: Amount }[];
};
export type FixturePostCursor = FixtureCursor & { postEvents?: FixturePostEvent[]; lpLedger?: Address };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const equal = (a: Pair, b: Pair) => a[0] === b[0] && a[1] === b[1];
const amount = ([native, token]: Pair): Amount => ({ nativeWei: native.toString(), tokenWei: token.toString() });
const add = (a: Pair, b: Pair): Pair => [a[0] + b[0], a[1] + b[1]];
const subtract = (a: Pair, b: Pair): Pair => [a[0] - b[0], a[1] - b[1]];
const zero: Pair = [0n, 0n];
const positive = (a: Pair) => a[0] > 0n || a[1] > 0n;
const atTime = (block: BlockEvidence) => BigInt(Date.parse(block.timestamp) / 1000);

function requireProof(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error("Fixture post-graduation proof failed: " + reason);
}

export async function loadFixtureLpLedger(rpc: PublicClient, graduation: FixtureGraduationBinding, cursor: FixturePostCursor) {
  if (!cursor.graduation) return;
  const address = await rpc.readContract({ address: graduation.graduationEngine, abi: engineAbi, functionName: "lpFeeLedger",
    args: [cursor.launch.token], blockNumber: BigInt(cursor.graduation.blockNumber) });
  requireProof(!same(address, zeroAddress), "missing immutable fee ledger");
  cursor.lpLedger = address;
  return address;
}

/** Decoder for the exact #594 2.1.2 command, with empty hook data and implicit recipient = sender. */
export function fixtureSwapInput(input: Hex) {
  if (input.length > 4096) return;
  try {
    const { args } = decodeFunctionData({ abi: routerAbi, data: input });
    const [command, inputs, deadline] = args;
    if (command !== "0x10" || inputs.length !== 1 || args[1][0]!.length > 2048) return;
    const [actions, params] = decodeAbiParameters(routerSteps, inputs[0]!);
    if (actions !== "0x060b0f" || params.length !== 3) return;
    const [swap] = decodeAbiParameters(swapFields, params[0]!);
    const { poolKey, zeroForOne, amountIn, amountOutMinimum, minHopPriceX36, hookData } = swap;
    const [source, target] = zeroForOne ? [poolKey.currency0, poolKey.currency1] : [poolKey.currency1, poolKey.currency0];
    if (hookData !== "0x" || amountIn < 1n || amountIn > maxSignedInput || amountOutMinimum < 1n || amountOutMinimum > maxSignedInput
        || minHopPriceX36 <= 0n || minHopPriceX36 !== amountOutMinimum * priceScale / amountIn || deadline === 0n) return;
    const canonical = [encodeAbiParameters(swapFields, [swap]), encodeAbiParameters(settleFields, [source, amountIn, true]),
      encodeAbiParameters(takeFields, [target, amountOutMinimum])];
    if (!same(input, encodeFunctionData({ abi: routerAbi, functionName: "execute",
      args: ["0x10", [encodeAbiParameters(routerSteps, ["0x060b0f", canonical])], deadline] }))) return;
    return { buy: zeroForOne, poolId: poolIdentity(poolKey), amountIn, amountOutMinimum, deadline };
  } catch {
    return undefined;
  }
}

function expectTokenTransfer(logs: TransactionReceipt["logs"], token: Address, from: Address, to: Address, expected: bigint) {
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", strict: true, logs: logs.filter(log => same(log.address, token)) });
  const matched = transfers.filter(({ args }) => same(args.from, from) && same(args.to, to));
  requireProof(expected === 0n ? transfers.length === 0
    : transfers.length === 1 && matched.length === 1 && matched[0]?.args.value === expected, "exact token transfer");
}

function ledgerTotals(events: readonly FixturePostEvent[]) {
  let accrued = zero, claimed = zero;
  const paid = new Map<string, Pair>();
  for (const event of events) {
    const sum: Pair = [BigInt(event.nativeWei), BigInt(event.tokenWei)];
    if (event.kind === "lp-collect") accrued = add(accrued, sum);
    if (event.kind === "lp-claim") {
      claimed = add(claimed, sum);
      const account = event.account.toLowerCase();
      paid.set(account, add(paid.get(account) ?? zero, sum));
    }
  }
  return { accrued, claimed, paid };
}

async function swapSettlement(rpc: PublicClient, tx: FixtureTx, block: BlockEvidence, receipt: TransactionReceipt,
  logs: TransactionReceipt["logs"], token: Address, graduation: FixtureGraduation, decoded: NonNullable<ReturnType<typeof fixtureSwapInput>>) {
  const swaps = parseEventLogs({ abi: [swapEvent], eventName: "Swap", strict: true, logs: logs.filter(log => same(log.address, poolManager)) });
  const [swap] = swaps;
  const buy = decoded.buy;
  requireProof(swaps.length === 1 && swap && same(swap.args.id, graduation.poolId) && same(swap.args.sender, fixtureRouter)
    && swap.args.fee === graduation.poolKey.fee && tx.value === (buy ? decoded.amountIn : 0n) && decoded.deadline >= atTime(block),
    "canonical router swap");
  const input = buy ? -swap.args.amount0 : -swap.args.amount1;
  const output = buy ? swap.args.amount1 : swap.args.amount0;
  requireProof(input === decoded.amountIn && output >= decoded.amountOutMinimum, "exact-in and minimum-out bounds");

  const tokenAmount = buy ? output : input;
  const native = buy ? input : output;
  expectTokenTransfer(logs, token, buy ? poolManager : tx.from, buy ? tx.from : poolManager, tokenAmount);
  await nativeProof(rpc, tx, fixtureRouter, [{ from: buy ? fixtureRouter : poolManager, to: buy ? poolManager : tx.from, amount: native }]);
  if (!buy) {
    const args = [tx.from, token, fixtureRouter] as const;
    const tokenBound = { address: token, abi: erc20Abi, functionName: "allowance", args: [tx.from, permit2] } as const;
    const permitBound = { address: permit2, abi: permitAbi, functionName: "allowance", args } as const;
    const height = receipt.blockNumber;
    const [granted, [delegated, expires], allowanceLeft, [delegationLeft]] = await Promise.all([
      rpc.readContract({ ...tokenBound, blockNumber: height - 1n }), rpc.readContract({ ...permitBound, blockNumber: height - 1n }),
      rpc.readContract({ ...tokenBound, blockNumber: height }), rpc.readContract({ ...permitBound, blockNumber: height }),
    ]);
    requireProof(granted === input && delegated === input && BigInt(expires) >= decoded.deadline && allowanceLeft === 0n
      && delegationLeft === 0n, "exact bounded sell allowance and exhaustion");
  }
  return { kind: buy ? "v4-buy" as const : "v4-sell" as const, nativeWei: native.toString(), tokenWei: tokenAmount.toString(),
    feePips: swap.args.fee, logIndex: swap.logIndex };
}

async function collectSettlement(rpc: PublicClient, tx: FixtureTx, block: BlockEvidence, logs: TransactionReceipt["logs"],
  token: Address, graduation: FixtureGraduation, ledger: Address, deadline: bigint, externalCall?: Hex, projectCall?: FixtureProjectTreasuryCall) {
  const [event] = parseEventLogs({ abi: [collectionEvent], strict: true, logs: logs.filter(log => same(log.address, graduation.owner)) });
  const [poke] = parseEventLogs({ abi: fixturePoolManagerAbi, eventName: "ModifyLiquidity", strict: true, logs: logs.filter(log => same(log.address, poolManager)) });
  requireProof(event && same(event.args.token, token) && same(event.args.ledger, ledger) && tx.value === 0n && deadline >= atTime(block)
    && event.args.positionTokenId.toString() === graduation.positionTokenId && poke && same(poke.args.id, graduation.poolId)
    && same(poke.args.sender, positionManager) && poke.args.liquidityDelta === 0n && poke.args.tickLower === -887_220
    && poke.args.tickUpper === 887_220 && same(poke.args.salt, toHex(BigInt(graduation.positionTokenId), { size: 32 })),
  "fee collection spent or identified a different position");
  const hasExtraEvents = logs.filter(log => same(log.address, graduation.owner) && same(log.topics[0] ?? "", event.topics[0]))
    .length !== 1 || logs.filter(log => same(log.address, poolManager) && same(log.topics[0] ?? "", poke.topics[0])).length !== 1;
  requireProof(!hasExtraEvents, "multiple fee collection or liquidity events");
  const { nativeAmount, tokenAmount } = event.args;
  requireProof(nativeAmount > 0n || tokenAmount > 0n, "empty fee collection");
  expectTokenTransfer(logs, token, poolManager, ledger, tokenAmount);
  if (externalCall) {
    requireProof(tx.to, "absent contract collector");
    const raw = await rpc.request({ method: "debug_traceTransaction", params: [tx.hash, { tracer: "callTracer" }] } as never, { retryCount: 0 });
    const outer = { from: tx.from, to: tx.to, input: tx.input, value: 0n };
    if (projectCall) assertFixtureProjectTreasuryProof(raw, tx, projectCall, [{ from: poolManager, to: ledger, amount: nativeAmount }]);
    else {
      assertFixtureInnerCallProof(raw, outer, { from: tx.to, to: graduation.owner, input: externalCall, value: 0n });
      assertFixtureNativeProof(raw, outer, [{ from: poolManager, to: ledger, amount: nativeAmount }]);
    }
  } else await nativeProof(rpc, tx, graduation.owner, [{ from: poolManager, to: ledger, amount: nativeAmount }]);
  const preview = await rpc.readContract({ address: graduation.owner, abi: engineAbi, functionName: "previewLpFees",
    args: [token], blockNumber: BigInt(block.blockNumber) - 1n });
  requireProof(equal(preview, [nativeAmount, tokenAmount]), "position preview and collection disagree");
  return { kind: "lp-collect" as const, nativeWei: nativeAmount.toString(), tokenWei: tokenAmount.toString(), logIndex: event.logIndex };
}

function claimAssetMode(input: Hex) {
  try {
    const call = decodeFunctionData({ abi: lpLedgerAbi, data: input });
    if ((call.functionName === "claim" || call.functionName === "claimAsset")
        && same(input, encodeFunctionData({ abi: lpLedgerAbi, ...call }))) return call.functionName === "claim" ? "both" : call.args[0] ? "native" : "token";
  } catch { /* Unrecognized claim calldata. */ }
}

/** A single Safe CALL to a known fee ledger. All other executions are left to coverage reconciliation. */
export function fixtureExternalClaim(input: Hex) {
  if (input.length > 3_202) return;
  try {
    const decoded = decodeFunctionData({ abi: safeAbi, data: input });
    const [ledger, value, calldata, operation, , , gasPrice, gasToken, refundReceiver] = decoded.args;
    if (operation === 0 && value === 0n && gasPrice === 0n && same(gasToken, zeroAddress) && same(refundReceiver, zeroAddress)
        && claimAssetMode(calldata) && same(input, encodeFunctionData({ abi: safeAbi, ...decoded }))) return { ledger, calldata };
  } catch { /* Unrecognized external treasury transaction. */ }
}

/** Task075 extends only the two permissionless fee operations. A canonical
 * single CALL is still proved through the real outer trace and exact events;
 * no multisend, delegatecall, arbitrary destination or refund path is added. */
export function fixtureExternalFeeCall(input: Hex) {
  if (input.length > 3_202) return;
  try {
    const decoded = decodeFunctionData({ abi: safeAbi, data: input });
    const [target, value, calldata, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver] = decoded.args;
    if (operation !== 0 || value !== 0n || safeTxGas !== 0n || baseGas !== 0n || gasPrice !== 0n
        || !same(gasToken, zeroAddress) || !same(refundReceiver, zeroAddress) || !same(input, encodeFunctionData({ abi: safeAbi, ...decoded }))) return;
    const feeAbi = parseAbi(["function collectLpFees(address token,uint256 deadline)", "function claimCreationFees()"]);
    const call = decodeFunctionData({ abi: feeAbi, data: calldata });
    if (!same(calldata, encodeFunctionData({ abi: feeAbi, ...call }))) return;
    return { target, calldata, operation: call.functionName };
  } catch { return; }
}

async function claimSettlement(rpc: PublicClient, tx: FixtureTx, block: BlockEvidence, logs: TransactionReceipt["logs"],
  token: Address, ledger: Address, account: Address, externalCall?: Hex, projectCall?: FixtureProjectTreasuryCall) {
  const events = parseEventLogs({ abi: [claimEvent], strict: true, logs: logs.filter(log => same(log.address, ledger)) });
  const [event] = events;
  requireProof(events.length === 1 && event && same(event.args.recipient, account) && tx.value === 0n, "claim recipient");
  const { nativeAmount, tokenAmount } = event.args;
  const input = projectCall?.calldata ?? (externalCall
    ? fixtureTreasuryClaimInput(await rpc.request({ method: "debug_traceTransaction", params: [tx.hash, { tracer: "callTracer" }] } as never,
        { retryCount: 0 }), { ...tx, to: account }, ledger, nativeAmount)
    : tx.input);
  if (projectCall) assertFixtureProjectTreasuryProof(await rpc.request({ method: "debug_traceTransaction", params: [tx.hash, { tracer: "callTracer" }] } as never,
    { retryCount: 0 }), tx, projectCall, [{ from: ledger, to: account, amount: nativeAmount }]);
  requireProof(!externalCall || same(externalCall, input), "outer and inner claim calldata disagree");
  const mode = claimAssetMode(input);
  requireProof(mode, "exact claim calldata");
  const claimable = { address: ledger, abi: lpLedgerAbi, functionName: "claimable", args: [account] } as const;
  const height = BigInt(block.blockNumber);
  const [before, after] = await Promise.all([
    rpc.readContract({ ...claimable, blockNumber: height - 1n }), rpc.readContract({ ...claimable, blockNumber: height }),
  ]);
  const expected: Pair = [mode === "token" ? 0n : before[0], mode === "native" ? 0n : before[1]];
  requireProof(positive(expected) && equal(expected, [nativeAmount, tokenAmount]) && equal(after, subtract(before, expected)),
    "claim exceeds the exact original entitlement");
  expectTokenTransfer(logs, token, ledger, account, tokenAmount);
  if (!externalCall) await nativeProof(rpc, tx, ledger, [{ from: ledger, to: account, amount: nativeAmount }]);
  return { kind: "lp-claim" as const, nativeWei: nativeAmount.toString(), tokenWei: tokenAmount.toString(), logIndex: event.logIndex };
}

export async function indexFixturePostTransaction(rpc: PublicClient, binding: FixtureGraduationBinding, cursors: FixturePostCursor[],
  tx: FixtureTx, block: BlockEvidence, index: number, admitProjectTreasury?: FixtureProjectTreasuryAdmission) {
  const target = tx.to;
  if (!target || cursors.every(cursor => !cursor.graduation)) return;
  let cursor: FixturePostCursor | undefined;
  let decoded: ReturnType<typeof fixtureSwapInput>;
  let collectDeadline: bigint | undefined;
  let externalCall: Hex | undefined;
  let externalCollection: Hex | undefined;
  const projectTreasury = await resolveFixtureProjectTreasuryCall(cursors, tx, block, admitProjectTreasury);
  const externalFee = tx.value === 0n ? fixtureExternalFeeCall(tx.input) : undefined;
  if (projectTreasury?.call.operation === "lp-collect") {
    cursor = projectTreasury.cursor;
    const call = decodeFunctionData({ abi: engineAbi, data: projectTreasury.call.calldata });
    if (call.functionName !== "collectLpFees") return;
    collectDeadline = call.args[1]; externalCollection = projectTreasury.call.calldata;
  } else if (projectTreasury?.call.operation === "lp-claim") {
    cursor = projectTreasury.cursor; externalCall = projectTreasury.call.calldata;
  } else if (same(target, fixtureRouter)) {
    decoded = fixtureSwapInput(tx.input);
    if (!decoded) return;
    cursor = cursors.find(item => item.graduation && same(item.graduation.poolId, decoded!.poolId));
  } else if (same(target, binding.graduationEngine) || externalFee && same(externalFee.target, binding.graduationEngine) && externalFee.operation === "collectLpFees") {
    try {
      const actualInput = externalFee?.calldata ?? tx.input;
      const call = decodeFunctionData({ abi: engineAbi, data: actualInput });
      if (call.functionName !== "collectLpFees" || !same(actualInput, encodeFunctionData({ abi: engineAbi, ...call }))) return;
      collectDeadline = call.args[1];
      cursor = cursors.find(item => item.graduation && same(call.args[0], item.launch.token));
      if (externalFee) externalCollection = actualInput;
    } catch { return; }
  } else {
    cursor = cursors.find(item => item.lpLedger && same(item.lpLedger, target));
    if (cursor) {
      if (!claimAssetMode(tx.input)) return;
    } else {
      if (tx.value !== 0n) return;
      const claim = fixtureExternalClaim(tx.input);
      if (!claim) return;
      // Exact credit/event/trace checks below prove the contract beneficiary.
      // A Safe's rights are not restricted to the project's treasury role and
      // never flow through to its EOA owners.
      cursor = cursors.find(item => item.lpLedger && same(item.lpLedger, claim.ledger));
      externalCall = claim.calldata;
    }
  }
  if (!cursor?.graduation || !cursor.lpLedger) return;
  const receipt = await rpc.getTransactionReceipt({ hash: tx.hash });
  const logs = receiptLogs(tx, receipt, block, index, target);
  if (receipt.status === "reverted") {
    requireProof(logs.length === 0, "reverted action emitted evidence");
    return;
  }
  // Safe can report a reverted internal call in a successful outer receipt.
  // The range's independent ledger log scan still rejects a silently omitted claim.
  if (externalCall && !logs.some(log => same(log.address, cursor.lpLedger!) && same(log.topics[0] ?? "", fixturePostEventTopics.claim))) return;
  if (externalCollection && !logs.some(log => same(log.address, binding.graduationEngine) && same(log.topics[0] ?? "", fixturePostEventTopics.collect))) return;
  const { graduation, lpLedger: ledger, launch: { token } } = cursor;
  const account = projectTreasury?.call.treasury ?? (externalCall || externalCollection ? target : tx.from);
  const proof = decoded ? await swapSettlement(rpc, tx, block, receipt, logs, token, graduation, decoded)
    : collectDeadline !== undefined ? await collectSettlement(rpc, tx, block, logs, token, graduation, ledger, collectDeadline, externalCollection, projectTreasury?.call)
      : await claimSettlement(rpc, tx, block, logs, token, ledger, account, externalCall, projectTreasury?.call);
  await verifyFixtureV4Position(rpc, binding, token, graduation, receipt.blockNumber);
  const event: FixturePostEvent = { ...block, transactionHash: tx.hash, account, ...proof };
  cursor.postEvents ??= [];
  requireProof(cursor.postEvents.length < maxPostEvents, "event history exceeds fixture limit");
  cursor.postEvents.push(event);
  return { token, evidence: event };
}

export async function readFixturePostState(rpc: PublicClient, binding: FixtureGraduationBinding, cursor: FixturePostCursor,
  blockNumber: bigint): Promise<FixturePostState | undefined> {
  if (!cursor.graduation) return;
  const { launch, lpLedger: ledger, postEvents = [] } = cursor;
  requireProof(ledger, "absent immutable ledger");
  const token = launch.token, engine = binding.graduationEngine;
  const base = { address: ledger, abi: lpLedgerAbi, blockNumber } as const;
  const asset = { address: token, abi: erc20Abi, blockNumber } as const;
  const original = { address: launch.initialCurve, abi: policyAbi, blockNumber } as const;
  const [boundLedger, tokenBinding, engineBinding, managerBinding, creator, treasury, share, operations, reserve, originalOperations,
    originalReserve, uncollected, accrued, claimed, nativeBalance, tokenBalance, buckets] = await Promise.all([
    rpc.readContract({ address: engine, abi: engineAbi, functionName: "lpFeeLedger", args: [token], blockNumber }),
    rpc.readContract({ ...base, functionName: "token" }), rpc.readContract({ ...base, functionName: "engine" }),
    rpc.readContract({ ...base, functionName: "poolManager" }), rpc.readContract({ ...base, functionName: "creator" }),
    rpc.readContract({ ...base, functionName: "treasury" }), rpc.readContract({ ...base, functionName: "treasuryShareBps" }),
    rpc.readContract({ ...base, functionName: "operatingRecipient" }), rpc.readContract({ ...base, functionName: "futureReserveRecipient" }),
    rpc.readContract({ ...original, functionName: "operatingRecipient" }), rpc.readContract({ ...original, functionName: "futureReserveRecipient" }),
    rpc.readContract({ address: engine, abi: engineAbi, functionName: "previewLpFees", args: [token], blockNumber }),
    rpc.readContract({ ...base, functionName: "totalAccrued" }), rpc.readContract({ ...base, functionName: "totalClaimed" }),
    rpc.getBalance({ address: ledger, blockNumber }), rpc.readContract({ ...asset, functionName: "balanceOf", args: [ledger] }),
    Promise.all([0n, 1n, 2n, 3n].map(index => rpc.readContract({ ...base, functionName: "bucketAccrued", args: [index] }))),
  ]);
  requireProof(same(boundLedger, ledger) && same(tokenBinding, token) && same(engineBinding, engine) && same(managerBinding, poolManager)
    && same(creator, launch.creator) && same(treasury, launch.treasury ?? zeroAddress) && share === launch.treasuryShareBps
    && same(operations, originalOperations) && same(reserve, originalReserve), "fee ledger immutable binding");
  const totals = ledgerTotals(postEvents);
  const outstanding = subtract(accrued, claimed);
  requireProof(equal(accrued, totals.accrued) && equal(claimed, totals.claimed) && outstanding[0] >= 0n && outstanding[1] >= 0n
    && nativeBalance >= outstanding[0] && tokenBalance >= outstanding[1], "fee totals and ledger backing");
  const nativeBuckets = feeBuckets(accrued[0], share), tokenBuckets = feeBuckets(accrued[1], share);
  const beneficiaries = new Map<string, { address: Address; roles: Role[]; due: Pair }>();
  const committed: [Role, Address][] = [["creator", creator], ["treasury", treasury], ["operations", operations], ["reserve", reserve]];
  for (const [index, [role, recipient]] of committed.entries()) {
    const due: Pair = [nativeBuckets[index]!, tokenBuckets[index]!];
    requireProof(equal(buckets[index]!, due), "fee split by committed beneficiary");
    if (same(recipient, zeroAddress)) {
      requireProof(equal(due, zero), "zero address has a fee entitlement");
      continue;
    }
    const key = recipient.toLowerCase();
    const existing = beneficiaries.get(key);
    beneficiaries.set(key, { address: recipient, roles: [...existing?.roles ?? [], role], due: add(existing?.due ?? zero, due) });
  }
  requireProof([...totals.paid.keys()].every(key => beneficiaries.has(key)), "unauthorized beneficiary receipt");
  const verified = await Promise.all([...beneficiaries].map(async ([key, { address, roles, due }]) => {
    const claimable = await rpc.readContract({ ...base, functionName: "claimable", args: [address] });
    requireProof(equal(claimable, subtract(due, totals.paid.get(key) ?? zero)), "beneficiary credit and receipt history disagree");
    return { address, roles, claimable: amount(claimable) };
  }));
  return { ledger, router: fixtureRouter, permit2, quoter: fixtureQuoter, uncollected: amount(uncollected), accrued: amount(accrued),
    claimed: amount(claimed), balances: amount([nativeBalance, tokenBalance]), beneficiaries: verified };
}

export const fixturePostEventTopics = {
  swap: keccak256(toHex("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")),
  collect: keccak256(toHex("LpFeesCollected(address,uint256,address,uint256,uint256)")),
  claim: keccak256(toHex("LpFeesClaimed(address,uint256,uint256)")),
} as const satisfies Record<string, Hash>;
