import { getAddress, type Address, type Hex } from "viem";
import { claimProfileDigest, isClaimExecutionReview, type ClaimExecutionReview, type ClaimWalletKind } from "../claim-profiles";
import { earningsAddress, parseEarningsDirectory, type EarningsBinding } from "../earnings";
import { isEarningsClaimOperation, type EarningsClaimOperation } from "../earnings-claims";
import type { ClaimActivityIdentity, ClaimIndexedEvidence, ClaimSettlementPoint } from "../production-claims";
import { isTransactionHash } from "../test-creation";
import { prepareCorroboratedClaimExecutionReview, revalidateClaimExecutionReview, type ClaimPreparationInput } from "./claim-profiles";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";
import { productionEarningsContext, type EarningsRegistration } from "./earnings-contracts";
import { indexerOrigin } from "./indexer-origin";
import { configuredProductionFinancial, resolveProductionFinancialContext } from "./production-financial";
import { boundedClaimVerificationRpc, verifyProductionClaimSettlement, type ClaimSettlementProvider } from "./production-claims-settlement";

type Environment = Record<string, string | undefined>;
type Options = { env?: Environment; fetch?: typeof fetch; now?: () => number;
  configured?: typeof configuredProductionFinancial; resolve?: typeof resolveProductionFinancialContext;
  budget?: ReturnType<typeof createProductionEarningsBudget> };
const headers = { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const reply = (body: object, status = 200) => Response.json(body, { status, headers });
const unavailable = (status = 503) => reply({ status: "unavailable", executionEnabled: false,
  reason: "Fresh authenticated discovery, release approval, wallet authority and independent chain evidence are required." }, status);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (value: unknown): value is Address => earningsAddress(value);
const normalize = (value: string) => getAddress(value.toLowerCase());
function must(ok: unknown): asserts ok { if (!ok) throw Error("Production claim evidence unavailable"); }
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const binding: EarningsBinding = { chainId: 4663, factory: curveProductionPins.factory[0], registry: curveProductionPins.registry[0],
  deploymentBlock: String(curveProductionDeployment.blockNumber), deploymentBlockHash: curveProductionDeployment.blockHash,
  operations: curveProductionDeployment.operating, reserve: curveProductionDeployment.reserve };

// Per-instance work is bounded independently of the existing read-only earnings
// API. This gate cannot turn on an execution route or change an upstream token.
export function createProductionEarningsBudget() { let minute = -1, reads = 0, active = 0; return { acquire(now: number) {
  const current = Math.floor(now / 60_000); if (current !== minute) { minute = current; reads = 0; }
  if (reads >= 30 || active >= 2) return null; reads++; active++; let released = false;
  return () => { if (!released) { released = true; active--; } };
} }; }
const budget = createProductionEarningsBudget();

async function boundedJson(body: ReadableStream<Uint8Array>, maximum: number, timeoutMs: number) {
  const reader = body.getReader(), buffer = new Uint8Array(maximum); let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Read unavailable")), timeoutMs); });
  try {
    for (;;) { const part = await Promise.race([reader.read(), timeout]); if (part.done) break;
      must(size + part.value.byteLength <= maximum); buffer.set(part.value, size); size += part.value.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))) as unknown;
  } finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

async function readIndexer(path: string, query: Record<string, string>, options: Options): Promise<unknown> {
  const env = options.env ?? process.env, origin = indexerOrigin(env.RMT_LAUNCH_HISTORY_INDEXER_URL, env);
  const credential = env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN;
  must(origin && credential && /^[\x21-\x7e]{1,512}$/.test(credential));
  const url = new URL(path, origin); for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await (options.fetch ?? fetch)(url, { method: "GET", headers: { Accept: "application/json", Authorization: "Bearer " + credential },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(4_000) });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/json" || !response.body
      || Number(response.headers.get("content-length")) > 196_608) { await response.body?.cancel(); throw Error("Indexer unavailable"); }
  return boundedJson(response.body, 196_608, 4_000);
}

/** Registration evidence is fetched through the existing private read-token
 * boundary. The request cannot choose an origin, credential, ledger or birth. */
export async function readProductionEarningsBirth(token: Address | undefined, beneficiary: Address,
  contexts: readonly [ClaimSettlementProvider, ClaimSettlementProvider], options: Options = {}) {
  const data = parseEarningsDirectory(await readIndexer("/curve-earnings", { recipient: beneficiary.toLowerCase(), limit: "1",
    ...(token && { token: token.toLowerCase() }) }, options), binding, beneficiary, (options.now ?? Date.now)());
  must(data?.status === "ready" && (!token || data.launches.length === 1 && data.nextCursor === null && same(data.launches[0].token, token)));
  const anchors = await Promise.all(contexts.map(async ({ context }) => {
    must(BigInt(data.checkpoint.blockNumber) + 20n <= BigInt(context.checkpoint.blockNumber));
    const block = await context.rpc.getBlock({ blockNumber: BigInt(data.checkpoint.blockNumber) });
    must(block.number === BigInt(data.checkpoint.blockNumber) && same(block.hash ?? "", data.checkpoint.blockHash)
      && new Date(Number(block.timestamp) * 1000).toISOString() === data.checkpoint.timestamp);
    return block;
  }));
  must(anchors.length === 2);
  return token ? data.launches[0] as EarningsRegistration : undefined;
}

const normalized = (value: unknown): unknown => typeof value === "string" && /^0x[0-9a-f]+$/i.test(value) ? value.toLowerCase()
  : Array.isArray(value) ? value.map(normalized) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)])) : value;

/** Durable activity must match the complete independently proved identity. An
 * advancing registration cursor or a caller-supplied activity is insufficient. */
export async function readProductionClaimIndexed(activity: ClaimActivityIdentity, receipt: ClaimSettlementPoint,
  contexts: readonly [ClaimSettlementProvider, ClaimSettlementProvider], options: Options = {}): Promise<ClaimIndexedEvidence | null> {
  try {
    must(activity.chainId === 4663 && Object.keys(activity).length === 22);
    const raw = await readIndexer("/curve-activity", { transactionHash: activity.transactionHash,
      ...(activity.token && { token: activity.token }) }, options);
    must(raw && typeof raw === "object" && !Array.isArray(raw)); const data = raw as Record<string, unknown>;
    must(keys(data, ["schemaVersion", "profile", "chainId", "status", "observedAt", "token", "transactionHash", "deployment", "events", "checkpoint"])
      && data.schemaVersion === 1 && data.profile === "rmt-curve-activity-v1" && data.chainId === 4663 && data.status === "ready"
      && same(String(data.transactionHash), activity.transactionHash) && (activity.token === null ? data.token === null : same(String(data.token), activity.token))
      && typeof data.observedAt === "string" && Number.isFinite(Date.parse(data.observedAt))
      && Date.parse(data.observedAt) <= (options.now ?? Date.now)() + 15_000 && (options.now ?? Date.now)() - Date.parse(data.observedAt) <= 120_000
      && Array.isArray(data.events) && data.events.length > 0 && data.events.length <= 128);
    must((data.events as unknown[]).every(raw => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const row = raw as Record<string, unknown>;
      return keys(row, ["address", "logIndex", "blockNumber", "blockHash", "transactionHash", "transactionIndex", "topics", "data"])
        && address(row.address) && Number.isSafeInteger(row.logIndex) && Number(row.logIndex) >= 0
        && Number.isSafeInteger(row.transactionIndex) && Number(row.transactionIndex) >= 0
        && typeof row.blockNumber === "string" && /^[1-9][0-9]{0,15}$/.test(row.blockNumber)
        && isTransactionHash(row.blockHash) && isTransactionHash(row.transactionHash) && same(row.transactionHash, activity.transactionHash)
        && Array.isArray(row.topics) && row.topics.length <= 4 && row.topics.every(topic => typeof topic === "string" && /^0x[0-9a-f]{64}$/i.test(topic))
        && typeof row.data === "string" && row.data.length <= 8194 && /^0x(?:[0-9a-f]{2})*$/i.test(row.data);
    }));
    const deployment = data.deployment as Record<string, unknown>;
    must(deployment && keys(deployment, ["factory", "registry", "blockNumber", "blockHash"])
      && same(String(deployment.factory), binding.factory) && same(String(deployment.registry), binding.registry)
      && deployment.blockNumber === binding.deploymentBlock && same(String(deployment.blockHash), binding.deploymentBlockHash));
    const p = data.checkpoint as ClaimSettlementPoint & { confirmations: number; finality: string; l1Finality: string };
    must(p && keys(p, ["blockNumber", "blockHash", "timestamp", "confirmations", "finality", "l1Finality"])
      && p.confirmations === 20 && p.finality === "l2-confirmed" && p.l1Finality === "unverified" && /^[1-9][0-9]{0,15}$/.test(p.blockNumber)
      && isTransactionHash(p.blockHash) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(p.timestamp)
      && Number.isFinite(Date.parse(p.timestamp)) && BigInt(p.blockNumber) >= BigInt(receipt.blockNumber)
      && Date.parse(p.timestamp) >= Date.parse(receipt.timestamp) && Date.parse(p.timestamp) <= (options.now ?? Date.now)() + 15_000
      && (options.now ?? Date.now)() - Date.parse(p.timestamp) <= 120_000
      && contexts.every(source => BigInt(source.context.checkpoint.blockNumber) >= BigInt(p.blockNumber) + 20n));
    const expected = await Promise.all(contexts.map(async ({ context }) => {
      const observed = await context.rpc.getTransactionReceipt({ hash: activity.transactionHash });
      must(observed.status === "success" && same(observed.transactionHash, activity.transactionHash)
        && observed.blockNumber.toString() === activity.blockNumber && same(observed.blockHash, activity.blockHash));
      const logs = observed.logs.filter(log => log.logIndex === activity.logIndex);
      must(logs.length === 1 && !logs[0].removed);
      const canonical = await context.rpc.getBlock({ blockNumber: observed.blockNumber });
      must(same(canonical.hash ?? "", activity.blockHash));
      const log = logs[0];
      return { address: log.address, logIndex: log.logIndex, blockNumber: log.blockNumber!.toString(), blockHash: log.blockHash,
        transactionHash: log.transactionHash, transactionIndex: log.transactionIndex, topics: log.topics, data: log.data };
    }));
    must(claimProfileDigest(normalized(expected[0])) === claimProfileDigest(normalized(expected[1])));
    const indexed = (data.events as unknown[]).filter(row => claimProfileDigest(normalized(row)) === claimProfileDigest(normalized(expected[0])));
    must(indexed.length === 1);
    // Intent/wallet/amount fields are a projection of the independently verified
    // review and receipt. Only the exact raw canonical log is claimed as indexed.
    return { schemaVersion: 1, status: "canonical", activity, checkpoint: { blockNumber: p.blockNumber, blockHash: p.blockHash, timestamp: p.timestamp } };
  } catch { return null; }
}

type PrepareBody = { action: "prepare"; operation: EarningsClaimOperation; token?: Address; beneficiary: Address; account: Address;
  kind: ClaimWalletKind; safeAddress?: Address; safeSignatures?: Hex; prior?: ClaimExecutionReview };
type ExistingBody = { action: "revalidate" | "verify"; review: ClaimExecutionReview; approvalBinding: string; transactionHash?: Hex };
function parseBody(raw: unknown): PrepareBody | ExistingBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.action === "prepare") {
    if (!keys(r, ["action", "operation", "beneficiary", "account", "kind"], ["token", "safeAddress", "safeSignatures", "prior"])
      || !isEarningsClaimOperation(r.operation) || !address(r.beneficiary) || !address(r.account)
      || !["eoa", "metamask-7702", "safe-1.4.1"].includes(String(r.kind))
      || (r.operation === "creation-fees" ? r.token !== undefined : !address(r.token))
      || (r.safeAddress !== undefined && !address(r.safeAddress))
      || (r.safeSignatures !== undefined && (typeof r.safeSignatures !== "string" || !/^0x[0-9a-f]{260}$/i.test(r.safeSignatures)))
      || (r.kind !== "safe-1.4.1" && (r.safeAddress !== undefined || r.safeSignatures !== undefined))
      || (r.prior !== undefined && (!isClaimExecutionReview(r.prior) || r.prior.chainId !== 4663))) return null;
    return r as PrepareBody;
  }
  if ((r.action === "revalidate" || r.action === "verify")
    && keys(r, ["action", "review", "approvalBinding"], r.action === "verify" ? ["transactionHash"] : [])
    && isClaimExecutionReview(r.review) && r.review.chainId === 4663 && r.review.status === "review-only" && r.review.outer
    && typeof r.approvalBinding === "string" && /^[0-9a-f]{64}$/.test(r.approvalBinding)
    && (r.transactionHash === undefined || isTransactionHash(r.transactionHash))) return r as ExistingBody;
  return null;
}

/** This route only constructs and checks unsigned envelopes. The distinct
 * owner-approved release gates default off; no signing or write RPC exists. */
export async function handleProductionEarningsClaim(request: Request, options: Options = {}) {
  const env = options.env ?? process.env, configured = options.configured ?? configuredProductionFinancial;
  const config = configured(request.headers, "claims", env);
  if (!config || request.method !== "POST") return unavailable(404);
  if (new URL(request.url).search || request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body
      || Number(request.headers.get("content-length")) > 32_768) return unavailable(400);
  const releaseBudget = (options.budget ?? budget).acquire((options.now ?? Date.now)()); if (!releaseBudget) return unavailable(429);
  try {
    const body = parseBody(await boundedJson(request.body, 32_768, 3_000)); if (!body) return unavailable(400);
    if (body.action !== "prepare" && !same(body.approvalBinding, config.approvalBinding)) return unavailable(409);
    const resolved = await (options.resolve ?? resolveProductionFinancialContext)(request.headers, "claims");
    must(resolved && same(resolved.approvalBinding, config.approvalBinding));
    const checkpoint = { blockNumber: resolved.anchor.blockNumber.toString(), blockHash: resolved.anchor.blockHash,
      timestamp: new Date(Number(resolved.anchor.timestamp) * 1000).toISOString() };
    // This compatibility policy is server-owned and reachable only after the
    // complete claims financial release/origin gate above. It is never a body,
    // fixture activation or environment-variable option.
    const contexts = [{ id: "official", context: { ...productionEarningsContext(boundedClaimVerificationRpc(resolved.rpc), checkpoint), feePolicy: resolved.feePolicy } },
      { id: "pocket", context: { ...productionEarningsContext(boundedClaimVerificationRpc(resolved.corroboratingRpc), checkpoint), feePolicy: resolved.feePolicy } }] as const;
    const token = body.action === "prepare" ? body.token : body.review.inner.operation === "creation-fees" ? undefined : body.review.inner.token;
    const recipient = normalize(body.action === "prepare" ? body.beneficiary : body.review.inner.discoveryRecipient);
    const registration = await readProductionEarningsBirth(token, recipient, contexts, options);
    let response: object;
    if (body.action === "prepare") {
      const input = { registration, operation: body.operation, beneficiary: normalize(body.beneficiary), account: normalize(body.account), kind: body.kind,
        ...(body.safeAddress && { safeAddress: normalize(body.safeAddress) }), ...(body.safeSignatures && { safeSignatures: body.safeSignatures }), ...(body.prior && { prior: body.prior }) };
      const prepared = await prepareCorroboratedClaimExecutionReview(contexts.map(({ context }) => ({ ...input, context })) as [ClaimPreparationInput, ClaimPreparationInput]);
      must(prepared.status === "corroborated-unsigned-review" && prepared.review && isClaimExecutionReview(prepared.review));
      const review = prepared.review;
      if (review.status === "fee-unavailable") return unavailable();
      response = { schemaVersion: 1, status: review.status === "awaiting-safe-approvals" ? "awaiting-safe-approvals" : "prepared",
        executionEnabled: review.status === "review-only", review, approvalBinding: resolved.approvalBinding };
    } else if (body.action === "revalidate") {
      const checks = await Promise.all(contexts.map(({ context }) => revalidateClaimExecutionReview(context, registration, body.review)));
      must(checks.every(value => isClaimExecutionReview(value) && value.reviewHash === body.review.reviewHash));
      response = { schemaVersion: 1, status: "revalidated", executionEnabled: true, review: body.review, approvalBinding: resolved.approvalBinding };
    } else {
      const settlement = await verifyProductionClaimSettlement({ contexts, review: body.review, registration,
        ...(body.transactionHash && { transactionHash: body.transactionHash }), indexed: (activity, receipt) => readProductionClaimIndexed(activity, receipt, contexts, options) });
      response = { schemaVersion: 1, status: "verification", executionEnabled: false, settlement, approvalBinding: resolved.approvalBinding };
    }
    must(same(configured(request.headers, "claims", env)?.approvalBinding ?? "", resolved.approvalBinding));
    return reply(response);
  } catch { return unavailable(); }
  finally { releaseBudget(); }
}
