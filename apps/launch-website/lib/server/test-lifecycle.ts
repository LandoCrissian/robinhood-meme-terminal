import { encodeFunctionData, erc20Abi, getAddress, parseAbi, parseAbiItem, parseEventLogs, toHex,
  type Address, type Hash, type Hex } from "viem";
import { isTransactionHash, testCreationChain } from "../test-creation";
import { curveBuySignature, curveGraduateSignature, curveSellSignature, curveTradeFeeBps, isLifecycleAmount, isLifecycleOperation,
  isLifecycleSlippage, isTestLifecycleRequest, lifecycleCalldataMatches, sameLifecycleValue as same, sameTestLifecycleRequest,
  type TestLifecycleOperation, type TestLifecycleQuote, type TestLifecycleRequest, type TestLifecycleState,
  type TestLifecycleVerification } from "../test-lifecycle";
import { configuredCurveFixture, fixtureAddress, fixtureRpc, verifyCurveFixture, type CurveFixture } from "./curve-fixture";
import { readFixtureLaunches, type FixtureLaunch } from "./fixture-discovery";
import { readDraftBody } from "./launch-draft";

const deadlineWindow = 180n;
const reviewWindow = 4n;
const recoveryWindow = 256n;
const targetBacking = 2n * 10n ** 18n;
const curveAbi = parseAbi([
  curveBuySignature, curveSellSignature, curveGraduateSignature,
  "function factory() view returns (address)", "function token() view returns (address)", "function active() view returns (bool)",
  "function executionVersion() view returns (uint32)", "function sold() view returns (uint256)",
  "function graduated() view returns (bool)", "function backingReserve() view returns (uint256)",
  "function graduationSold() view returns (uint256)", "function GRADUATION_BACKING() view returns (uint256)",
  "function VIRTUAL_ETH() view returns (uint256)", "function virtualToken() view returns (uint256)",
  "function quoteBuy(uint256 grossBudget) view returns (uint256 tokensOut,uint256 grossUsed,uint256 fee,uint256 refund)",
  "function quoteSell(uint256 tokenIn) view returns (uint256 ethOut,uint256 grossReleased,uint256 fee)",
]);
const factoryAbi = parseAbi(["function originCurveForToken(address token) view returns (address)", "function curveForToken(address token) view returns (address)"]);
const registryAbi = parseAbi(["function project(address token) view returns (address factory,address curve,uint32 version,address engine,uint64 migrations)"]);
const graduationEvent = parseAbiItem("event CurveGraduated(bytes32 indexed poolId,uint256 indexed positionTokenId,uint256 nativeUsed,uint256 tokenUsed,uint256 nativeDust,uint256 tokenDust)");
const tradeEvent = parseAbiItem("event CurveTrade(address indexed account,bool indexed isBuy,uint256 tokenAmount,uint256 grossNative,uint256 fee,uint256 nativeRefund,uint256 sold,uint256 backingReserve)");
const maxBlockTransactions = 32;
const maxReceiptLogs = 128;
const headers = { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store" };
const reply = (body: object, status = 200) => Response.json(body, { status, headers });
const unavailable = (status = 200) => reply({ status: "unavailable" }, status);
const invalid = (reason: string, status = 422) => reply({ status: "invalid", reason }, status);
const address = (value: string) => getAddress(value.toLowerCase());
const pickKeys = (record: Record<string, unknown>, names: string[], optional: string[] = []) =>
  names.every(name => Object.hasOwn(record, name)) && Object.keys(record).every(name => names.includes(name) || optional.includes(name));
type Rpc = ReturnType<typeof fixtureRpc>;
type Head = Awaited<ReturnType<typeof verifyCurveFixture>>;
type Lifecycle = NonNullable<FixtureLaunch["lifecycle"]>;

async function readCurveIdentity(rpc: Rpc, fixture: CurveFixture, token: Address, blockNumber: bigint) {
  const at = { blockNumber };
  const [origin, current, project] = await Promise.all([
    rpc.readContract({ address: fixture.factory, abi: factoryAbi, functionName: "originCurveForToken", args: [token], ...at }),
    rpc.readContract({ address: fixture.factory, abi: factoryAbi, functionName: "curveForToken", args: [token], ...at }),
    rpc.readContract({ address: fixture.registry, abi: registryAbi, functionName: "project", args: [token], ...at }),
  ]);
  // A successor requires its own runtime and historical acceptance. The local website exercises the pinned V1 profile.
  if (!fixtureAddress(origin) || !same(current, origin) || !same(project[0], fixture.factory) || !same(project[1], origin)
      || project[2] !== 1 || project[4] !== 0n) throw new Error("Unverified curve identity");
  return origin;
}

async function currentState(rpc: Rpc, fixture: CurveFixture, head: Head, token: Address, account?: Address) {
  const discovery = await readFixtureLaunches(fixture, token);
  if (discovery.status !== "ready" || discovery.launches.length !== 1) throw new Error("Indexed curve unavailable");
  const launch = discovery.launches[0];
  const lifecycle = launch.lifecycle;
  if (!lifecycle || BigInt(lifecycle.observed.blockNumber) > head.number) throw new Error("Canonical lifecycle unavailable");
  const at = { blockNumber: head.number };
  const curveAddress = await readCurveIdentity(rpc, fixture, token, at.blockNumber);
  if (!same(curveAddress, launch.initialCurve) || !same(curveAddress, lifecycle.activeCurve)) throw new Error("Curve identity mismatch");
  const curve = { address: curveAddress, abi: curveAbi, ...at } as const;
  const erc20 = { address: token, abi: erc20Abi, ...at } as const;
  const [curveToken, curveFactory, version, active, graduated, sold, backing, graduationSold, graduationBacking,
    virtualEth, virtualToken, totalSupply, inventory, balances, current] = await Promise.all([
    rpc.readContract({ ...curve, functionName: "token" }),
    rpc.readContract({ ...curve, functionName: "factory" }),
    rpc.readContract({ ...curve, functionName: "executionVersion" }),
    rpc.readContract({ ...curve, functionName: "active" }),
    rpc.readContract({ ...curve, functionName: "graduated" }),
    rpc.readContract({ ...curve, functionName: "sold" }),
    rpc.readContract({ ...curve, functionName: "backingReserve" }),
    rpc.readContract({ ...curve, functionName: "graduationSold" }),
    rpc.readContract({ ...curve, functionName: "GRADUATION_BACKING" }),
    rpc.readContract({ ...curve, functionName: "VIRTUAL_ETH" }),
    rpc.readContract({ ...curve, functionName: "virtualToken" }),
    rpc.readContract({ ...erc20, functionName: "totalSupply" }),
    rpc.readContract({ ...erc20, functionName: "balanceOf", args: [curveAddress] }),
    account ? Promise.all([
      rpc.getBalance({ address: account, ...at }),
      rpc.readContract({ ...erc20, functionName: "balanceOf", args: [account] }),
      rpc.readContract({ ...erc20, functionName: "allowance", args: [account, curveAddress] }),
    ]) : undefined,
    rpc.getBlock({ ...at, includeTransactions: false }),
  ]);
  if (!same(curveToken, token) || !same(curveFactory, fixture.factory) || version !== 1 || (!active && !graduated) ||
      !same(current.hash, head.hash) || totalSupply.toString() !== launch.totalSupplyWei || graduationBacking !== targetBacking ||
      graduationSold !== totalSupply * 3n / 5n || virtualEth !== 2n * targetBacking || virtualToken !== totalSupply * 9n / 5n ||
      sold > graduationSold || backing > graduationBacking || ((!graduated) && inventory !== totalSupply - sold) ||
      (graduated !== (lifecycle.phase === "graduated"))) throw new Error("Curve state and indexed evidence disagree");
  const phase = graduated ? "graduated" : sold === graduationSold && backing === graduationBacking ? "eligible" : "curve";
  const state: TestLifecycleState & { lifecycle: Lifecycle } = {
    factory: fixture.factory, token, curve: curveAddress, phase, blockNumber: toHex(head.number), blockHash: head.hash,
    inventoryWei: inventory.toString(), backingWei: backing.toString(), soldWei: sold.toString(), totalSupplyWei: totalSupply.toString(),
    targetBackingWei: graduationBacking.toString(), targetSoldWei: graduationSold.toString(), feeBps: curveTradeFeeBps,
    priceWei: graduated ? null : ((virtualEth + backing) * 10n ** 18n / (virtualToken - sold)).toString(),
    lifecycle,
    ...(balances ? { account: { ethWei: balances[0].toString(), tokenWei: balances[1].toString(), allowanceWei: balances[2].toString() } } : {}),
  };
  return state;
}

async function prepare(
  rpc: Rpc, fixture: CurveFixture, head: Head, body: Record<string, unknown>, token: Address, from: Address,
  operation: TestLifecycleOperation, amountWei: string, slippageBps: number,
) {
  const prior = body.prior;
  if (prior !== undefined && (!isTestLifecycleRequest(prior) || !same(prior.factory, fixture.factory) || !same(prior.blockHash, fixture.deploymentBlockHash)
      || BigInt(prior.blockNumber) !== fixture.deploymentBlock || !same(prior.token, token) || !same(prior.from, from) ||
      prior.operation !== operation || prior.amountWei !== amountWei || prior.slippageBps !== slippageBps)) return invalid("stale-review");
  const [state, confirmedNonce, pendingNonce, code] = await Promise.all([
    currentState(rpc, fixture, head, token, from),
    rpc.getTransactionCount({ address: from, blockNumber: head.number }),
    rpc.getTransactionCount({ address: from, blockTag: "pending" }),
    rpc.getCode({ address: from, blockNumber: head.number }),
  ]);
  if (state.phase === "graduated" || (state.phase === "eligible" && operation === "buy")) return invalid("curve-closed");
  if (operation === "graduate" && state.phase !== "eligible") return invalid("graduation-not-ready");
  if ((code && code !== "0x") || confirmedNonce !== pendingNonce) return invalid("wallet-pending");
  if (!state.account) return unavailable();
  const nonce = toHex(pendingNonce);
  const reviewBlockNumber = prior ? BigInt(prior.reviewBlockNumber) : head.number;
  const deadline = prior ? BigInt(prior.deadline) : head.timestamp + deadlineWindow;
  const reviewBlock = prior ? await rpc.getBlock({ blockNumber: reviewBlockNumber, includeTransactions: false }) : head;
  if (prior && (!same(prior.reviewBlockHash, reviewBlock.hash) || !same(prior.curve, state.curve) || !same(prior.nonce, nonce)
      || reviewBlockNumber > head.number || head.number - reviewBlockNumber > reviewWindow || deadline <= head.timestamp ||
      deadline !== reviewBlock.timestamp + deadlineWindow)) return invalid("stale-review");
  const amount = BigInt(amountWei);
  const curve = { address: state.curve, abi: curveAbi, blockNumber: head.number } as const;
  let output = 0n;
  let fee = 0n;
  let refund = 0n;
  if (operation === "sell" || operation === "approve") {
    if (BigInt(state.account.tokenWei) < amount) return invalid("insufficient-balance");
    if (operation === "sell" && BigInt(state.account.allowanceWei) !== amount) return invalid("insufficient-allowance");
    if (operation === "approve" && BigInt(state.account.allowanceWei) === amount) return invalid("amount-unavailable");
  }
  if (operation === "buy") {
    if (BigInt(state.account.ethWei) <= amount) return invalid("insufficient-balance");
    const [quoted, gross, charge, unused] = await rpc.readContract({ ...curve, functionName: "quoteBuy", args: [amount] });
    if (gross + unused !== amount || charge < 1n || feeFor(gross) !== charge || quoted + BigInt(state.soldWei) > BigInt(state.targetSoldWei)) {
      return invalid("amount-unavailable");
    }
    output = quoted;
    fee = charge;
    refund = unused;
  } else if (operation === "sell" || operation === "approve") {
    const [quoted, gross, charge] = await rpc.readContract({ ...curve, functionName: "quoteSell", args: [amount] });
    if (gross !== quoted + charge || quoted < 1n || charge < 1n || feeFor(gross) !== charge) return invalid("amount-unavailable");
    if (operation === "sell") {
      output = quoted;
      fee = charge;
    }
  }
  const minimum = output * BigInt(10_000 - slippageBps) / 10_000n;
  if ((operation === "buy" || operation === "sell") && (output === 0n || minimum === 0n)) return invalid("amount-unavailable");
  const value = operation === "buy" ? amount : 0n;
  const to = operation === "approve" ? token : state.curve;
  const data = operation === "approve" ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [state.curve, amount] })
    : operation === "buy" ? encodeFunctionData({ abi: curveAbi, functionName: "buy", args: [minimum, deadline] })
    : operation === "sell" ? encodeFunctionData({ abi: curveAbi, functionName: "sell", args: [amount, minimum, deadline] })
    : encodeFunctionData({ abi: curveAbi, functionName: "graduate", args: [deadline] });
  const request: TestLifecycleRequest = { operation, token, curve: state.curve, factory: fixture.factory, from, to, data, value: toHex(value),
    chainId: testCreationChain, nonce, blockNumber: toHex(fixture.deploymentBlock), blockHash: fixture.deploymentBlockHash,
    reviewBlockNumber: toHex(reviewBlockNumber), reviewBlockHash: reviewBlock.hash, deadline: deadline.toString(), amountWei,
    minimumOutputWei: minimum.toString(), slippageBps };
  if (prior && !sameTestLifecycleRequest(request, prior)) return invalid("stale-review");
  const [gas, gasPrice, latest] = await Promise.all([
    rpc.estimateGas({ account: from, to, data, value, blockNumber: head.number }),
    rpc.getGasPrice(),
    rpc.getBlock({ blockTag: "latest", includeTransactions: false }),
  ]);
  if (!same(latest.hash, head.hash)) return invalid("stale-review");
  if (BigInt(state.account.ethWei) < value + gas * gasPrice) return invalid("insufficient-balance");
  const quote: TestLifecycleQuote = { inputWei: amountWei, outputWei: output.toString(), minimumOutputWei: minimum.toString(),
    feeWei: fee.toString(), refundWei: refund.toString(), gasUnits: gas.toString(), gasPriceWei: gasPrice.toString() };
  return reply({ status: "prepared", request, quote, state });
}

function feeFor(gross: bigint) {
  return (gross * BigInt(curveTradeFeeBps) + 9_999n) / 10_000n;
}

/** A direct account nonce is monotone across canonical blocks. Locate the first block that consumed
 * it without scanning transaction histories or trusting a wallet's response hash. */
async function recoverHash(rpc: Rpc, head: Head, request: TestLifecycleRequest): Promise<Hash | "pending" | "unavailable"> {
  const nonce = Number(BigInt(request.nonce));
  let lower = BigInt(request.reviewBlockNumber);
  let upper = head.number;
  if (await rpc.getTransactionCount({ address: request.from, blockNumber: head.number }) <= nonce) {
    return head.timestamp <= BigInt(request.deadline) ? "pending" : "unavailable";
  }
  if (upper - lower > recoveryWindow) lower = upper - recoveryWindow;
  if (await rpc.getTransactionCount({ address: request.from, blockNumber: lower }) > nonce) return "unavailable";
  while (upper - lower > 1n) {
    const middle = lower + (upper - lower) / 2n;
    if (await rpc.getTransactionCount({ address: request.from, blockNumber: middle }) <= nonce) lower = middle;
    else upper = middle;
  }
  const block = await rpc.getBlock({ blockNumber: upper, includeTransactions: true });
  if (block.transactions.length > maxBlockTransactions) return "unavailable";
  const matches = block.transactions.filter(tx => same(tx.from, request.from) && tx.nonce === nonce);
  return matches.length === 1 ? matches[0].hash : "unavailable";
}

function requestIdentity(fixture: CurveFixture, request: TestLifecycleRequest) {
  return same(request.factory, fixture.factory) && same(request.blockHash, fixture.deploymentBlockHash)
    && BigInt(request.blockNumber) === fixture.deploymentBlock;
}

async function verify(
  rpc: Rpc, fixture: CurveFixture, head: Head, request: TestLifecycleRequest, transactionHash?: Hex,
): Promise<TestLifecycleVerification> {
  if (!requestIdentity(fixture, request) || !await lifecycleCalldataMatches(request)) return { status: "unavailable" };
  const reviewed = await rpc.getBlock({ blockNumber: BigInt(request.reviewBlockNumber), includeTransactions: false });
  if (!same(reviewed.hash, request.reviewBlockHash) || reviewed.timestamp + deadlineWindow !== BigInt(request.deadline)
      || reviewed.number > head.number || !same(await readCurveIdentity(rpc, fixture, request.token, reviewed.number), request.curve)) {
    return { status: "unavailable" };
  }
  const found = transactionHash ?? await recoverHash(rpc, head, request);
  if (found === "pending" || found === "unavailable") return { status: found };
  const tx = await rpc.getTransaction({ hash: found });
  if (!same(tx.hash, found) || !same(tx.from, request.from) || !same(tx.to, request.to) || !same(tx.input, request.data) ||
      tx.nonce !== Number(BigInt(request.nonce)) || tx.value !== BigInt(request.value) || tx.chainId !== 31337) return { status: "unavailable" };
  const bound = { transactionHash: found };
  if (tx.blockNumber === null) return { status: "pending", ...bound };
  // Missing receipt or archive reads remain unavailable. The client keeps the original request and hash.
  const receipt = await rpc.getTransactionReceipt({ hash: found });
  const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  const confirmedReceipt = same(receipt.transactionHash, found) && same(receipt.from, request.from) && same(receipt.to, request.to) &&
    tx.blockNumber === receipt.blockNumber && tx.transactionIndex === receipt.transactionIndex && same(tx.blockHash, receipt.blockHash) &&
    same(block.hash, receipt.blockHash) && same(block.transactions[receipt.transactionIndex], found) &&
    block.number === receipt.blockNumber && receipt.blockNumber > reviewed.number && receipt.blockNumber <= head.number &&
    receipt.logs.length <= maxReceiptLogs && receipt.logs.every(log => !log.removed && log.logIndex !== null && log.logIndex >= 0 &&
      log.transactionIndex === receipt.transactionIndex && log.blockNumber === receipt.blockNumber && same(log.blockHash, receipt.blockHash) &&
      same(log.transactionHash, found) && log.data.length <= 8194);
  if (!confirmedReceipt || new Set(receipt.logs.map(log => log.logIndex)).size !== receipt.logs.length) return { status: "unavailable" };
  const discovery = await readFixtureLaunches(fixture, request.token);
  const indexed = discovery.status === "ready" && discovery.launches.length === 1 &&
    BigInt(discovery.checkpoint.blockNumber) >= receipt.blockNumber && head.number >= receipt.blockNumber + 2n;
  if (receipt.status === "reverted") return { status: "reverted", indexed, ...bound };
  if (receipt.status !== "success" || (request.operation !== "approve" && block.timestamp > BigInt(request.deadline))) return { status: "unavailable" };
  if (request.operation === "approve") {
    const events = parseEventLogs({ abi: erc20Abi, eventName: "Approval", logs: receipt.logs.filter(log => same(log.address, request.token)) });
    const [approved] = events;
    return events.length === 1 && same(approved.args.owner, request.from) && same(approved.args.spender, request.curve) &&
      approved.args.value === BigInt(request.amountWei)
      ? { status: "confirmed", indexed, ...bound } : { status: "unavailable" };
  }
  const lifecycle = discovery.status === "ready" ? discovery.launches[0]?.lifecycle : undefined;
  if (request.operation === "graduate") {
    const events = parseEventLogs({ abi: [graduationEvent], logs: receipt.logs.filter(log => same(log.address, request.curve)) });
    const [event] = events;
    if (events.length !== 1) return { status: "unavailable" };
    const graduation = lifecycle?.graduation;
    if (!indexed || !graduation) return { status: "pending", settlementPending: true, ...bound };
    const g = event.args;
    if (lifecycle.phase !== "graduated" || !same(graduation.transactionHash, found) || !same(graduation.blockHash, receipt.blockHash) ||
        graduation.blockNumber !== receipt.blockNumber.toString() || !same(graduation.poolId, g.poolId) ||
        graduation.positionTokenId !== g.positionTokenId.toString() || graduation.nativeUsedWei !== g.nativeUsed.toString() ||
        graduation.tokenUsedWei !== g.tokenUsed.toString() || graduation.nativeDustWei !== g.nativeDust.toString() ||
        graduation.tokenDustWei !== g.tokenDust.toString()) return { status: "unavailable" };
    const canonical = await rpc.getBlock({ blockNumber: receipt.blockNumber, includeTransactions: false });
    return same(canonical.hash, receipt.blockHash) ? { status: "confirmed", indexed: true, ...bound } : { status: "unavailable" };
  }
  const events = parseEventLogs({ abi: [tradeEvent], logs: receipt.logs.filter(log => same(log.address, request.curve)) });
  const [event] = events;
  if (events.length !== 1) return { status: "unavailable" };
  const trade = event.args;
  const buy = request.operation === "buy";
  const output = buy ? trade.tokenAmount : trade.grossNative - trade.fee;
  if (!same(trade.account, request.from) || trade.isBuy !== buy || output < BigInt(request.minimumOutputWei) ||
      trade.fee < 1n || feeFor(trade.grossNative) !== trade.fee
      || (buy ? trade.grossNative + trade.nativeRefund !== BigInt(request.amountWei) :
        trade.tokenAmount !== BigInt(request.amountWei) || trade.nativeRefund !== 0n)) return { status: "unavailable" };
  const durable = lifecycle?.trades.find(row => same(row.transactionHash, found) && row.logIndex === event.logIndex);
  if (!indexed || !durable) return { status: "pending", settlementPending: true, ...bound };
  if (!same(durable.blockHash, receipt.blockHash) || durable.blockNumber !== receipt.blockNumber.toString() ||
      !same(durable.account, request.from) || durable.side !== request.operation || durable.tokenWei !== trade.tokenAmount.toString() ||
      durable.nativeWei !== trade.grossNative.toString() || durable.feeWei !== trade.fee.toString() ||
      durable.nativeRefundWei !== trade.nativeRefund.toString()) return { status: "unavailable" };
  const canonical = await rpc.getBlock({ blockNumber: receipt.blockNumber, includeTransactions: false });
  return same(canonical.hash, receipt.blockHash)
    ? { status: "confirmed", indexed: true, outputWei: output.toString(), feeWei: durable.feeWei, refundWei: trade.nativeRefund.toString(), ...bound }
    : { status: "unavailable" };
}

export async function handleTestLifecycle(request: Request) {
  const fixture = configuredCurveFixture(request.headers);
  if (!fixture || request.method !== "POST") return unavailable(404);
  if (request.headers.get("origin") !== fixture.origin || new URL(request.url).search) return invalid("origin", 403);
  const length = request.headers.get("content-length");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096))) return invalid("request", 400);
  try {
    const payload = await readDraftBody(request.body);
    if (payload.tooLarge) return invalid("request", 413);
    if (!payload.input || typeof payload.input !== "object" || Array.isArray(payload.input)) return invalid("request", 400);
    const body = payload.input as Record<string, unknown>;
    if (body.action === "state" && pickKeys(body, ["action", "token"], ["account"]) && fixtureAddress(body.token) &&
        (body.account === undefined || fixtureAddress(body.account))) {
      const rpc = fixtureRpc(fixture);
      const head = await verifyCurveFixture(fixture, rpc);
      const state = await currentState(rpc, fixture, head, address(body.token), body.account === undefined ? undefined : address(body.account));
      return reply({ status: "ready", state });
    }
    if (body.action === "prepare" && pickKeys(body, ["action", "token", "account", "operation", "amountWei", "slippageBps"], ["prior"]) &&
        fixtureAddress(body.token) && fixtureAddress(body.account) && isLifecycleOperation(body.operation) &&
        isLifecycleAmount(body.operation, body.amountWei) && isLifecycleSlippage(body.operation, body.slippageBps)) {
      const rpc = fixtureRpc(fixture);
      const head = await verifyCurveFixture(fixture, rpc);
      return await prepare(rpc, fixture, head, body, address(body.token), address(body.account), body.operation, body.amountWei, body.slippageBps);
    }
    if (body.action === "verify" && pickKeys(body, ["action", "request"], ["transactionHash"]) && isTestLifecycleRequest(body.request) &&
        (body.transactionHash === undefined || isTransactionHash(body.transactionHash))) {
      const rpc = fixtureRpc(fixture);
      const head = await verifyCurveFixture(fixture, rpc);
      return reply(await verify(rpc, fixture, head, body.request, body.transactionHash));
    }
  } catch {
    return unavailable();
  }
  return invalid("request", 400);
}
