import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, parseAbiItem, parseEventLogs, toHex,
  type Address, type Hex, type TransactionReceipt } from "viem";
import { claimDelegatePin } from "../claim-profiles";
import { isTransactionHash } from "../test-creation";
import { curveBuySignature, curveGraduateSignature, curveSellSignature, isLifecycleAmount, isLifecycleSlippage,
  isLifecycleTrade, sameLifecycleValue as same } from "../test-lifecycle";
import { encodeProductionLifecycleCalldata, isProductionLifecycleOperation, isProductionLifecycleRequest,
  isProductionV4Operation, productionLifecycleCalldataMatches, productionLifecycleChain, productionLifecycleDestination, productionLifecyclePath,
  sameProductionLifecycleRequest, type ProductionLifecycleOperation, type ProductionLifecycleQuote,
  type ProductionLifecycleRequest, type ProductionLifecycleState, type ProductionLifecycleVerification } from "../production-lifecycle";
import { testPermit2Lifetime, testV4PoolId, type TestV4Binding } from "../test-v4";
import { curveProductionDeployment, curveProductionPins, type verifyCurveProduction } from "./curve-production";
import { readEarningsContracts, productionEarningsContext, type EarningsRegistration, type EarningsRpc } from "./earnings-contracts";
import { configuredProductionFinancial, resolveProductionFinancialContext } from "./production-financial";
import { parseProductionDiscovery, readProductionDiscovery, type ProductionRegistration } from "./production-discovery";
import { indexerOrigin } from "./indexer-origin";
import { boundedClaimVerificationRpc } from "./production-claims-settlement";
import { readNitroZeroPosterPolicy } from "./nitro-zero-poster";

const pins = curveProductionPins;
const deadlineWindow = 180n, reviewWindow = 256n, recoveryWindow = 256n;
const maximumReceiptLogs = 128, maximumBlockTransactions = 512;
const maximumRequestBytes = 4096;
export type ProductionTradingContext = Awaited<ReturnType<typeof verifyCurveProduction>> & { approvalBinding: string;
  feePolicy?: "nitro-zero-poster-corroborated-v1"; discoveryReader?: typeof readProductionDiscovery };
type ProductionLifecycleOptions = { configured?: typeof configuredProductionFinancial; resolve?: typeof resolveProductionFinancialContext;
  discovery?: typeof readProductionDiscovery; activity?: typeof readProductionActivity };
const curveAbi = parseAbi([curveBuySignature, curveSellSignature, curveGraduateSignature,
  "function factory() view returns(address)", "function token() view returns(address)", "function active() view returns(bool)",
  "function executionVersion() view returns(uint32)", "function sold() view returns(uint256)", "function graduated() view returns(bool)",
  "function backingReserve() view returns(uint256)", "function graduationSold() view returns(uint256)",
  "function GRADUATION_BACKING() view returns(uint256)", "function VIRTUAL_ETH() view returns(uint256)", "function virtualToken() view returns(uint256)",
  "function poolId() view returns(bytes32)", "function positionTokenId() view returns(uint256)",
  "function quoteBuy(uint256 grossBudget) view returns(uint256 tokensOut,uint256 grossUsed,uint256 fee,uint256 refund)",
  "function quoteSell(uint256 tokenIn) view returns(uint256 ethOut,uint256 grossReleased,uint256 fee)"]);
const permitAbi = parseAbi(["function allowance(address owner,address token,address spender) view returns(uint160 amount,uint48 expiration,uint48 nonce)",
  "event Approval(address indexed owner,address indexed token,address indexed spender,uint160 amount,uint48 expiration)"]);
const stateAbi = parseAbi(["function getSlot0(bytes32 poolId) view returns(uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns(uint128)"]);
const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)"]);
const nitroAbi = parseAbi(["function gasEstimateComponents(address to,bool contractCreation,bytes data) payable returns(uint64 gasEstimate,uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)"]);
const workBudget = (() => { let minute = -1, reads = 0, active = 0; return { acquire() {
  const current = Math.floor(Date.now() / 60000); if (current !== minute) { minute = current; reads = 0; }
  if (reads >= 30 || active >= 2) return null; reads++; active++; let released = false;
  return () => { if (!released) { released = true; active--; } };
} }; })();
const tradeEvent = parseAbiItem("event CurveTrade(address indexed account,bool indexed isBuy,uint256 tokenAmount,uint256 grossNative,uint256 fee,uint256 nativeRefund,uint256 sold,uint256 backingReserve)");
const graduationEvent = parseAbiItem("event CurveGraduated(bytes32 indexed poolId,uint256 indexed positionTokenId,uint256 nativeUsed,uint256 tokenUsed,uint256 nativeDust,uint256 tokenDust)");
const swapEvent = parseAbiItem("event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)");
const headers = { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: object, status = 200) => Response.json(body, { status, headers });
const invalid = (reason: string, status = 422) => reply({ status: "invalid", reason }, status);
const addr = (v: string) => getAddress(v.toLowerCase());
const address = (v: unknown): v is Address => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v) && BigInt(v) > 0xffffn;
function must(v: unknown): asserts v { if (!v) throw Error("Production trading evidence unavailable or conflicting"); }
const exactKeys = (r: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(r, k))
  && Object.keys(r).every(k => required.includes(k) || optional.includes(k));
const equal = (a: unknown, b: unknown) => JSON.stringify(a, (_, v) => typeof v === "bigint" ? v.toString() : v)
  === JSON.stringify(b, (_, v) => typeof v === "bigint" ? v.toString() : v);
async function boundedLifecycleBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(), bytes = new Uint8Array(maximumRequestBytes); let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Body unavailable")), 3000); });
  try {
    for (;;) { const part = await Promise.race([reader.read(), deadline]); if (part.done) break;
      if (size + part.value.byteLength > maximumRequestBytes) return { tooLarge: true } as const;
      bytes.set(part.value, size); size += part.value.byteLength;
    }
    return { input: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))) as unknown };
  } finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}
export const productionCurveFee = (gross: bigint) => (gross * 100n + 9999n) / 10000n;

/** Enforces the exact fixed-supply production economics, including partial fills/refunds. */
export function productionCurveBuyQuote(amount: bigint, result: readonly [bigint, bigint, bigint, bigint], sold: bigint, graduationSold: bigint) {
  const [output, gross, fee, refund] = result;
  must(output > 0n && gross > 0n && refund >= 0n && gross + refund === amount && fee >= 1n
    && productionCurveFee(gross) === fee && output + sold <= graduationSold);
  return { output, fee, refund };
}

export async function productionDirectWallet(rpc: EarningsRpc, account: Address, blockNumber: bigint, pending: boolean) {
  const [rawCode, nonce] = await Promise.all([rpc.getCode({ address: account, blockNumber }), rpc.getTransactionCount({ address: account, blockNumber })]);
  must(rawCode === undefined || typeof rawCode === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(rawCode));
  const code = rawCode ?? "0x";
  must(Number.isSafeInteger(nonce) && nonce >= 0);
  if (code !== "0x") {
    must(same(code, claimDelegatePin.designator));
    const runtime = await rpc.getCode({ address: claimDelegatePin.address, blockNumber });
    must(runtime && same(keccak256(runtime), claimDelegatePin.runtimeHash));
    if (pending) must(same(await rpc.getCode({ address: claimDelegatePin.address, blockTag: "pending" }), runtime));
  }
  if (pending) {
    const [pendingCode, pendingNonce] = await Promise.all([rpc.getCode({ address: account, blockTag: "pending" }), rpc.getTransactionCount({ address: account, blockTag: "pending" })]);
    must(same(pendingCode ?? "0x", code) && pendingNonce === nonce);
  }
  return { codeHash: keccak256(code), nonce: toHex(nonce) };
}

async function registrationFor(context: ProductionTradingContext, token: Address) {
  const discovery = await (context.discoveryReader ?? readProductionDiscovery)(token);
  must(discovery.status === "ready" && discovery.launches.length === 1);
  const number = BigInt(discovery.checkpoint.blockNumber);
  must(number <= context.anchor.blockNumber);
  const checkpoints = await Promise.all([context.rpc, context.corroboratingRpc].map(rpc => rpc.getBlock({ blockNumber: number })));
  must(checkpoints.every(b => same(b.hash, discovery.checkpoint.blockHash)
    && new Date(Number(b.timestamp) * 1000).toISOString() === discovery.checkpoint.timestamp));
  return discovery.launches[0];
}

/** Production registration/receipt, immutable economics, custody, all PoolKey fields and allowances are read at one corroborated block. */
export async function readProductionTradingStateAt(rpc: EarningsRpc, context: ProductionTradingContext, launch: ProductionRegistration,
  account?: Address, historicalReceipt = false): Promise<{ state: ProductionLifecycleState; binding?: TestV4Binding }> {
  const token = addr(launch.token), curve = addr(launch.initialCurve), number = context.anchor.blockNumber;
  const point = { blockNumber: number.toString(), blockHash: context.anchor.blockHash, timestamp: new Date(Number(context.anchor.timestamp) * 1000).toISOString() };
  const snapshot = await readEarningsContracts({ ...productionEarningsContext(rpc, point), ...(historicalReceipt && { historicalReceipt: true as const }) }, launch as EarningsRegistration, account ?? addr(launch.creator));
  // Successors require a separate production trading acceptance. Never silently trade a replacement curve.
  must(snapshot.status === "ready" && same(snapshot.activeCurve, curve) && snapshot.engineVersion === 1);
  const at = { blockNumber: number }, bound = { address: curve, abi: curveAbi, ...at } as const;
  const [asset, factory, version, active, graduated, sold, backing, targetSold, targetBacking, virtualEth, virtualToken, supply, inventory, balances] = await Promise.all([
    rpc.readContract({ ...bound, functionName: "token" }), rpc.readContract({ ...bound, functionName: "factory" }),
    rpc.readContract({ ...bound, functionName: "executionVersion" }), rpc.readContract({ ...bound, functionName: "active" }),
    rpc.readContract({ ...bound, functionName: "graduated" }), rpc.readContract({ ...bound, functionName: "sold" }),
    rpc.readContract({ ...bound, functionName: "backingReserve" }), rpc.readContract({ ...bound, functionName: "graduationSold" }),
    rpc.readContract({ ...bound, functionName: "GRADUATION_BACKING" }), rpc.readContract({ ...bound, functionName: "VIRTUAL_ETH" }),
    rpc.readContract({ ...bound, functionName: "virtualToken" }), rpc.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply", ...at }),
    rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [curve], ...at }),
    account ? Promise.all([rpc.getBalance({ address: account, ...at }), rpc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account], ...at }),
      rpc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, curve], ...at })]) : undefined,
  ]);
  must(same(asset, token) && same(factory, pins.factory[0]) && version === 1 && (active || graduated)
    && targetBacking === 2n * 10n ** 18n && targetSold === supply * 3n / 5n && virtualEth === 2n * targetBacking
    && virtualToken === supply * 9n / 5n && sold <= targetSold && backing <= targetBacking
    && (graduated || inventory === supply - sold) && graduated === (snapshot.lp.status === "ready"));
  const phase = graduated ? "graduated" : sold === targetSold && backing === targetBacking ? "eligible" : "curve";
  const state: ProductionLifecycleState = { factory: pins.factory[0], token, curve, phase, blockNumber: toHex(number), blockHash: point.blockHash,
    inventoryWei: inventory.toString(), backingWei: backing.toString(), soldWei: sold.toString(), totalSupplyWei: supply.toString(),
    targetBackingWei: targetBacking.toString(), targetSoldWei: targetSold.toString(), feeBps: 100,
    priceWei: graduated ? null : ((virtualEth + backing) * 10n ** 18n / (virtualToken - sold)).toString(),
    ...(balances && { account: { ethWei: balances[0].toString(), tokenWei: balances[1].toString(), allowanceWei: balances[2].toString() } }) };
  let binding: TestV4Binding | undefined;
  if (snapshot.lp.status === "ready") {
    const lp = snapshot.lp;
    binding = { engine: pins.engine[0], ledger: lp.ledger, poolId: lp.poolId, poolKey: lp.poolKey };
    const [poolId, positionId, slot, liquidity, allowances] = await Promise.all([
      rpc.readContract({ ...bound, functionName: "poolId" }), rpc.readContract({ ...bound, functionName: "positionTokenId" }),
      rpc.readContract({ address: pins.stateView[0], abi: stateAbi, functionName: "getSlot0", args: [lp.poolId], ...at }),
      rpc.readContract({ address: pins.stateView[0], abi: stateAbi, functionName: "getLiquidity", args: [lp.poolId], ...at }),
      account ? Promise.all([rpc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, pins.permit2[0]], ...at }),
        rpc.readContract({ address: pins.permit2[0], abi: permitAbi, functionName: "allowance", args: [account, token, pins.router212[0]], ...at })]) : undefined,
    ]);
    must(same(poolId, binding.poolId) && same(await testV4PoolId(binding.poolKey), binding.poolId)
      && positionId.toString() === lp.positionTokenId && slot[0] > 0n && slot[3] === 3000 && liquidity >= BigInt(lp.liquidityWei));
    state.postGraduation = { poolId: binding.poolId, poolKey: binding.poolKey, router: pins.router212[0], permit2: pins.permit2[0], ledger: binding.ledger, feeBps: 30,
      fees: { uncollected: { nativeWei: lp.uncollectedNativeWei, tokenWei: lp.uncollectedTokenWei },
        collected: { nativeWei: lp.accruedNativeWei, tokenWei: lp.accruedTokenWei }, claimed: { nativeWei: lp.claimedNativeWei, tokenWei: lp.claimedTokenWei },
        ...(account && { claimable: { nativeWei: lp.claimableNativeWei, tokenWei: lp.claimableTokenWei } }) },
      ...(allowances && { balances: { erc20AllowanceWei: allowances[0].toString(), permit2AllowanceWei: allowances[1][0].toString(),
        permit2Expiration: allowances[1][1], chainTimestamp: Number(context.anchor.timestamp) } }) };
  }
  must(same((await rpc.getBlock({ blockNumber: number })).hash, point.blockHash));
  return { state, binding };
}

async function currentState(context: ProductionTradingContext, token: Address, account?: Address) {
  const launch = await registrationFor(context, token);
  const results = await Promise.all([context.rpc, context.corroboratingRpc].map(rpc => readProductionTradingStateAt(rpc, context, launch, account)));
  must(equal(results[0], results[1]));
  return results[0];
}

export async function prepareProductionLifecycle(context: ProductionTradingContext, token: Address, from: Address,
  operation: ProductionLifecycleOperation, amountWei: string, slippageBps: number, prior?: ProductionLifecycleRequest) {
  must(address(token) && address(from) && isProductionLifecycleOperation(operation) && isLifecycleAmount(operation, amountWei) && isLifecycleSlippage(operation, slippageBps));
  if (prior && (!isProductionLifecycleRequest(prior) || !requestIdentity(context, prior) || !same(prior.token, token) || !same(prior.from, from)
      || prior.operation !== operation || prior.amountWei !== amountWei || prior.slippageBps !== slippageBps)) return { status: "invalid", reason: "stale-review" };
  const [{ state, binding }, wallets] = await Promise.all([currentState(context, token, from),
    Promise.all([context.rpc, context.corroboratingRpc].map(rpc => productionDirectWallet(rpc, from, context.anchor.blockNumber, true)))]);
  must(equal(wallets[0], wallets[1]) && state.account);
  const v4 = isProductionV4Operation(operation), buy = operation === "buy" || operation === "v4-buy";
  if (v4 ? state.phase !== "graduated" : state.phase === "graduated" || (state.phase === "eligible" && operation === "buy")) return { status: "invalid", reason: "curve-closed" };
  if (operation === "graduate" && state.phase !== "eligible") return { status: "invalid", reason: "graduation-not-ready" };
  const at = context.anchor.blockNumber, timestamp = context.anchor.timestamp, amount = BigInt(amountWei);
  const reviewNumber = prior ? BigInt(prior.reviewBlockNumber) : at, deadline = prior ? BigInt(prior.deadline) : timestamp + deadlineWindow;
  const reviews = await Promise.all([context.rpc, context.corroboratingRpc].map(rpc => rpc.getBlock({ blockNumber: reviewNumber })));
  must(reviews.every(b => same(b.hash, reviews[0].hash) && b.timestamp === reviews[0].timestamp));
  if (reviewNumber > at || at - reviewNumber > reviewWindow || deadline <= timestamp || deadline !== reviews[0].timestamp + deadlineWindow
      || prior && (!same(prior.reviewBlockHash, reviews[0].hash) || !same(prior.walletCodeHash, wallets[0].codeHash) || !same(prior.nonce, wallets[0].nonce))) return { status: "invalid", reason: "stale-review" };
  let output = 0n, fee = 0n, refund = 0n;
  if (buy && BigInt(state.account.ethWei) <= amount || !buy && operation !== "graduate" && BigInt(state.account.tokenWei) < amount) return { status: "invalid", reason: "insufficient-balance" };
  if (operation === "sell" && BigInt(state.account.allowanceWei) !== amount) return { status: "invalid", reason: "insufficient-allowance" };
  if (operation === "approve" && BigInt(state.account.allowanceWei) === amount) return { status: "invalid", reason: "amount-unavailable" };
  if (v4) {
    must(binding && state.postGraduation?.balances);
    const p = state.postGraduation.balances, erc20 = BigInt(p.erc20AllowanceWei), permit = BigInt(p.permit2AllowanceWei);
    if (operation === "v4-token-approve" && erc20 === amount || operation === "v4-permit2-approve" && permit === amount && BigInt(p.permit2Expiration) >= deadline) return { status: "invalid", reason: "amount-unavailable" };
    if ((operation === "v4-permit2-approve" || operation === "v4-sell") && erc20 !== amount || operation === "v4-sell" && (permit !== amount || BigInt(p.permit2Expiration) < deadline)) return { status: "invalid", reason: "insufficient-allowance" };
    if (operation === "v4-buy" || operation === "v4-sell") {
      must(amount < 2n ** 127n);
      const poolKey = binding.poolKey;
      const data = encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey, zeroForOne: buy, exactAmount: amount, hookData: "0x" }] });
      const quotes = await Promise.all([context.rpc, context.corroboratingRpc].map(async rpc => {
        const result = await rpc.call({ account: from, to: pins.quoter[0], data, blockNumber: at }); must(result.data);
        return decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInputSingle", data: result.data });
      }));
      must(quotes[0][0] === quotes[1][0] && quotes[0][0] > 0n && quotes[0][0] < 2n ** 127n);
      output = quotes[0][0]; fee = amount * 3000n / 1000000n;
    }
  } else if (operation === "buy") {
    const quotes = await Promise.all([context.rpc, context.corroboratingRpc].map(rpc => rpc.readContract({ address: state.curve, abi: curveAbi,
      functionName: "quoteBuy", args: [amount], blockNumber: at })));
    must(equal(quotes[0], quotes[1]));
    ({ output, fee, refund } = productionCurveBuyQuote(amount, quotes[0], BigInt(state.soldWei), BigInt(state.targetSoldWei)));
  } else if (operation === "sell") {
    const quotes = await Promise.all([context.rpc, context.corroboratingRpc].map(rpc => rpc.readContract({ address: state.curve, abi: curveAbi,
      functionName: "quoteSell", args: [amount], blockNumber: at })));
    must(equal(quotes[0], quotes[1])); const [out, gross, charge] = quotes[0];
    must(out > 0n && charge > 0n && out + charge === gross && productionCurveFee(gross) === charge); output = out; fee = charge;
  }
  const minimum = output * BigInt(10000 - slippageBps) / 10000n;
  if (isLifecycleTrade(operation) && minimum === 0n) return { status: "invalid", reason: "amount-unavailable" };
  const to = productionLifecycleDestination(operation, token, state.curve);
  const data = await encodeProductionLifecycleCalldata(operation, token, state.curve, amount, minimum, deadline, binding);
  const value = buy ? amount : 0n;
  const request: ProductionLifecycleRequest = { operation, token, curve: state.curve, factory: pins.factory[0], from, to, data, value: toHex(value),
    chainId: productionLifecycleChain, nonce: wallets[0].nonce, blockNumber: toHex(curveProductionDeployment.blockNumber), blockHash: curveProductionDeployment.blockHash,
    reviewBlockNumber: toHex(reviewNumber), reviewBlockHash: reviews[0].hash!, deadline: deadline.toString(), amountWei, minimumOutputWei: minimum.toString(), slippageBps,
    approvalBinding: context.approvalBinding, walletCodeHash: wallets[0].codeHash, ...(v4 && { v4: binding }) };
  must(isProductionLifecycleRequest(request));
  if (prior && !sameProductionLifecycleRequest(prior, request)) return { status: "invalid", reason: "stale-review" };
  const simulations = await Promise.all([context.rpc, context.corroboratingRpc].map(async rpc => {
    const [execution, price, priority, nitro] = await Promise.all([rpc.estimateGas({ account: from, to, data, value, blockNumber: at }), rpc.getGasPrice(),
      rpc.estimateMaxPriorityFeePerGas(), rpc.call({ account: from, to: "0x00000000000000000000000000000000000000c8",
        data: encodeFunctionData({ abi: nitroAbi, functionName: "gasEstimateComponents", args: [to, false, data] }), value, blockNumber: at }),
      rpc.call({ account: from, to, data, value, blockNumber: at })]);
    must(nitro.data); const [total, poster, base, l1Base] = decodeFunctionResult({ abi: nitroAbi, functionName: "gasEstimateComponents", data: nitro.data });
    const zeroPolicy = context.feePolicy === "nitro-zero-poster-corroborated-v1" ? await readNitroZeroPosterPolicy(rpc, at) : undefined;
    must(execution >= 21000n && execution <= 30000000n && total >= 21000n && total <= 30000000n && base > 0n
      && (zeroPolicy ? poster === 0n && l1Base === 0n
        : poster > 0n && poster < total && l1Base > 0n)
      && price > 0n && priority >= 0n && priority <= 10n ** 12n && same((await rpc.getBlock({ blockNumber: at })).hash, context.anchor.blockHash));
    const gas = ((total > execution ? total : execution) * 125n + 99n) / 100n;
    const observedMaximum = zeroPolicy ? [base, price, BigInt(zeroPolicy.l2BaseFeeWei), BigInt(zeroPolicy.nativeL2BaseFeeWei)].reduce((n, v) => v > n ? v : n, 0n) : base;
    const gasPrice = zeroPolicy ? 2n * observedMaximum + priority : price > 2n * base + priority ? price : 2n * base + priority;
    must(gas <= 30000000n); return { gas, gasPrice, priority, poster, ...(zeroPolicy && { zeroPolicy, transactionBaseFeeWei: base.toString(), observedGasPriceWei: price.toString() }) };
  }));
  must(equal(simulations[0], simulations[1]));
  const { gas, gasPrice, priority, poster, zeroPolicy, transactionBaseFeeWei, observedGasPriceWei } = simulations[0];
  if (BigInt(state.account.ethWei) < value + gas * gasPrice) return { status: "invalid", reason: "insufficient-balance" };
  const commonQuote = { inputWei: amountWei, outputWei: output.toString(), minimumOutputWei: minimum.toString(), feeWei: fee.toString(), refundWei: refund.toString(),
    gasUnits: gas.toString(), gasPriceWei: gasPrice.toString(), maxPriorityFeePerGasWei: priority.toString(),
    ...((operation === "v4-buy" || operation === "v4-sell") && { feePips: 3000, feeAsset: buy ? "native" as const : "token" as const }) };
  const quote: ProductionLifecycleQuote = zeroPolicy ? { ...commonQuote, feeEvidence: "verified-nitro-zero-poster", l1PosterGasUnits: "0", nitroZeroPosterPolicy: zeroPolicy,
    transactionBaseFeeWei: transactionBaseFeeWei!, observedGasPriceWei: observedGasPriceWei! }
    : { ...commonQuote, feeEvidence: "verified-nitro", l1PosterGasUnits: poster.toString() };
  return { status: "prepared", request, state, quote };
}

function requestIdentity(context: ProductionTradingContext, r: ProductionLifecycleRequest) {
  return same(r.factory, pins.factory[0]) && same(r.blockHash, curveProductionDeployment.blockHash)
    && BigInt(r.blockNumber) === curveProductionDeployment.blockNumber && same(r.approvalBinding, context.approvalBinding);
}

/** Recovers only the original direct transaction. Never rebroadcasts or searches arbitrary history. */
export async function recoverProductionLifecycleHash(rpc: EarningsRpc, context: ProductionTradingContext, r: ProductionLifecycleRequest): Promise<Hex | "pending" | "unavailable"> {
  const nonce = Number(BigInt(r.nonce)); let lower = BigInt(r.reviewBlockNumber), upper = context.anchor.blockNumber;
  if (await rpc.getTransactionCount({ address: r.from, blockNumber: upper }) <= nonce) return context.anchor.timestamp <= BigInt(r.deadline) ? "pending" : "unavailable";
  if (upper - lower > recoveryWindow) lower = upper - recoveryWindow;
  if (await rpc.getTransactionCount({ address: r.from, blockNumber: lower }) > nonce) return "unavailable";
  while (upper - lower > 1n) { const mid = lower + (upper - lower) / 2n;
    if (await rpc.getTransactionCount({ address: r.from, blockNumber: mid }) <= nonce) lower = mid; else upper = mid; }
  const block = await rpc.getBlock({ blockNumber: upper, includeTransactions: true });
  if (block.transactions.length > maximumBlockTransactions) return "unavailable";
  const matches = block.transactions.filter(tx => same(tx.from, r.from) && tx.nonce === nonce);
  return matches.length === 1 ? matches[0].hash : "unavailable";
}

export function exactProductionLifecycleTransaction(tx: Awaited<ReturnType<EarningsRpc["getTransaction"]>>, r: ProductionLifecycleRequest) {
  return same(tx.from, r.from) && same(tx.to, r.to) && same(tx.input, r.data) && tx.chainId === 4663
    && tx.nonce === Number(BigInt(r.nonce)) && tx.value === BigInt(r.value)
    && (tx.type === "eip1559" || tx.type === "legacy") && !((tx as unknown as { authorizationList?: unknown }).authorizationList)
    && (!tx.accessList || tx.accessList.length === 0);
}

type ActivityLog = { address: string; blockNumber: string; blockHash: Hex; transactionHash: Hex; transactionIndex: number; logIndex: number; topics: Hex[]; data: Hex };
export type ProductionActivity = { checkpoint: ProductionRegistration["checkpoint"]; events: ActivityLog[] };
/** A checkpoint alone never proves that a particular trade survived restart/reorg recovery. */
export function parseProductionActivity(raw: unknown, token: Address, hash: Hex, now = Date.now()): ProductionActivity | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as { schemaVersion: number; profile: string; status: string; token: string; transactionHash: string; observedAt: string; events: ActivityLog[] };
    const directory = parseProductionDiscovery({ ...r, profile: "rmt-curve-fixed-supply-security-v2", launches: [], nextCursor: null }, undefined, now);
    if (r.schemaVersion !== 1 || r.profile !== "rmt-curve-activity-v1" || r.status !== "ready" || !same(r.token, token) || !same(r.transactionHash, hash)
        || typeof r.observedAt !== "string" || !Number.isFinite(Date.parse(r.observedAt)) || now - Date.parse(r.observedAt) > 120000 || Date.parse(r.observedAt) > now + 15000
        || directory.status !== "ready" || !Array.isArray(r.events) || r.events.length > maximumReceiptLogs) return null;
    const seen = new Set<number>();
    for (const l of r.events) {
      if (!address(l.address) || !/^[1-9][0-9]{0,15}$/.test(l.blockNumber) || !isTransactionHash(l.blockHash) || !same(l.transactionHash, hash)
          || !Number.isSafeInteger(l.transactionIndex) || l.transactionIndex < 0 || !Number.isSafeInteger(l.logIndex) || l.logIndex < 0 || seen.has(l.logIndex)
          || !Array.isArray(l.topics) || l.topics.length > 4 || !l.topics.every(topic => typeof topic === "string" && /^0x[0-9a-f]{64}$/i.test(topic)) || typeof l.data !== "string" || !/^0x(?:[0-9a-f]{2}){0,4096}$/i.test(l.data)
          || BigInt(l.blockNumber) > BigInt(directory.checkpoint.blockNumber)) return null;
      seen.add(l.logIndex);
    }
    return { checkpoint: directory.checkpoint, events: r.events.map(l => ({ address: l.address, blockNumber: l.blockNumber, blockHash: l.blockHash,
      transactionHash: l.transactionHash, transactionIndex: l.transactionIndex, logIndex: l.logIndex, topics: [...l.topics], data: l.data })) };
  } catch { return null; }
}
export async function readProductionActivity(token: Address, transactionHash: Hex): Promise<ProductionActivity | null> {
  const origin = indexerOrigin(process.env.RMT_LAUNCH_HISTORY_INDEXER_URL), credential = process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN;
  if (!origin || !credential || !/^[\x21-\x7e]{1,512}$/.test(credential)) return null;
  try {
    const url = new URL("/curve-activity", origin); url.searchParams.set("token", token.toLowerCase()); url.searchParams.set("transactionHash", transactionHash.toLowerCase());
    const response = await fetch(url, { headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json") || !response.body) return null;
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 196608) return null; chunks.push(value); } }
    finally { void reader.cancel().catch(() => undefined); }
    const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return parseProductionActivity(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)), token, transactionHash);
  } catch { return null; }
}
function sameActivityLog(row: ActivityLog, log: TransactionReceipt["logs"][number]) {
  return row.logIndex === log.logIndex && row.transactionIndex === log.transactionIndex && row.blockNumber === log.blockNumber?.toString()
    && same(row.blockHash, log.blockHash) && same(row.transactionHash, log.transactionHash) && same(row.address, log.address)
    && same(row.data, log.data) && row.topics.length === log.topics.length && row.topics.every((topic, i) => same(topic, log.topics[i]));
}

/** Exact receipts and contract events, then authenticated durable events; two RPC witnesses must agree. */
async function verifyAt(rpc: EarningsRpc, context: ProductionTradingContext, r: ProductionLifecycleRequest, hash: Hex, activity: ProductionActivity | null): Promise<ProductionLifecycleVerification> {
  const reviewed = await rpc.getBlock({ blockNumber: BigInt(r.reviewBlockNumber) });
  must(same(reviewed.hash, r.reviewBlockHash) && reviewed.timestamp + deadlineWindow === BigInt(r.deadline) && reviewed.number <= context.anchor.blockNumber);
  const wallet = await productionDirectWallet(rpc, r.from, reviewed.number, false); must(same(wallet.codeHash, r.walletCodeHash));
  const launch = await registrationFor(context, r.token);
  const reviewContext = { ...context, anchor: { ...context.anchor, blockNumber: reviewed.number, blockHash: reviewed.hash!, timestamp: reviewed.timestamp } };
  const reviewState = await readProductionTradingStateAt(rpc, reviewContext, launch, r.from, true);
  must(same(reviewState.state.curve, r.curve) && (r.v4 ? reviewState.binding && equal(r.v4, reviewState.binding)
    && reviewState.state.phase === "graduated" : reviewState.state.phase !== "graduated"));
  const tx = await rpc.getTransaction({ hash }); must(same(tx.hash, hash) && exactProductionLifecycleTransaction(tx, r));
  if (tx.blockNumber === null) return { status: "pending", transactionHash: hash };
  const receipt = await rpc.getTransactionReceipt({ hash }), block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  must(same(receipt.transactionHash, hash) && same(receipt.from, r.from) && same(receipt.to, r.to)
    && receipt.blockNumber === tx.blockNumber && receipt.transactionIndex === tx.transactionIndex && same(receipt.blockHash, tx.blockHash)
    && same(block.hash, receipt.blockHash) && block.number === receipt.blockNumber && same(block.transactions[receipt.transactionIndex] as string, hash)
    && receipt.blockNumber > reviewed.number && receipt.blockNumber <= context.anchor.blockNumber && receipt.logs.length <= maximumReceiptLogs
    && new Set(receipt.logs.map(l => l.logIndex)).size === receipt.logs.length && receipt.logs.every(l => !l.removed && l.logIndex !== null && l.logIndex >= 0
      && l.transactionIndex === receipt.transactionIndex && l.blockNumber === receipt.blockNumber && same(l.blockHash, receipt.blockHash)
      && same(l.transactionHash, hash) && l.data.length <= 8194));
  must(same((await productionDirectWallet(rpc, r.from, receipt.blockNumber, false)).codeHash, r.walletCodeHash));
  if (receipt.status === "reverted") return { status: "reverted", transactionHash: hash, indexed: false };
  const approval = ["approve", "v4-token-approve", "v4-permit2-approve"].includes(r.operation);
  must(receipt.status === "success" && (approval || block.timestamp <= BigInt(r.deadline)));
  let evidence: TransactionReceipt["logs"][number][] = [], output: bigint | undefined, fee: bigint | undefined, refund: bigint | undefined;
  if (r.operation === "approve" || r.operation === "v4-token-approve") {
    const events = parseEventLogs({ abi: erc20Abi, eventName: "Approval", strict: true, logs: receipt.logs.filter(l => same(l.address, r.token)) });
    must(events.length === 1 && same(events[0].args.owner, r.from) && same(events[0].args.spender, r.operation === "approve" ? r.curve : pins.permit2[0]) && events[0].args.value === BigInt(r.amountWei));
    evidence = receipt.logs.filter(l => l.logIndex === events[0].logIndex);
  } else if (r.operation === "v4-permit2-approve") {
    const events = parseEventLogs({ abi: permitAbi, eventName: "Approval", strict: true, logs: receipt.logs.filter(l => same(l.address, pins.permit2[0])) });
    must(events.length === 1 && same(events[0].args.owner, r.from) && same(events[0].args.token, r.token) && same(events[0].args.spender, pins.router212[0])
      && events[0].args.amount === BigInt(r.amountWei) && BigInt(events[0].args.expiration) === BigInt(r.deadline) + testPermit2Lifetime);
    evidence = receipt.logs.filter(l => l.logIndex === events[0].logIndex);
  } else if (r.operation === "v4-buy" || r.operation === "v4-sell") {
    must(r.v4);
    const events = parseEventLogs({ abi: [swapEvent], eventName: "Swap", strict: true, logs: receipt.logs.filter(l => same(l.address, pins.poolManager[0])) });
    must(events.length === 1); const s = events[0].args, buy = r.operation === "v4-buy";
    const input = buy ? -s.amount0 : -s.amount1; output = buy ? s.amount1 : s.amount0;
    must(same(s.id, r.v4.poolId) && same(s.sender, pins.router212[0]) && s.fee === 3000 && s.sqrtPriceX96 > 0n && s.liquidity > 0n
      && input === BigInt(r.amountWei) && output >= BigInt(r.minimumOutputWei));
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", strict: true, logs: receipt.logs.filter(l => same(l.address, r.token)) });
    must(transfers.length === 1 && same(transfers[0].args.from, buy ? pins.poolManager[0] : r.from)
      && same(transfers[0].args.to, buy ? r.from : pins.poolManager[0]) && transfers[0].args.value === (buy ? output : input));
    if (!buy) {
      const args = [r.from, r.token, pins.router212[0]] as const;
      const [before, after, permitBefore, permitAfter] = await Promise.all([
        rpc.readContract({ address: r.token, abi: erc20Abi, functionName: "allowance", args: [r.from, pins.permit2[0]], blockNumber: receipt.blockNumber - 1n }),
        rpc.readContract({ address: r.token, abi: erc20Abi, functionName: "allowance", args: [r.from, pins.permit2[0]], blockNumber: receipt.blockNumber }),
        rpc.readContract({ address: pins.permit2[0], abi: permitAbi, functionName: "allowance", args, blockNumber: receipt.blockNumber - 1n }),
        rpc.readContract({ address: pins.permit2[0], abi: permitAbi, functionName: "allowance", args, blockNumber: receipt.blockNumber }),
      ]);
      must(before === input && after === 0n && permitBefore[0] === input && BigInt(permitBefore[1]) >= BigInt(r.deadline) && permitAfter[0] === 0n);
    }
    evidence = receipt.logs.filter(l => l.logIndex === events[0].logIndex || l.logIndex === transfers[0].logIndex); refund = 0n;
  } else if (r.operation === "graduate") {
    const events = parseEventLogs({ abi: [graduationEvent], strict: true, logs: receipt.logs.filter(l => same(l.address, r.curve)) });
    must(events.length === 1 && events[0].args.positionTokenId > 0n && events[0].args.nativeUsed + events[0].args.nativeDust === 2n * 10n ** 18n);
    const atReceipt = { ...context, anchor: { ...context.anchor, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, timestamp: block.timestamp } };
    const state = await readProductionTradingStateAt(rpc, atReceipt, launch, r.from, true);
    must(state.state.phase === "graduated" && state.binding && same(state.binding.poolId, events[0].args.poolId));
    evidence = receipt.logs.filter(l => l.logIndex === events[0].logIndex);
  } else {
    const events = parseEventLogs({ abi: [tradeEvent], strict: true, logs: receipt.logs.filter(l => same(l.address, r.curve)) });
    must(events.length === 1); const trade = events[0].args, buy = r.operation === "buy";
    output = buy ? trade.tokenAmount : trade.grossNative - trade.fee; fee = trade.fee; refund = trade.nativeRefund;
    must(same(trade.account, r.from) && trade.isBuy === buy && output >= BigInt(r.minimumOutputWei) && fee > 0n && productionCurveFee(trade.grossNative) === fee
      && (buy ? trade.grossNative + refund === BigInt(r.amountWei) : trade.tokenAmount === BigInt(r.amountWei) && refund === 0n));
    evidence = receipt.logs.filter(l => l.logIndex === events[0].logIndex);
  }
  if (!activity || BigInt(activity.checkpoint.blockNumber) < receipt.blockNumber || context.anchor.blockNumber < receipt.blockNumber + 20n
      || !evidence.every(log => activity.events.some(row => sameActivityLog(row, log)))) return { status: "pending", transactionHash: hash, indexed: false, settlementPending: true };
  const checkpoint = await rpc.getBlock({ blockNumber: BigInt(activity.checkpoint.blockNumber) });
  must(same(checkpoint.hash, activity.checkpoint.blockHash) && new Date(Number(checkpoint.timestamp) * 1000).toISOString() === activity.checkpoint.timestamp
    && BigInt(activity.checkpoint.blockNumber) <= context.anchor.blockNumber && same((await rpc.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash));
  return { status: "confirmed", transactionHash: hash, indexed: true, ...(output !== undefined && { outputWei: output.toString() }),
    ...(fee !== undefined && { feeWei: fee.toString() }), ...(refund !== undefined && { refundWei: refund.toString() }) };
}

export async function verifyProductionLifecycle(context: ProductionTradingContext, r: ProductionLifecycleRequest, transactionHash?: Hex,
  activityReader = readProductionActivity): Promise<ProductionLifecycleVerification> {
  try {
    must(isProductionLifecycleRequest(r) && requestIdentity(context, r) && await productionLifecycleCalldataMatches(r));
    // Registration binds the curve and immutable original creation independently of event claims.
    const launch = await registrationFor(context, r.token); must(same(launch.initialCurve, r.curve));
    const found = await Promise.all([context.rpc, context.corroboratingRpc].map(rpc => transactionHash ?? recoverProductionLifecycleHash(rpc, context, r)));
    must(same(found[0], found[1])); const hash = found[0];
    if (hash === "pending" || hash === "unavailable") return { status: hash };
    const activity = await activityReader(r.token, hash);
    const results = await Promise.all([context.rpc, context.corroboratingRpc].map(rpc => verifyAt(rpc, context, r, hash, activity)));
    must(equal(results[0], results[1])); return results[0];
  } catch { return { status: "unavailable", ...(transactionHash && { transactionHash }) }; }
}

export async function handleProductionLifecycle(request: Request, options: ProductionLifecycleOptions = {}) {
  if (request.method !== "POST" || !(options.configured ?? configuredProductionFinancial)(request.headers, "trading")) return reply({ status: "unavailable" }, 404);
  if (request.headers.get("origin") !== "https://www.rmtlaunch.fun" || new URL(request.url).origin !== "https://www.rmtlaunch.fun"
      || new URL(request.url).pathname !== productionLifecyclePath || new URL(request.url).search) return invalid("origin", 403);
  const length = request.headers.get("content-length");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body || length !== null && (!/^\d+$/.test(length) || Number(length) > maximumRequestBytes)) return invalid("request", 400);
  const releaseBudget = workBudget.acquire(); if (!releaseBudget) return reply({ status: "unavailable" }, 429);
  try {
    const payload = await boundedLifecycleBody(request.body); if (payload.tooLarge) return invalid("request", 413);
    if (!payload.input || typeof payload.input !== "object" || Array.isArray(payload.input)) return invalid("request", 400);
    const body = payload.input as Record<string, unknown>, resolved = await (options.resolve ?? resolveProductionFinancialContext)(request.headers, "trading");
    if (!resolved) return reply({ status: "unavailable" });
    const context = { ...resolved, rpc: boundedClaimVerificationRpc(resolved.rpc, Date.now, 512), corroboratingRpc: boundedClaimVerificationRpc(resolved.corroboratingRpc, Date.now, 512),
      ...(options.discovery && { discoveryReader: options.discovery }) };
    if (body.action === "state" && exactKeys(body, ["action", "token"], ["account"]) && address(body.token) && (body.account === undefined || address(body.account))) {
      return reply({ status: "ready", state: (await currentState(context, addr(body.token), body.account ? addr(body.account) : undefined)).state });
    }
    if (body.action === "prepare" && exactKeys(body, ["action", "token", "account", "operation", "amountWei", "slippageBps"], ["prior"])
        && address(body.token) && address(body.account) && isProductionLifecycleOperation(body.operation) && isLifecycleAmount(body.operation, body.amountWei)
        && isLifecycleSlippage(body.operation, body.slippageBps) && (body.prior === undefined || isProductionLifecycleRequest(body.prior))) {
      return reply(await prepareProductionLifecycle(context, addr(body.token), addr(body.account), body.operation, body.amountWei, body.slippageBps, body.prior));
    }
    if (body.action === "verify" && exactKeys(body, ["action", "request"], ["transactionHash"]) && isProductionLifecycleRequest(body.request)
        && (body.transactionHash === undefined || isTransactionHash(body.transactionHash))) return reply(await verifyProductionLifecycle(context, body.request, body.transactionHash, options.activity));
    return invalid("request", 400);
  } catch { return reply({ status: "unavailable" }); }
  finally { releaseBudget(); }
}
