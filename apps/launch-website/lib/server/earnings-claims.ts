import { erc20Abi, getAddress, keccak256, parseAbi, parseEventLogs, toHex, zeroAddress, type Address, type Hash, type Hex } from "viem";
import { assertNativeTransferProof } from "../../../../packages/launchpad-common/native-proof.mjs";
import { claimCalldataMatches, encodeEarningsClaim, isEarningsClaimOperation, isEarningsClaimRequest, sameEarningsClaimRequest,
  type EarningsClaimAmounts,
  type EarningsClaimOperation, type EarningsClaimQuote, type EarningsClaimRequest, type EarningsClaimVerification, type EarningsPreparedClaim } from "../earnings-claims";
import { isTransactionHash } from "../test-creation";
import { configuredCurveFixture, fixtureAddress, type CurveFixture } from "./curve-fixture";
import { earningsAbi, lpEarningsAbi, earningsUnavailable, fixtureEarningsContext, readEarningsContracts, readFactoryCreationFees, verifyEarningsContext,
  type EarningsPoint, type EarningsReadContext, type EarningsRegistration, type EarningsRpc } from "./earnings-contracts";
import { readDraftBody } from "./launch-draft";

const headers = { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const reply = (body: object, status = 200) => Response.json(body, { status, headers });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const addr = (a: string) => getAddress(a.toLowerCase());
function must(ok: unknown): asserts ok { if (!ok) throw new Error("Claim evidence unavailable or conflicting"); }
const keys = (value: Record<string, unknown>, names: string[], optional: string[] = []) => names.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => names.includes(key) || optional.includes(key));
const asPoint = (b: { number: bigint; hash: Hex | null; timestamp: bigint }): EarningsPoint => {
  must(b.hash); return { blockNumber: b.number.toString(), blockHash: b.hash, timestamp: new Date(Number(b.timestamp) * 1000).toISOString() };
};

// No environment value or caller-supplied approval can activate 4663 here.
// Production release, scanner disposition and physical-wallet acceptance are
// separate owner approvals. This task ships preparation/recovery for 31337 only.
export const productionEarningsExecutionEnabled = false;
export function earningsClaimReadiness() {
  return { status: "blocked", chainId: 4663, executionEnabled: productionEarningsExecutionEnabled,
    holds: ["22 retained high findings and failed security gates", "separate owner transaction activation", "production claim settlement/provider acceptance", "physical wallet acceptance"] } as const;
}
export async function handleProductionEarningsClaim(_request: Request) {
  return reply({ status: "unavailable", executionEnabled: false }, 404);
}

async function readFixturePayload(fixture: CurveFixture, url: URL): Promise<unknown> {
  const key = process.env.RMT_CURVE_FIXTURE_READ_KEY;
  must(key && /^[0-9a-f]{64}$/.test(key) && !/^0+$/.test(key));
  must(url.origin === fixture.indexerUrl);
  const response = await fetch(url, { headers: { "X-RMT-Fixture-Key": key }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2500) });
  must(response.ok && response.body && response.headers.get("content-type")?.split(";")[0] === "application/json"
    && Number(response.headers.get("content-length")) <= 65536);
  const reader = response.body.getReader(), buffer = new Uint8Array(65536);
  let size = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; must(size + chunk.value.byteLength <= buffer.length); buffer.set(chunk.value, size); size += chunk.value.byteLength; }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
}

async function readFixtureBirth(fixture: CurveFixture, token: Address, recipient: Address) {
  const url = new URL("/earnings", fixture.indexerUrl);
  url.searchParams.set("recipient", recipient.toLowerCase()); url.searchParams.set("token", token.toLowerCase()); url.searchParams.set("limit", "1");
  const data = await readFixturePayload(fixture, url) as {
    schemaVersion: number; profile: string; chainId: number; status: string; recipient: string;
    deployment: { factory: string; registry: string; blockNumber: string; blockHash: string };
    checkpoint: EarningsPoint; launches: EarningsRegistration[]; nextCursor: unknown;
  };
  must(data.schemaVersion === 1 && data.profile === "rmt-creator-earnings-v1" && data.chainId === 31337 && data.status === "ready"
    && same(data.recipient, recipient) && same(data.deployment.factory, fixture.factory) && same(data.deployment.registry, fixture.registry)
    && data.deployment.blockNumber === fixture.deploymentBlock.toString() && same(data.deployment.blockHash, fixture.deploymentBlockHash)
    && Array.isArray(data.launches) && data.launches.length === 1 && same(data.launches[0].token, token) && data.nextCursor === null);
  return { registration: data.launches[0], checkpoint: data.checkpoint };
}

async function readFixtureClaimIndexed(fixture: CurveFixture, context: EarningsReadContext, request: EarningsClaimRequest,
  hash: Hash, blockHash: Hash, logIndex: number, amounts: EarningsClaimAmounts) {
  try {
    const url = new URL("/earnings/activity", fixture.indexerUrl); url.searchParams.set("transaction", hash);
    const data = await readFixturePayload(fixture, url) as { schemaVersion: number; profile: string; chainId: number; status: string; transactionHash: string;
      checkpoint: EarningsPoint & { confirmations: number; finality: string; l1Finality: string };
      activities: Array<{ kind: string; token: string | null; ledger: string; account: string; recipient: string; nativeWei: string; tokenWei: string;
        transactionHash: string; blockNumber: string; blockHash: string; logIndex: number }> };
    if (data.schemaVersion !== 1 || data.profile !== "rmt-creator-earnings-v1" || data.chainId !== 31337 || data.status !== "ready"
      || !same(data.transactionHash, hash) || !Array.isArray(data.activities) || data.activities.length > 128
      || data.checkpoint.confirmations !== 2 || data.checkpoint.finality !== "local-synthetic" || data.checkpoint.l1Finality !== "not-applicable"
      || !/^[1-9][0-9]{0,15}$/.test(data.checkpoint.blockNumber) || !isTransactionHash(data.checkpoint.blockHash)) return false;
    const kind = request.operation === "creation-fees" ? "creation-payout" : request.operation.startsWith("lp-claim") ? "lp-claim" : request.operation;
    const rows = data.activities.filter(row => row.kind === kind && same(row.transactionHash, hash) && same(row.blockHash, blockHash) && row.logIndex === logIndex);
    const row = rows[0];
    if (rows.length !== 1 || !row || !same(row.ledger, request.ledger) || !same(row.account, request.from) || !same(row.recipient, request.beneficiary)
      || row.nativeWei !== amounts.nativeWei || row.tokenWei !== amounts.tokenWei || !/^[1-9][0-9]{0,15}$/.test(row.blockNumber)
      || BigInt(row.blockNumber) > BigInt(data.checkpoint.blockNumber)
      || (request.operation === "creation-fees" ? row.token !== null : !same(row.token ?? "", request.token))) return false;
    const [eventBlock, checkpoint] = await Promise.all([context.rpc.getBlock({ blockNumber: BigInt(row.blockNumber) }),
      context.rpc.getBlock({ blockNumber: BigInt(data.checkpoint.blockNumber) })]);
    return same(eventBlock.hash!, blockHash) && same(checkpoint.hash!, data.checkpoint.blockHash)
      && new Date(Number(checkpoint.timestamp) * 1000).toISOString() === data.checkpoint.timestamp;
  } catch { return false; }
}

export async function prepareEarningsClaim(input: {
  context: EarningsReadContext; registration?: EarningsRegistration; beneficiary: Address; account: Address;
  operation: EarningsClaimOperation; prior?: EarningsClaimRequest;
}): Promise<EarningsPreparedClaim | { status: "invalid" | "unavailable"; reason?: string }> {
  try {
    const { context, operation, account } = input;
    if (context.chainId !== 31337) return { status: "unavailable", reason: "production-disabled" };
    const head = await verifyEarningsContext(context);
    const [confirmedNonce, pendingNonce, accountCode, gasPrice, balance] = await Promise.all([
      context.rpc.getTransactionCount({ address: account, blockNumber: head.number }), context.rpc.getTransactionCount({ address: account, blockTag: "pending" }),
      context.rpc.getCode({ address: account, blockNumber: head.number }), context.rpc.getGasPrice(), context.rpc.getBalance({ address: account, blockNumber: head.number }),
    ]);
    if (accountCode && /^0xef0100[0-9a-f]{40}$/i.test(accountCode)) return { status: "invalid", reason: "delegation-profile-required" };
    if (accountCode && accountCode !== "0x") return { status: "invalid", reason: "contract-wallet-execution-required" };
    if (confirmedNonce !== pendingNonce) return { status: "invalid", reason: "pending-account-nonce" };
    let token: Address = zeroAddress, origin: Address = zeroAddress, to = context.factory, ledger = context.factory, beneficiary = input.beneficiary;
    let native = 0n, erc20 = 0n, positionTokenId: string | null = null, principalLiquidityWei: string | null = null, targetRuntimeHash = context.factoryRuntimeHash;
    if (operation === "creation-fees") {
      const fees = await readFactoryCreationFees(context, input.beneficiary);
      if (fees.status !== "ready") return { status: "unavailable" };
      beneficiary = fees.recipient; native = BigInt(fees.availableNativeWei);
    } else {
      if (!input.registration) return { status: "unavailable" };
      const state = await readEarningsContracts(context, input.registration, input.beneficiary);
      if (state.status !== "ready" || state.rights.roles.length === 0) return { status: "unavailable" };
      token = state.token; origin = state.originalCurve;
      if (operation === "curve-claim") {
        ledger = state.curve.ledger; to = ledger; targetRuntimeHash = state.curve.runtimeHash; native = BigInt(state.curve.claimableNativeWei);
      } else {
        if (state.lp.status !== "ready") return { status: "invalid", reason: "not-graduated" };
        ledger = state.lp.ledger; to = ledger; targetRuntimeHash = state.lp.runtimeHash;
        positionTokenId = state.lp.positionTokenId; principalLiquidityWei = state.lp.liquidityWei;
        if (operation === "lp-collect") {
          to = context.graduation.address; targetRuntimeHash = context.graduation.runtimeHash; beneficiary = ledger;
          native = BigInt(state.lp.uncollectedNativeWei); erc20 = BigInt(state.lp.uncollectedTokenWei);
        } else {
          native = operation === "lp-claim-token" ? 0n : BigInt(state.lp.claimableNativeWei);
          erc20 = operation === "lp-claim-native" ? 0n : BigInt(state.lp.claimableTokenWei);
        }
      }
      if (operation !== "lp-collect" && !same(account, input.beneficiary)) return { status: "invalid", reason: "beneficiary-wallet-required" };
    }
    if (native === 0n && erc20 === 0n) return { status: "invalid", reason: "no-fees" };
    const prior = input.prior;
    let review = head;
    if (prior) {
      if (!isEarningsClaimRequest(prior) || !await claimCalldataMatches(prior)) return { status: "invalid", reason: "stale-review" };
      review = await context.rpc.getBlock({ blockNumber: BigInt(prior.reviewBlockNumber) });
      if (!review.hash || !same(review.hash, prior.reviewBlockHash) || head.number < review.number
        || Number(head.timestamp) >= prior.reviewExpiresAt || native < BigInt(prior.expectedNativeWei) || erc20 < BigInt(prior.expectedTokenWei)) {
        return { status: "invalid", reason: "stale-review" };
      }
    }
    const deadline = operation === "lp-collect" ? (review.timestamp + 180n).toString() : null;
    const data = await encodeEarningsClaim(operation, token, deadline);
    const request: EarningsClaimRequest = {
      schemaVersion: 1, operation, chainId: "0x7a69", from: account, to, data, value: "0x0", nonce: toHex(pendingNonce), factory: context.factory,
      token, originCurve: origin, ledger, beneficiary, discoveryRecipient: operation === "creation-fees" ? beneficiary : input.beneficiary,
      factoryRuntimeHash: context.factoryRuntimeHash, targetRuntimeHash, deploymentBlockNumber: toHex(context.deploymentBlock), deploymentBlockHash: context.deploymentBlockHash,
      reviewBlockNumber: toHex(review.number), reviewBlockHash: review.hash!, reviewTimestamp: Number(review.timestamp), reviewExpiresAt: Number(review.timestamp) + 180,
      deadline, expectedNativeWei: prior?.expectedNativeWei ?? native.toString(), expectedTokenWei: prior?.expectedTokenWei ?? erc20.toString(), positionTokenId, principalLiquidityWei,
    };
    if (!isEarningsClaimRequest(request) || (prior && !sameEarningsClaimRequest(request, prior))) return { status: "invalid", reason: "stale-review" };
    const [gas] = await Promise.all([
      context.rpc.estimateGas({ account, to, data, value: 0n, blockNumber: head.number }),
      context.rpc.call({ account, to, data, value: 0n, blockNumber: head.number }),
    ]);
    if (gas < 21000n || gas > 30_000_000n || gasPrice <= 0n || balance < gas * gasPrice) return { status: "invalid", reason: "insufficient-network-funds" };
    if (!same((await context.rpc.getBlock({ blockNumber: head.number })).hash!, context.checkpoint.blockHash)) return { status: "unavailable" };
    const quote: EarningsClaimQuote = { gasUnits: gas.toString(), gasPriceWei: gasPrice.toString(), estimatedNetworkFeeWei: (gas * gasPrice).toString(),
      amounts: { nativeWei: native.toString(), tokenWei: erc20.toString() }, transactions: 1, onchainDeadline: deadline !== null,
      amountSemantics: operation === "lp-collect" ? "original-position-fees-may-grow" : operation === "creation-fees" ? "factory-global-fees-may-grow" : "current-credit-may-grow" };
    return { status: "prepared", request, quote };
  } catch { return { status: "unavailable" }; }
}

export async function recoverEarningsClaimHash(rpc: EarningsRpc, head: { number: bigint }, request: EarningsClaimRequest): Promise<Hash | "pending" | "unavailable"> {
  const nonce = Number(BigInt(request.nonce));
  if (await rpc.getTransactionCount({ address: request.from, blockNumber: head.number }) <= nonce) return "pending";
  let lower = BigInt(request.reviewBlockNumber), upper = head.number;
  if (upper - lower > 256n) lower = upper - 256n;
  if (lower > upper || await rpc.getTransactionCount({ address: request.from, blockNumber: lower }) > nonce) return "unavailable";
  while (upper - lower > 1n) {
    const middle = lower + (upper - lower) / 2n;
    if (await rpc.getTransactionCount({ address: request.from, blockNumber: middle }) <= nonce) lower = middle; else upper = middle;
  }
  const block = await rpc.getBlock({ blockNumber: upper, includeTransactions: true });
  if (block.transactions.length > 40) return "unavailable";
  const found = block.transactions.filter(tx => same(tx.from, request.from) && tx.nonce === nonce);
  return found.length === 1 ? found[0].hash : "unavailable";
}

const claimEvents = parseAbi([
  "event CurveFeeClaimed(address indexed recipient,uint256 amount)", "event LpFeesClaimed(address indexed recipient,uint256 nativeAmount,uint256 tokenAmount)",
  "event LpFeesCollected(address indexed token,uint256 indexed positionTokenId,address indexed ledger,uint256 nativeAmount,uint256 tokenAmount)",
  "event CreationFeesClaimed(address indexed recipient,uint256 amount)",
]);

export async function verifyEarningsClaim(input: { context: EarningsReadContext; registration?: EarningsRegistration; request: EarningsClaimRequest;
  transactionHash?: Hash; indexed?: (hash: Hash, blockHash: Hash, logIndex: number, amounts: EarningsClaimAmounts) => Promise<boolean> }): Promise<EarningsClaimVerification> {
  const { context, request } = input;
  try {
    if (context.chainId !== 31337 || !isEarningsClaimRequest(request) || request.chainId !== "0x7a69" || !await claimCalldataMatches(request)
      || !same(request.factory, context.factory) || !same(request.factoryRuntimeHash, context.factoryRuntimeHash)
      || BigInt(request.deploymentBlockNumber) !== context.deploymentBlock || !same(request.deploymentBlockHash, context.deploymentBlockHash)
      || (request.operation === "lp-collect" && (!same(request.to, context.graduation.address) || !same(request.targetRuntimeHash, context.graduation.runtimeHash)))) return { status: "unavailable" };
    const head = await verifyEarningsContext(context);
    const reviewed = await context.rpc.getBlock({ blockNumber: BigInt(request.reviewBlockNumber) });
    if (!same(reviewed.hash!, request.reviewBlockHash) || Number(reviewed.timestamp) !== request.reviewTimestamp) return { status: "unavailable", reason: "review-reorged" };
    const found = input.transactionHash ?? await recoverEarningsClaimHash(context.rpc, head, request);
    if (found === "pending" || found === "unavailable") return { status: found };
    const tx = await context.rpc.getTransaction({ hash: found });
    const bound = { transactionHash: found };
    if (!same(tx.from, request.from) || !same(tx.to ?? "", request.to) || !same(tx.input, request.data) || tx.value !== 0n
      || tx.chainId !== 31337 || tx.nonce !== Number(BigInt(request.nonce)) || !["legacy", "eip2930", "eip1559"].includes(tx.type)) return { status: "unavailable", ...bound };
    if (tx.blockNumber === null) return { status: "pending", ...bound };
    const receipt = await context.rpc.getTransactionReceipt({ hash: found });
    const block = await context.rpc.getBlock({ blockNumber: receipt.blockNumber });
    if (!same(receipt.transactionHash, found) || !same(receipt.from, request.from) || !same(receipt.to ?? "", request.to)
      || tx.blockNumber !== receipt.blockNumber || tx.transactionIndex !== receipt.transactionIndex || !same(tx.blockHash!, receipt.blockHash)
      || !same(block.hash!, receipt.blockHash) || !same(block.transactions[receipt.transactionIndex] as string, found)
      || receipt.blockNumber <= reviewed.number || receipt.blockNumber > head.number || receipt.logs.length > 128
      || new Set(receipt.logs.map(log => log.logIndex)).size !== receipt.logs.length
      || !receipt.logs.every(log => !log.removed && log.logIndex !== null && log.logIndex >= 0 && same(log.transactionHash!, found)
        && same(log.blockHash!, receipt.blockHash) && log.blockNumber === receipt.blockNumber && log.transactionIndex === receipt.transactionIndex && log.data.length <= 8194)) {
      return { status: "unavailable", ...bound };
    }
    if (receipt.status === "reverted") return { status: "reverted", ...bound };
    if (receipt.status !== "success" || (request.deadline !== null && block.timestamp > BigInt(request.deadline))) return { status: "unavailable", ...bound };
    const [atReview, atReceipt] = await Promise.all([context.rpc.getCode({ address: request.to, blockNumber: reviewed.number }), context.rpc.getCode({ address: request.to, blockNumber: receipt.blockNumber })]);
    if (!atReview || !atReceipt || !same(keccak256(atReview), request.targetRuntimeHash) || !same(keccak256(atReceipt), request.targetRuntimeHash)) return { status: "unavailable", ...bound };
    const eventName = request.operation === "curve-claim" ? "CurveFeeClaimed" : request.operation === "creation-fees" ? "CreationFeesClaimed"
      : request.operation === "lp-collect" ? "LpFeesCollected" : "LpFeesClaimed";
    const events = parseEventLogs({ abi: claimEvents, eventName, strict: true, logs: receipt.logs.filter(log => same(log.address, request.to)) });
    if (events.length !== 1) return { status: "unavailable", ...bound };
    const event = events[0];
    const args = event.args as { recipient?: Address; amount?: bigint; nativeAmount?: bigint; tokenAmount?: bigint; token?: Address; positionTokenId?: bigint; ledger?: Address };
    const native = args.nativeAmount ?? args.amount ?? 0n, erc20 = args.tokenAmount ?? 0n;
    if (native < BigInt(request.expectedNativeWei) || erc20 < BigInt(request.expectedTokenWei)
      || (request.operation === "lp-claim-token" && native !== 0n) || (request.operation === "lp-claim-native" && erc20 !== 0n)
      || (native === 0n && erc20 === 0n)) return { status: "unavailable", ...bound };
    if (request.operation === "lp-collect") {
      if (!same(args.token ?? "", request.token) || !same(args.ledger ?? "", request.ledger) || args.positionTokenId?.toString() !== request.positionTokenId) return { status: "unavailable", ...bound };
    } else if (!same(args.recipient ?? "", request.beneficiary)) return { status: "unavailable", ...bound };
    // Re-read immutable policy, liabilities and permanent custody at the receipt
    // block, independent of current/indexed balance changes in later blocks.
    const receiptContext = { ...context, checkpoint: asPoint(block), historicalReceipt: true as const };
    if (request.operation === "creation-fees") {
      const fees = await readFactoryCreationFees(receiptContext, request.beneficiary);
      if (fees.status !== "ready" || !same(fees.recipient, request.beneficiary)) return { status: "unavailable", ...bound };
    } else {
      if (!input.registration) return { status: "unavailable", ...bound };
      const snapshot = await readEarningsContracts(receiptContext, input.registration, request.discoveryRecipient);
      if (snapshot.status !== "ready" || !same(snapshot.originalCurve, request.originCurve) || !same(snapshot.token, request.token)
        || !same(snapshot.curve.ledger, request.operation === "curve-claim" ? request.ledger : snapshot.curve.ledger)
        || (request.operation.startsWith("lp-") && (snapshot.lp.status !== "ready" || !same(snapshot.lp.ledger, request.ledger)
          || snapshot.lp.positionTokenId !== request.positionTokenId || snapshot.lp.liquidityWei !== request.principalLiquidityWei))) return { status: "unavailable", ...bound };
      if (request.operation === "lp-collect") {
        const [beforeAccrued, afterAccrued] = await Promise.all([reviewed.number, receipt.blockNumber].map(blockNumber => context.rpc.readContract({
          address: request.ledger, abi: lpEarningsAbi, functionName: "totalAccrued", blockNumber,
        })));
        if (afterAccrued[0] < beforeAccrued[0] + native || afterAccrued[1] < beforeAccrued[1] + erc20) return { status: "unavailable", ...bound };
      } else {
        const isCurve = request.operation === "curve-claim";
        const beforeBuckets = await Promise.all([0n, 1n, 2n, 3n].map(index => context.rpc.readContract({ address: request.ledger,
          abi: isCurve ? earningsAbi : lpEarningsAbi, functionName: "bucketAccrued", args: [index], blockNumber: reviewed.number } as never)));
        const beforeCredit = await context.rpc.readContract({ address: request.ledger, abi: isCurve ? earningsAbi : lpEarningsAbi,
          functionName: "claimable", args: [request.beneficiary], blockNumber: reviewed.number } as never);
        const roles = ["creator", "treasury", "operations", "reserve"];
        const indices = snapshot.rights.roles.map(role => roles.indexOf(role));
        const credited = (asset: number) => indices.reduce((sum, index) => sum + (isCurve ? beforeBuckets[index] as bigint : (beforeBuckets[index] as readonly bigint[])[asset]), 0n);
        const priorPaidNative = credited(0) - (isCurve ? beforeCredit as bigint : (beforeCredit as readonly bigint[])[0]);
        const priorPaidToken = isCurve ? 0n : credited(1) - (beforeCredit as readonly bigint[])[1];
        const paid = isCurve ? { native: snapshot.curve.claimedNativeWei, token: "0" }
          : snapshot.lp.status === "ready" ? { native: snapshot.lp.claimedNativeWei, token: snapshot.lp.claimedTokenWei } : undefined;
        if (!paid || priorPaidNative < 0n || priorPaidToken < 0n || BigInt(paid.native) < priorPaidNative + native || BigInt(paid.token) < priorPaidToken + erc20) {
          return { status: "unavailable", ...bound };
        }
      }
    }
    const payer = request.operation === "lp-collect" ? context.poolManager.address : request.ledger;
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", strict: true, logs: receipt.logs.filter(log => same(log.address, request.token)) });
    const relevant = transfers.filter(event => same(event.args.from, payer));
    if ((erc20 === 0n && relevant.length !== 0) || (erc20 > 0n && (relevant.length !== 1 || !same(relevant[0].args.to, request.beneficiary) || relevant[0].args.value !== erc20))) {
      return { status: "unavailable", ...bound };
    }
    if (native > 0n) {
      try {
        const trace = await context.rpc.request({ method: "debug_traceTransaction", params: [found, { tracer: "callTracer" }] } as never, { retryCount: 0 });
        assertNativeTransferProof(trace, { from: request.from, to: request.to, value: 0n, input: request.data }, [{ from: payer, to: request.beneficiary, amount: native }]);
      } catch { return { status: "pending", settlementPending: true, ...bound }; }
    }
    // An advancing launch checkpoint alone is not proof that a claim event was
    // durably indexed. The callback must match the exact canonical event identity.
    const amounts = { nativeWei: native.toString(), tokenWei: erc20.toString() };
    let indexed = false;
    try { indexed = input.indexed ? await input.indexed(found, receipt.blockHash, event.logIndex, amounts) : false; } catch { /* Onchain settlement remains distinct from an interrupted indexer read. */ }
    return { status: "confirmed", amounts, indexed, ...bound };
  } catch { return { status: "unavailable", ...(input.transactionHash && { transactionHash: input.transactionHash }) }; }
}

export async function handleTestEarningsClaim(request: Request) {
  const fixture = configuredCurveFixture(request.headers);
  if (!fixture || request.method !== "POST") return reply({ status: "unavailable" }, 404);
  const url = new URL(request.url);
  // Next can normalize its internal Request URL to localhost while preserving
  // the actual Host. Both public Host (configuredCurveFixture) and browser
  // Origin stay exactly pinned to 127.0.0.1; only that internal alias is admitted.
  const origin = new URL(fixture.origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== origin.port || url.username || url.password || url.hash
    || request.headers.get("origin") !== fixture.origin || request.headers.has("forwarded") || url.search) return reply({ status: "invalid" }, 403);
  const length = request.headers.get("content-length");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body
    || (length !== null && (!/^\d+$/.test(length) || Number(length) > 4096))) return reply({ status: "invalid" }, 400);
  try {
    const payload = await readDraftBody(request.body);
    if (payload.tooLarge) return reply({ status: "invalid" }, 413);
    if (!payload.input || typeof payload.input !== "object" || Array.isArray(payload.input)) return reply({ status: "invalid" }, 400);
    const body = payload.input as Record<string, unknown>;
    if (body.action === "state" && keys(body, ["action", "token", "beneficiary"]) && fixtureAddress(body.token) && fixtureAddress(body.beneficiary)) {
      const birth = await readFixtureBirth(fixture, body.token, body.beneficiary);
      const context = await fixtureEarningsContext(fixture, birth.checkpoint);
      return reply(await readEarningsContracts(context, birth.registration, body.beneficiary));
    }
    if (body.action === "prepare" && keys(body, ["action", "account", "beneficiary", "operation"], ["token", "prior"])
      && fixtureAddress(body.account) && fixtureAddress(body.beneficiary) && isEarningsClaimOperation(body.operation)
      && (body.operation === "creation-fees" ? body.token === undefined || body.token === zeroAddress : fixtureAddress(body.token))
      && (body.prior === undefined || isEarningsClaimRequest(body.prior))) {
      const birth = body.operation === "creation-fees" ? undefined : await readFixtureBirth(fixture, body.token as Address, body.beneficiary);
      // Quotes use a current canonical block; the birth feed proves provenance,
      // not a frozen balance. Preparation never substitutes an old claim amount.
      const context = await fixtureEarningsContext(fixture);
      return reply(await prepareEarningsClaim({ context, registration: birth?.registration, beneficiary: body.beneficiary, account: body.account,
        operation: body.operation, prior: body.prior as EarningsClaimRequest | undefined }));
    }
    if (body.action === "verify" && keys(body, ["action", "request"], ["transactionHash"]) && isEarningsClaimRequest(body.request)
      && (body.transactionHash === undefined || isTransactionHash(body.transactionHash))) {
      const prior = body.request;
      const birth = prior.operation === "creation-fees" ? undefined : await readFixtureBirth(fixture, prior.token, prior.discoveryRecipient);
      const context = await fixtureEarningsContext(fixture);
      return reply(await verifyEarningsClaim({ context, registration: birth?.registration, request: prior, transactionHash: body.transactionHash as Hash | undefined,
        indexed: (hash, blockHash, logIndex, amounts) => readFixtureClaimIndexed(fixture, context, prior, hash, blockHash, logIndex, amounts) }));
    }
  } catch { return reply(earningsUnavailable); }
  return reply({ status: "invalid" }, 400);
}
