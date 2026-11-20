import { readFileSync } from "node:fs";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, hashTypedData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { productionClaimFeePolicy, type ClaimExecutionReview } from "../claim-profiles";
import { claimSafeTypedData } from "./claim-profiles";
import { launchRegistrationKind } from "../launch-terms";
import { fixture, productionArchive } from "./claim-profile-test-fixture";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";
import { productionEarningsContext, type EarningsRpc } from "./earnings-contracts";
import { ea, eh } from "./earnings-test-fixture";
import { createProductionEarningsBudget, type handleProductionEarningsClaim } from "./production-earnings";

const canonical = JSON.parse(readFileSync(new URL("../../../../packages/contracts/test/fixtures/task090-canonical-v4-runtime.json", import.meta.url), "utf8"));
const nitroAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const syntheticClaimApproval = "a".repeat(64);

/** Archived public runtime preimages, wholly synthetic storage/headers/fees,
 * synthetic accounts and credentials. This fixture makes no network requests. */
export function productionClaimFixture(kind: "eoa" | "metamask-7702" | "safe-1.4.1" = "eoa", graduated = true) {
  const f = fixture(kind, graduated), original = f.context.rpc;
  const now = BigInt(Math.floor(Date.now() / 1000)) - 30n, reviewNumber = curveProductionDeployment.blockNumber + 100n;
  const map = new Map<string, Address>([
    [f.context.factory.toLowerCase(), curveProductionPins.factory[0]], [f.context.registry.toLowerCase(), curveProductionPins.registry[0]],
    [f.context.graduation.address.toLowerCase(), curveProductionPins.engine[0]], [f.context.graduation.guard.toLowerCase(), curveProductionPins.guard[0]],
    [f.context.poolManager.address.toLowerCase(), curveProductionPins.poolManager[0]], [f.context.positionManager.address.toLowerCase(), curveProductionPins.positionManager[0]],
    [f.operations.toLowerCase(), curveProductionDeployment.operating], [f.reserve.toLowerCase(), curveProductionDeployment.reserve],
  ]);
  const unmap = new Map([...map].map(([a, b]) => [b.toLowerCase(), a]));
  const toProduction = (n: bigint) => n === 1n ? curveProductionDeployment.blockNumber : n === 2n ? curveProductionDeployment.blockNumber + 1n : reviewNumber + n - 10n;
  const toLocal = (n: bigint) => n === curveProductionDeployment.blockNumber ? 1n : n === curveProductionDeployment.blockNumber + 1n ? 2n : 10n + n - reviewNumber;
  const hashAt = (n: bigint) => n === curveProductionDeployment.blockNumber ? curveProductionDeployment.blockHash
    : n === curveProductionDeployment.blockNumber + 1n ? eh(2) : n >= reviewNumber && n <= reviewNumber + 2n ? eh(Number(toLocal(n))) : eh(Number(n));
  const timeAt = (n: bigint) => now + n - reviewNumber;
  const convert = (value: any): any => {
    if (typeof value === "string") return map.get(value.toLowerCase()) ?? (/^0x0{24}[0-9a-f]{40}$/i.test(value)
      && map.has(("0x" + value.slice(-40)).toLowerCase()) ? "0x" + "0".repeat(24) + map.get(("0x" + value.slice(-40)).toLowerCase())!.slice(2).toLowerCase() : value);
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)]));
    return value;
  };
  const receiptPoint = (value: any) => ({ ...convert(value), blockNumber: toProduction(value.blockNumber), blockHash: hashAt(toProduction(value.blockNumber)),
    ...(value.logs && { logs: value.logs.map((log: any) => receiptPoint(log)) }) });
  const knobs = { review: null as ClaimExecutionReview | null, offline: false, peerNonce: false, missingNitro: false,
    wrongRuntime: false, stale: false, missingIndex: false, wrongIndex: false, reorg: false, traceFailure: false,
    poster: 10000n, l1Base: 10n, componentBase: 2n, headerBase: 2n, gasPrice: 2n,
    nativeL1Base: 0n, nativeCalldata: 0n, nativeL2Base: 2n, missingNative: false, nativeConflict: false,
    calls: [] as string[] };
  const makeRpc = (id: "official" | "pocket") => new Proxy(original, { get(target, property) {
    if (property === "transport") return { url: id === "official" ? "https://rpc.mainnet.chain.robinhood.com" : "https://robinhood.api.pocket.network" };
    if (property === "estimateMaxPriorityFeePerGas") return async () => 1n;
    const value = Reflect.get(target, property); if (typeof value !== "function") return value;
    return async (arg: any = {}) => {
      knobs.calls.push(String(property)); if (knobs.offline && id === "pocket") throw Error("synthetic provider offline");
      const localArg = { ...arg, ...(arg.address && { address: unmap.get(arg.address.toLowerCase()) ?? arg.address }),
        ...(typeof arg.blockNumber === "bigint" && { blockNumber: toLocal(arg.blockNumber) }) };
      if (property === "getChainId") return 4663;
      if (property === "getBlock") {
        const number = arg.blockNumber ?? toProduction(f.baseState.head), local = toLocal(number);
        const base = local >= 1n ? await original.getBlock({ blockNumber: local, includeTransactions: arg.includeTransactions }) : { transactions: [] };
        return { ...base, number, hash: knobs.reorg && number === reviewNumber ? eh(9999) : hashAt(number), timestamp: timeAt(number), baseFeePerGas: knobs.headerBase,
          ...(local === 11n && f.baseState.mined && arg.includeTransactions && knobs.review?.outer && { transactions: [{ hash: f.txHash,
            from: knobs.review.outer.from, to: knobs.review.outer.to, nonce: Number(BigInt(knobs.review.outer.nonce)), input: knobs.review.outer.data,
            value: 0n, chainId: 4663, type: "eip1559", blockNumber: number, blockHash: hashAt(number), transactionIndex: 0 }] }) };
      }
      if (property === "getCode") {
        const entry = [...Object.values(productionArchive.runtimes), ...Object.values(canonical.contracts)]
          .find((item: any) => same(item.address, arg.address)) as { code: Hex } | undefined;
        if (entry) return knobs.wrongRuntime ? "0x6002" : entry.code;
      }
      if (property === "getGasPrice") return knobs.gasPrice;
      if (property === "getTransactionCount" && kind === "safe-1.4.1" && same(arg.address, f.creator)) return 0;
      if (property === "getTransactionCount") return arg.blockTag === "pending" ? f.state.payerNonce
        : f.baseState.mined && (localArg.blockNumber ?? f.baseState.head) >= 11n ? f.state.receiptNonce + (id === "pocket" && knobs.peerNonce ? 1 : 0) : 0;
      if (property === "call" && BigInt(arg.to) === 200n) {
        if (knobs.missingNitro) throw Error("synthetic Nitro unavailable");
        return { data: encodeFunctionResult({ abi: nitroAbi, functionName: "gasEstimateComponents", result: [50000n, knobs.poster, knobs.componentBase, knobs.l1Base] }) };
      }
      if (property === "readContract" && BigInt(arg.address) === 108n) {
        if (knobs.missingNative) throw Error("synthetic native policy unavailable");
        if (arg.functionName === "getL1BaseFeeEstimate") return knobs.nativeL1Base;
        if (arg.functionName === "getPricesInWei") { const native = knobs.nativeL2Base + (id === "pocket" && knobs.nativeConflict ? 1n : 0n);
          return [0n, knobs.nativeCalldata, 0n, native, 0n, native]; }
      }
      if (property === "readContract" && kind === "safe-1.4.1" && same(arg.address, f.creator)) {
        if (arg.functionName === "nonce" && f.baseState.mined) return localArg.blockNumber >= 11n ? 1n : 0n;
        if (arg.functionName === "getTransactionHash") {
          const [to, , data, , , , , , , nonce] = arg.args;
          return hashTypedData(claimSafeTypedData(4663, f.creator, { to, value: "0", data, operation: 0,
            safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: String(nonce) }));
        }
      }
      if (property === "readContract" && arg.functionName === "creationFeesAccrued" && f.baseState.mined)
        return localArg.blockNumber >= 11n ? 0n : f.baseState.factoryFees;
      if (property === "getTransactionReceipt") {
        const receipt = receiptPoint(await original.getTransactionReceipt(arg));
        if (arg.hash !== f.txHash) return receipt;
        const r = knobs.review;
        if (kind === "safe-1.4.1" && r?.wallet.safe) {
          const abi = parseAbi(["event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)"]);
          receipt.logs.push({ address: r.actor, topics: encodeEventTopics({ abi, eventName: "ExecutionSuccess", args: { txHash: r.wallet.safe.transactionHash } }),
            data: encodeAbiParameters([{ type: "uint256" }], [0n]), blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
            transactionHash: f.txHash, transactionIndex: 0, logIndex: 4, removed: false });
        }
        return { ...receipt, gasUsed: 28000n, ...(r?.outer && { from: r.outer.from, to: r.outer.to }) };
      }
      if (property === "getTransaction") return { ...receiptPoint(await original.getTransaction(arg)), chainId: 4663,
        from: knobs.review!.outer!.from, to: knobs.review!.outer!.to, input: knobs.review!.outer!.data,
        gas: BigInt(knobs.review!.outer!.gas!), maxFeePerGas: BigInt(knobs.review!.outer!.maxFeePerGas!),
        maxPriorityFeePerGas: BigInt(knobs.review!.outer!.maxPriorityFeePerGas!) };
      if (property === "request" && knobs.traceFailure) throw Error("synthetic trace unavailable");
      if (property === "request" && kind === "safe-1.4.1" && knobs.review?.outer) {
        const r = knobs.review; return { type: "CALL", from: r.outer!.from, to: r.outer!.to, input: r.outer!.data, value: "0x0",
          calls: [convert(await Reflect.apply(value, target, [localArg]))] };
      }
      return convert(await Reflect.apply(value, target, [localArg]));
    };
  } }) as EarningsRpc;
  const rpc = makeRpc("official"), corroboratingRpc = makeRpc("pocket");
  const current = () => { const number = toProduction(f.baseState.head); return { blockNumber: number, blockHash: hashAt(number), timestamp: timeAt(number) }; };
  const point = (number: bigint) => ({ blockNumber: number.toString(), blockHash: hashAt(number), timestamp: new Date(Number(timeAt(number)) * 1000).toISOString() });
  const registration = { ...convert(f.registration), chainId: 4663 as const, creation: { ...f.registration.creation, ...point(toProduction(2n)) } };
  const directory = (recipient = f.creator) => {
    const p = point(current().blockNumber - 20n), beneficiary = same(recipient, curveProductionDeployment.operating) ? "operations" : "creator";
    return { schemaVersion: 1, profile: "rmt-creator-earnings-v1", chainId: 4663, recipient, status: knobs.stale ? "stale" : "ready",
      observedAt: new Date(Number(now) * 1000).toISOString(), checkpoint: { ...p, confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" },
      deployment: { factory: curveProductionPins.factory[0], registry: curveProductionPins.registry[0], blockNumber: String(curveProductionDeployment.blockNumber), blockHash: curveProductionDeployment.blockHash },
      launches: [{ ...registration, kind: launchRegistrationKind, status: "created", engineVersion: 1, tokenDecimals: 18, intentId: eh(500),
        name: "Evidence Project", symbol: "EVID", projectURI: "", projectRegistrationLogIndex: 2,
        creationFee: { amountWei: "400000000000000", refundWei: "0", recipient: curveProductionDeployment.operating, logIndex: 3 },
        checkpoint: { ...point(toProduction(2n)), confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" }, beneficiaryRoles: [beneficiary], feeEvidence: "contract-read-required" }],
      nextCursor: null, history: { status: "unsupported", source: "historical-v4-v6", feeEvidence: "unsupported" } };
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (new Headers(init?.headers).get("Authorization") !== "Bearer local-only") return Response.json({}, { status: 401 });
    if (url.pathname === "/curve-earnings") return Response.json(directory(url.searchParams.get("recipient") as Address));
    if (url.pathname === "/curve-activity") {
      if (knobs.missingIndex) return Response.json({}, { status: 503 });
      const receipt = await rpc.getTransactionReceipt({ hash: f.txHash });
      return Response.json({ schemaVersion: 1, profile: "rmt-curve-activity-v1", chainId: 4663, status: "ready", deployment: directory().deployment,
        observedAt: new Date(Number(now) * 1000).toISOString(), token: url.searchParams.get("token"), transactionHash: f.txHash,
        checkpoint: { ...point(current().blockNumber - 20n), confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" },
        events: receipt.logs.map(log => ({ address: log.address, logIndex: log.logIndex, blockNumber: log.blockNumber!.toString(),
          blockHash: log.blockHash, transactionHash: log.transactionHash, transactionIndex: log.transactionIndex, topics: log.topics, data: knobs.wrongIndex ? "0x" : log.data })) });
    }
    return Response.json({}, { status: 404 });
  };
  type Options = NonNullable<Parameters<typeof handleProductionEarningsClaim>[1]>;
  const config = { approvalBinding: syntheticClaimApproval, scope: "claims", release: {} };
  const options: Options = { env: { RMT_LAUNCH_HISTORY_INDEXER_URL: "https://synthetic-indexer.invalid", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "local-only" },
    fetch: fetcher, budget: createProductionEarningsBudget(), configured: (() => config) as unknown as Options["configured"],
    resolve: (async () => ({ ...config, rpc, corroboratingRpc, anchor: current(), feePolicy: productionClaimFeePolicy })) as unknown as Options["resolve"] };
  const contexts = () => [{ id: "official", context: productionEarningsContext(rpc, point(current().blockNumber)) },
    { id: "pocket", context: productionEarningsContext(corroboratingRpc, point(current().blockNumber)) }] as const;
  return { f, registration, knobs, options, contexts, current, point, directory, rpc, corroboratingRpc, reviewNumber,
    prepare: (operation = "curve-claim") => ({ action: "prepare", operation, beneficiary: operation === "creation-fees" ? curveProductionDeployment.operating : f.creator,
      account: f.input.account, kind, ...(operation !== "creation-fees" && { token: f.token }), ...(kind === "safe-1.4.1" && { safeAddress: f.creator }) }) };
}
