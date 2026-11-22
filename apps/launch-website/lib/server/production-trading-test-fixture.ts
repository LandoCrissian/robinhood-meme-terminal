import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, erc20Abi, parseAbi, zeroAddress, type Hex } from "viem";
import { launchTokenSupplyWei } from "../launch-terms";
import type { ProductionLifecycleRequest } from "../production-lifecycle";
import { productionClaimFixture, syntheticClaimApproval } from "./production-earnings-test-fixture";
import { curveProductionDeployment, curveProductionPins as pins } from "./curve-production";
import type { EarningsRpc } from "./earnings-contracts";
import { productionCurveFee, type ProductionTradingContext } from "./production-lifecycle";
import { testV4PoolId } from "../test-v4";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const eth = 10n ** 18n, targetSold = launchTokenSupplyWei * 3n / 5n;
const tradeAbi = parseAbi(["event CurveTrade(address indexed account,bool indexed isBuy,uint256 tokenAmount,uint256 grossNative,uint256 fee,uint256 nativeRefund,uint256 sold,uint256 backingReserve)"]);
const graduationAbi = parseAbi(["event CurveGraduated(bytes32 indexed poolId,uint256 indexed positionTokenId,uint256 nativeUsed,uint256 tokenUsed,uint256 nativeDust,uint256 tokenDust)"]);
const swapAbi = parseAbi(["event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)"]);
const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)"]);
const permitAbi = parseAbi(["event Approval(address indexed owner,address indexed token,address indexed spender,uint160 amount,uint48 expiration)"]);
const nitroAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
/** Real production ABI/runtime preimages; synthetic storage, balances, logs and credentials only. */
export function productionTradingFixture() {
  const p = productionClaimFixture(), key = { currency0: zeroAddress, currency1: p.f.token, fee: 3000, tickSpacing: 60, hooks: pins.guard[0] };
  const knobs = { phase: "curve" as "curve" | "eligible" | "graduated", request: null as ProductionLifecycleRequest | null,
    mined: false, reverted: false, reorg: false, missingIndex: false, wrongIndex: false, quoteConflict: false, wrongTarget: false,
    nonceConflict: false, allowance: 0n, erc20Allowance: 0n, permitAllowance: 0n, peerOffline: false,
    zeroPoster: false, positiveC8: false, missingC8: false, conflictingC8: false, zeroL1Estimate: 0n, zeroUnit: 0n,
    zeroBaseMismatch: false, zeroNativeDifferent: false, missingTransactionBase: false, missingGasInfo: false, advance: 0n, expired: false };
  const minedAt = p.reviewNumber + 1n;
  const phaseAt = (n: bigint) => (knobs.request?.operation === "graduate" || knobs.request?.operation === "buy-graduate") && knobs.mined && n >= minedAt ? "graduated" : knobs.phase;
  const buyQuote = (input: bigint): readonly [bigint, bigint, bigint, bigint] => {
    // A 2 ETH gross budget backs 1.98 ETH. Four ETH fills the unchanged 2 ETH target and refunds the excess.
    const cap = (2n * eth * 10000n + 9899n) / 9900n;
    const gross = input < cap ? input : cap, fee = productionCurveFee(gross), backing = gross - fee;
    return [backing === 2n * eth ? targetSold : targetSold * backing / (2n * eth), gross, fee, input - gross];
  };
  const makeRpc = (base: EarningsRpc, peer = false): EarningsRpc => new Proxy(base, { get(target, name) {
    const original = Reflect.get(target, name); if (typeof original !== "function") return original;
    return async (arg: any = {}) => {
      if (peer && knobs.peerOffline) throw Error("synthetic independent witness unavailable");
      const height = arg.blockNumber ?? (knobs.mined ? p.reviewNumber + 22n : p.reviewNumber + knobs.advance), phase = phaseAt(height);
      if (name === "getTransactionCount") return arg.blockTag === "pending" ? 0 : knobs.mined && height >= minedAt ? 1 + Number(peer && knobs.nonceConflict) : 0;
      if (name === "getBlock") {
        const block = await Reflect.apply(original, target, [{ ...arg, blockNumber: height }]) as any;
        return { ...block, ...(!knobs.mined && height > p.reviewNumber && { timestamp: knobs.expired ? p.current().timestamp + 180n
          : p.current().timestamp + (height - p.reviewNumber > 12n ? 12n : height - p.reviewNumber) }),
          ...(knobs.reorg && height === minedAt && { hash: "0x" + "f".repeat(64) }),
          ...(height === minedAt && knobs.mined && { transactions: [arg.includeTransactions ? await transaction() : p.f.txHash] }) };
      }
      if (name === "getTransaction") return transaction();
      if (name === "getTransactionReceipt" && arg.hash === p.f.txHash) return receipt();
      if (name === "call" && same(arg.to, pins.quoter[0])) return { data: encodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInputSingle", result: [10n ** 20n + (peer && knobs.quoteConflict ? 1n : 0n), 80000n] }) };
      if (name === "call" && same(arg.to, "0x00000000000000000000000000000000000000c8") && knobs.zeroPoster) {
        if (knobs.missingC8) return { data: "0x" };
        const positive = knobs.positiveC8 || peer && knobs.conflictingC8;
        return { data: encodeFunctionResult({ abi: nitroAbi, functionName: "gasEstimateComponents", result: [50000n, positive ? 10000n : 0n, knobs.missingTransactionBase ? 0n : knobs.zeroBaseMismatch ? 3n : 2n, positive ? 10n : 0n] }) };
      }
      if (name === "simulateContract") return { result: [10n ** 20n + (peer && knobs.quoteConflict ? 1n : 0n), 80000n] };
      if (name === "readContract") {
        if (same(arg.address, "0x000000000000000000000000000000000000006c")) {
          if (knobs.missingGasInfo) throw Error("synthetic missing native gas data");
          return arg.functionName === "getL1BaseFeeEstimate" ? knobs.zeroL1Estimate
            : [0n, knobs.zeroUnit, 40000n, knobs.zeroNativeDifferent ? 3n : 2n, 0n, knobs.zeroNativeDifferent ? 3n : 2n];
        }
        if (same(arg.address, p.f.origin)) {
          const sold = phase === "curve" ? 0n : targetSold, backing = phase === "eligible" ? 2n * eth : 0n;
          const v: Record<string, unknown> = { active: phase !== "graduated", graduated: phase === "graduated", executionVersion: 1, sold, backingReserve: backing,
            graduationSold: targetSold, GRADUATION_BACKING: knobs.wrongTarget ? 4n * eth : 2n * eth, VIRTUAL_ETH: 4n * eth,
            virtualToken: launchTokenSupplyWei * 9n / 5n, poolId: await testV4PoolId(key), positionTokenId: 1n };
          if (Object.hasOwn(v, arg.functionName)) return v[arg.functionName];
          if (arg.functionName === "quoteBuy") { const q = buyQuote(arg.args[0]); return peer && knobs.quoteConflict ? [q[0] + 1n, ...q.slice(1)] : q; }
          if (arg.functionName === "quoteSell") return [990n, 1000n, 10n];
        }
        if (same(arg.address, pins.engine[0])) {
          if (arg.functionName === "positions") return phase === "graduated" ? [1n, 1000n] : [0n, 0n];
          if (arg.functionName === "lpFeeLedger" && phase !== "graduated") return zeroAddress;
        }
        if (same(arg.address, p.f.token)) {
          if (arg.functionName === "balanceOf" && same(arg.args[0], p.f.origin)) return launchTokenSupplyWei - (phase === "curve" ? 0n : targetSold);
          if (arg.functionName === "balanceOf" && same(arg.args[0], p.f.creator)) return launchTokenSupplyWei;
          if (arg.functionName === "allowance") return same(arg.args[1], pins.permit2[0]) ? knobs.mined && knobs.request?.operation === "v4-sell" && height >= minedAt ? 0n : knobs.erc20Allowance : knobs.allowance;
        }
        if (same(arg.address, pins.permit2[0]) && arg.functionName === "allowance") return [knobs.mined && knobs.request?.operation === "v4-sell" && height >= minedAt ? 0n : knobs.permitAllowance, Number(p.current().timestamp + 1000n), 0];
        if (same(arg.address, pins.stateView[0])) return arg.functionName === "getSlot0" ? [2n ** 96n, 0, 0, 3000] : 1000n;
      }
      return Reflect.apply(original, target, [arg]);
    };
  } });
  const rpc = makeRpc(p.rpc), corroboratingRpc = makeRpc(p.corroboratingRpc, true);
  const context = () => ({ rpc, corroboratingRpc, anchor: { ...p.current(), ...(knobs.advance > 0n && { blockNumber: p.reviewNumber + knobs.advance,
    blockHash: p.point(p.reviewNumber + knobs.advance).blockHash, timestamp: knobs.expired ? p.current().timestamp + 180n : p.current().timestamp + (knobs.advance > 12n ? 12n : knobs.advance) }), ...(knobs.mined && { blockNumber: p.reviewNumber + 22n,
    blockHash: p.point(p.reviewNumber + 22n).blockHash, timestamp: BigInt(Date.parse(p.point(p.reviewNumber + 22n).timestamp) / 1000) }) }, approvalBinding: syntheticClaimApproval,
    ...(knobs.zeroPoster && { feePolicy: "nitro-zero-poster-corroborated-v1" }) }) as ProductionTradingContext;
  async function transaction() {
    const r = knobs.request!; return { hash: p.f.txHash, from: r.from, to: r.to, input: r.data, value: BigInt(r.value), nonce: Number(BigInt(r.nonce)),
      chainId: 4663, type: "eip1559", accessList: [], blockNumber: knobs.mined ? minedAt : null,
      blockHash: knobs.mined ? p.point(minedAt).blockHash : null, transactionIndex: knobs.mined ? 0 : null };
  }
  async function receipt() {
    const r = knobs.request!, base = { blockNumber: minedAt, blockHash: p.point(minedAt).blockHash, transactionHash: p.f.txHash, transactionIndex: 0, removed: false };
    let event!: object;
    const extra: object[] = [];
    if (r.operation === "buy" || r.operation === "buy-graduate" || r.operation === "sell") {
      const buy = r.operation !== "sell", [output, gross, fee, refund] = buy ? buyQuote(BigInt(r.amountWei)) : [BigInt(r.amountWei), 1000n, 10n, 0n];
      event = { address: r.curve, logIndex: 1, ...base, topics: encodeEventTopics({ abi: tradeAbi, eventName: "CurveTrade", args: { account: r.from, isBuy: buy } }),
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [output, gross, fee, refund, output, gross - fee]) };
      if(r.operation==="buy-graduate") extra.push(event);
    }
    if (r.operation === "graduate" || r.operation==="buy-graduate") {
      event = { address: r.curve, logIndex: 2, ...base, topics: encodeEventTopics({ abi: graduationAbi, eventName: "CurveGraduated", args: { poolId: await testV4PoolId(key), positionTokenId: 1n } }),
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [2n * eth, launchTokenSupplyWei * 2n / 5n, 0n, 0n]) };
    } else if (r.operation === "v4-buy" || r.operation === "v4-sell") {
      const buy = r.operation === "v4-buy", input = BigInt(r.amountWei), output = 10n ** 20n;
      event = { address: pins.poolManager[0], logIndex: 1, ...base, topics: encodeEventTopics({ abi: swapAbi, eventName: "Swap", args: { id: await testV4PoolId(key), sender: pins.router212[0] } }),
        data: encodeAbiParameters([{ type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }, { type: "uint24" }],
          [buy ? -input : output, buy ? output : -input, 2n ** 96n, 1000n, 0, 3000]) };
      const transfer = { address: r.token, logIndex: 2, ...base, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: buy ? pins.poolManager[0] : r.from, to: buy ? r.from : pins.poolManager[0] } }),
        data: encodeAbiParameters([{ type: "uint256" }], [buy ? output : input]) };
      return { status: "success", from: r.from, to: r.to, ...base, logs: [event, transfer] };
    } else if (r.operation === "v4-permit2-approve") {
      event = { address: pins.permit2[0], logIndex: 1, ...base, topics: encodeEventTopics({ abi: permitAbi, eventName: "Approval", args: { owner: r.from, token: r.token, spender: pins.router212[0] } }),
        data: encodeAbiParameters([{ type: "uint160" }, { type: "uint48" }], [BigInt(r.amountWei), Number(BigInt(r.deadline) + 720n)]) };
    } else if (r.operation === "approve" || r.operation === "v4-token-approve") {
      event = { address: r.token, logIndex: 1, ...base, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Approval", args: { owner: r.from, spender: r.operation === "approve" ? r.curve : pins.permit2[0] } }),
        data: encodeAbiParameters([{ type: "uint256" }], [BigInt(r.amountWei)]) };
    }
    return { status: knobs.reverted ? "reverted" : "success", from: r.from, to: r.to, ...base, logs: knobs.reverted ? [] : [...extra,event] };
  }
  const directory = () => ({ ...p.directory(), profile: "rmt-curve-fixed-supply-security-v2", checkpoint: { ...p.point(context().anchor.blockNumber - 20n),
    ...(!knobs.mined && context().anchor.blockNumber - 20n > p.reviewNumber && { timestamp: new Date(Number(p.current().timestamp + 12n) * 1000).toISOString() }), confirmations: 20,
    finality: "l2-confirmed", l1Finality: "unverified" } });
  const activity = async () => {
    if (knobs.missingIndex) return null;
    const c = directory(), r = await receipt();
    return { checkpoint: c.checkpoint, events: r.logs.map((l: any) => ({ address: l.address, blockNumber: l.blockNumber.toString(), blockHash: l.blockHash,
      transactionHash: l.transactionHash, transactionIndex: l.transactionIndex, logIndex: l.logIndex, topics: l.topics, data: knobs.wrongIndex ? "0x" : l.data })) } as any;
  };
  const fetcher: typeof fetch = async (url, init) => {
    if (new Headers(init?.headers).get("Authorization") !== "Bearer local-only") return Response.json({}, { status: 401 });
    if (new URL(String(url)).pathname.startsWith("/curve-launches")) return Response.json(directory());
    return Response.json({}, { status: 404 });
  };
  return { p, knobs, context, rpc, corroboratingRpc, activity, fetcher, buyQuote, directory };
}
