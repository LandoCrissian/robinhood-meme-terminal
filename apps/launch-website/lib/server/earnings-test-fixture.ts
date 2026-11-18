import { encodeAbiParameters, encodeEventTopics, getContractAddress, keccak256, parseAbi, zeroAddress, type Address, type Hash } from "viem";
import { launchTokenSupplyWei } from "../launch-terms";
import type { EarningsClaimRequest } from "../earnings-claims";
import type { EarningsReadContext, EarningsRegistration, EarningsRpc } from "./earnings-contracts";

export const ea = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Address;
export const eh = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hash;
export const fixtureCode = "0x6001600055" as const;
export const fixtureCodeHash = keccak256(fixtureCode);
export function earningsTestFixture(options: { overlap?: boolean; treasury?: boolean; graduated?: boolean; afterClaim?: boolean } = {}) {
  const factory = ea(100001), registry = ea(100002), token = ea(100003), origin = ea(100004), engine = ea(100005),
    creator = ea(100006), operations = options.overlap ? creator : ea(100007), reserve = ea(100008), treasury = options.treasury ? ea(100009) : zeroAddress,
    manager = ea(100010), positions = ea(100011), guard = ea(100012), lpLedger = ea(100013);
  const ledger = getContractAddress({ from: origin, nonce: 1n });
  const birth = eh(400), txHash = eh(401);
  const state = { head: 10n, activeCurve: origin, version: 1, migrated: false, pendingNonce: 0, traceAvailable: true, traceInvalid: false,
    reorgReview: false, reorgReceipt: false, wrongRuntime: false, wrongPolicy: false, wrongReceipt: false, wrongToken: false,
    wrongPosition: false, wrongPool: false, failReads: false, rejectSimulation: false, contractBeneficiary: false, delegatedBeneficiary: false, factoryFees: 400000000000000n, revertReceipt: false,
    receiptNative: 75n, receiptToken: 0n, afterClaim: options.afterClaim ?? false, extraCurveFee: 0n, mined: false,
    afterCollection: false, request: null as EarningsClaimRequest | null,
    traceCalls: 0, contractCalls: 0 };
  const timestamp = (number: bigint) => 1700000000n + number;
  const block = (number: bigint, full = false) => ({ number, hash: number === 10n && state.reorgReview ? eh(990) : number === 11n && state.reorgReceipt ? eh(991) : eh(Number(number)),
    timestamp: timestamp(number), transactions: number === 2n ? [birth] : number === 11n && state.mined ? [full ? transaction() : txHash] : [] });
  const creationAbi = parseAbi(["event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)"]);
  const creationLog = { address: factory, topics: encodeEventTopics({ abi: creationAbi, eventName: "CurveCreated", args: { token, curve: origin, creator } }),
    data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint16" }, { type: "string" }, { type: "string" }, { type: "string" }],
      [eh(500), launchTokenSupplyWei, ledger, treasury, options.treasury ? 2250 : 0, "Evidence Project", "EVID", ""]),
    blockNumber: 2n, blockHash: eh(2), transactionHash: birth, transactionIndex: 0, logIndex: 1, removed: false };
  function transaction() {
    return { hash: txHash, from: state.request?.from ?? creator, to: state.request?.to ?? ledger, input: state.request?.data ?? "0x4e71d92d", value: 0n,
      nonce: 0, chainId: 31337, type: "eip1559", blockNumber: 11n, blockHash: eh(11), transactionIndex: 0 };
  }
  function claimReceipt() {
    const op = state.request?.operation ?? "curve-claim";
    const eventName = op === "curve-claim" ? "CurveFeeClaimed" : op === "creation-fees" ? "CreationFeesClaimed" : op === "lp-collect" ? "LpFeesCollected" : "LpFeesClaimed";
    const abi = parseAbi(["event CurveFeeClaimed(address indexed recipient,uint256 amount)", "event CreationFeesClaimed(address indexed recipient,uint256 amount)",
      "event LpFeesClaimed(address indexed recipient,uint256 nativeAmount,uint256 tokenAmount)", "event LpFeesCollected(address indexed token,uint256 indexed positionTokenId,address indexed ledger,uint256 nativeAmount,uint256 tokenAmount)"]);
    const recipient = state.request?.beneficiary ?? creator;
    const args = eventName === "LpFeesCollected" ? { token, positionTokenId: 1n, ledger: lpLedger } : { recipient };
    const event = { address: state.request?.to ?? ledger, topics: encodeEventTopics({ abi, eventName, args }),
      data: eventName === "CurveFeeClaimed" || eventName === "CreationFeesClaimed" ? encodeAbiParameters([{ type: "uint256" }], [state.receiptNative])
        : encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [state.receiptNative, state.receiptToken]),
      blockNumber: 11n, blockHash: eh(11), transactionHash: txHash, transactionIndex: 0, logIndex: 1, removed: false };
    const transfer = { ...event, address: token, logIndex: 2, topics: encodeEventTopics({ abi: parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]), eventName: "Transfer",
      args: { from: op === "lp-collect" ? manager : lpLedger, to: recipient } }), data: encodeAbiParameters([{ type: "uint256" }], [state.receiptToken]) };
    return { status: state.revertReceipt ? "reverted" : "success", transactionHash: txHash, from: state.request?.from ?? creator, to: state.request?.to ?? ledger,
      blockNumber: 11n, blockHash: state.wrongReceipt ? eh(994) : eh(11), transactionIndex: 0, logs: state.revertReceipt ? [] : [event, ...(state.receiptToken > 0n ? [transfer] : [])] };
  }
  const curveTotal = (at: bigint) => state.afterClaim && at >= 11n ? 105n : 100n + (at >= 11n ? state.extraCurveFee : 0n);
  const split = (total: bigint) => { const platform = total / 10n, project = total - platform, t = options.treasury ? project * 2250n / 9000n : 0n;
    return [project - t, t, platform / 2n, platform - platform / 2n]; };
  const curveBuckets = (at: bigint) => split(curveTotal(at));
  const lpTotal = (at: bigint) => [100n + (state.afterCollection && at >= 11n ? state.receiptNative : 0n), 200n + (state.afterCollection && at >= 11n ? state.receiptToken : 0n)];
  const lpBuckets = (at: bigint) => { const values = lpTotal(at).map(split); return [0, 1, 2, 3].map(index => [values[0][index], values[1][index]]); };
  const lpClaimed = (at: bigint) => [20n + (state.afterClaim && at >= 11n ? state.receiptNative : 0n), 30n + (state.afterClaim && at >= 11n ? state.receiptToken : 0n)];
  const recipients = [creator, treasury, operations, reserve];
  const credit = (who: string, at: bigint, lp: boolean) => {
    let native = 0n, tokens = 0n;
    recipients.forEach((recipient, index) => { if (recipient.toLowerCase() === who.toLowerCase()) { native += lp ? lpBuckets(at)[index][0] : curveBuckets(at)[index]; tokens += lp ? lpBuckets(at)[index][1] : 0n; } });
    if (who.toLowerCase() === creator.toLowerCase()) { native -= lp ? lpClaimed(at)[0] : state.afterClaim && at >= 11n ? 95n : 20n; tokens -= lp ? lpClaimed(at)[1] : 0n; }
    return lp ? [native, tokens] : native;
  };
  const key = { currency0: zeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: guard };
  const packed = BigInt.asUintN(24, -887220n) << 8n | BigInt.asUintN(24, 887220n) << 32n;
  const rpc = {
    getChainId: async () => 31337,
    getBlock: async (arg: { blockNumber?: bigint; includeTransactions?: boolean }) => block(arg.blockNumber ?? state.head, arg.includeTransactions),
    getCode: async (arg: { address: string }) => [creator, operations, reserve].some(who => arg.address.toLowerCase() === who.toLowerCase())
      ? state.delegatedBeneficiary && arg.address.toLowerCase() === creator.toLowerCase() ? "0xef0100" + ea(777777).slice(2)
        : state.contractBeneficiary && arg.address.toLowerCase() === creator.toLowerCase() ? fixtureCode : "0x"
      : state.wrongRuntime && arg.address.toLowerCase() === factory.toLowerCase() ? "0x6002" : fixtureCode,
    getBalance: async (arg: { address: string; blockNumber: bigint }) => arg.address.toLowerCase() === ledger.toLowerCase()
      ? curveTotal(arg.blockNumber) - (state.afterClaim && arg.blockNumber >= 11n ? 95n : 20n)
      : arg.address.toLowerCase() === lpLedger.toLowerCase() ? lpTotal(arg.blockNumber)[0] - lpClaimed(arg.blockNumber)[0] : 10n ** 20n,
    getTransactionCount: async (arg: { blockNumber?: bigint; blockTag?: string }) => arg.blockTag === "pending" ? state.pendingNonce : Number(state.mined && (arg.blockNumber ?? state.head) >= 11n ? 1 : 0),
    getGasPrice: async () => 2n, estimateGas: async () => { if (state.rejectSimulation) throw Error("reverted"); return 30000n; },
    call: async () => { if (state.rejectSimulation) throw Error("reverted"); return { data: "0x" }; },
    getTransaction: async () => transaction(),
    getTransactionReceipt: async (arg: { hash: Hash }) => arg.hash === birth ? { status: "success", transactionHash: birth, blockNumber: 2n, blockHash: state.wrongReceipt ? eh(993) : eh(2), transactionIndex: 0, logs: [creationLog] } : claimReceipt(),
    request: async () => {
      state.traceCalls++; if (!state.traceAvailable) throw Error("unsupported");
      const r = state.request!; const payer = r.operation === "lp-collect" ? manager : r.ledger;
      return { type: "CALL", from: r.from, to: r.to, input: r.data, value: "0x0", calls: [
        { type: "CALL", from: payer, to: state.traceInvalid ? reserve : r.beneficiary, input: "0x", value: "0x" + state.receiptNative.toString(16) },
      ] };
    },
    readContract: async (arg: { address: string; functionName: string; args?: unknown[]; blockNumber: bigint }) => {
      state.contractCalls++; if (state.failReads) throw Error("provider unavailable");
      const lp = arg.address.toLowerCase() === lpLedger.toLowerCase();
      switch (arg.functionName) {
        case "projectRegistry": return registry; case "graduationEngine": return engine; case "tokenSupply": case "totalSupply": return launchTokenSupplyWei;
        case "factory": return factory; case "poolManager": return manager; case "positionManager": return positions; case "initializationGuard": return guard;
        case "originCurveForToken": return origin; case "curveForToken": return state.activeCurve;
        case "project": return [factory, state.activeCurve, state.version, state.activeCurve, state.migrated ? 1n : 0n];
        case "revenueLedger": return ledger; case "token": return state.wrongToken ? reserve : token; case "creator": return creator; case "curve": return origin;
        case "activeCurve": return state.activeCurve; case "operatingRecipient": return operations; case "futureReserveRecipient": return reserve;
        case "treasury": return state.wrongPolicy ? reserve : treasury; case "treasuryShareBps": return options.treasury ? 2250 : 0;
        case "totalAccrued": return lp ? lpTotal(arg.blockNumber) : curveTotal(arg.blockNumber);
        case "totalClaimed": return lp ? lpClaimed(arg.blockNumber) : state.afterClaim && arg.blockNumber >= 11n ? 95n : 20n;
        case "bucketAccrued": return lp ? lpBuckets(arg.blockNumber)[Number(arg.args![0])] : curveBuckets(arg.blockNumber)[Number(arg.args![0])];
        case "claimable": return credit(String(arg.args![0]), arg.blockNumber, lp);
        case "positions": return options.graduated ? [1n, 1000n] : [0n, 0n]; case "lpFeeLedger": return options.graduated ? lpLedger : zeroAddress;
        case "canonicalPoolKey": return state.wrongPool ? { ...key, fee: 500 } : key; case "ownerOf": return engine; case "getApproved": return zeroAddress;
        case "getPositionLiquidity": return state.wrongPosition ? 999n : 1000n; case "getPoolAndPositionInfo": return [key, packed];
        case "previewLpFees": return state.afterCollection && arg.blockNumber >= 11n ? [0n, 0n] : [4n, 7n]; case "engine": return engine;
        case "balanceOf": return lpTotal(arg.blockNumber)[1] - lpClaimed(arg.blockNumber)[1];
        case "creationFeesAccrued": return state.factoryFees;
        default: throw Error("Unexpected test read " + arg.functionName);
      }
    },
  } as unknown as EarningsRpc;
  const context: EarningsReadContext = { chainId: 31337, rpc, factory, factoryRuntimeHash: fixtureCodeHash, registry, registryRuntimeHash: fixtureCodeHash,
    deploymentBlock: 1n, deploymentBlockHash: eh(1), checkpoint: { blockNumber: "10", blockHash: eh(10), timestamp: new Date(Number(timestamp(10n)) * 1000).toISOString() },
    graduation: { address: engine, runtimeHash: fixtureCodeHash, guard, guardRuntimeHash: fixtureCodeHash }, poolManager: { address: manager, runtimeHash: fixtureCodeHash },
    positionManager: { address: positions, runtimeHash: fixtureCodeHash } };
  const registration: EarningsRegistration = { chainId: 31337, factory, projectRegistry: registry, token, initialCurve: origin, revenueLedger: ledger, creator,
    treasury: options.treasury ? treasury : null, treasuryShareBps: options.treasury ? 2250 : 0, totalSupplyWei: launchTokenSupplyWei.toString(),
    creation: { blockNumber: "2", blockHash: eh(2), timestamp: new Date(Number(timestamp(2n)) * 1000).toISOString(), transactionHash: birth, logIndex: 1 } };
  return { context, registration, state, creator, operations, reserve, ledger, lpLedger, token, origin, txHash, block };
}
