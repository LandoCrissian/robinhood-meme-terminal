import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { decodeFunctionData, getAddress, keccak256, toHex, type Address, type Hex, type Transaction } from "viem";
import { isMobileAddress, isMobileQuantity, isMobileReview, mobileReviewProfile, mobileTestFields, proposedProductionSender,
  type MobilePlan, type MobileReview, type ObservedSender } from "../mobile-wallet-review";
import { isTestCreationRequest, isTestCreationPayouts, isTransactionHash, sameTestCreationRequest } from "../test-creation";
import { configuredCurveFixture, factoryAbi, fixtureChainId, fixtureRpc, sameHex, verifyCurveFixture, type CurveFixture } from "./curve-fixture";
import { readDraftBody } from "./launch-draft";
import { prepareTestCreation, verifyTestCreation } from "./test-creation";

const rejectedAccounts = [proposedProductionSender,
  "0xc447a378cfd8460febc2eef67501d7a5473b9001", "0xc3600f2df60929d2ab9ab294cff42eedcb984f51", "0x2bcc3fafce77ccc7fdbed46e0b5bb80ba3e76697"];
const quoteLifetimeMs = 60_000;
const jsonLimit = 4096;
type MobileFixture = { fixture: CurveFixture; account: Address; attestationKey: string };
type ReviewFields = Omit<MobileReview, "attestation">;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const reply = (body: object, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff",
} });

export function configuredMobileReview(headers: Headers): MobileFixture | null {
  const { RMT_MOBILE_REVIEW_FIXTURE: profile, RMT_MOBILE_REVIEW_FIXTURE_ACCOUNT: account, RMT_CURVE_FIXTURE_READ_KEY: attestationKey } = process.env;
  if (profile !== mobileReviewProfile || !isMobileAddress(account) || rejectedAccounts.some((address) => sameHex(account, address))
      || !attestationKey || headers.has("forwarded")) return null;
  const fixture = configuredCurveFixture(headers);
  if (!fixture || [fixture.factory, fixture.registry, fixture.feeRecipient].some((address) => sameHex(account, address))) return null;
  return { fixture, account: getAddress(account.toLowerCase()), attestationKey };
}

function attest(key: string, { request, payouts, expectedToken, expectedCurve, calldataHash, nonce, gas, gasPrice,
  estimatedL2Wei, l1DataFeeWei, reviewBlockNumber, reviewBlockHash, expiresAt }: ReviewFields): Hex {
  const input = [request.from, request.to, request.data, request.value, request.chainId, request.intentId, request.deadline,
    request.blockNumber, request.blockHash, payouts.operating, payouts.reserve, payouts.treasuryKind,
    expectedToken, expectedCurve, calldataHash, nonce, gas, gasPrice, estimatedL2Wei, l1DataFeeWei, reviewBlockNumber, reviewBlockHash, expiresAt];
  const digest = createHmac("sha256", Buffer.from(key, "hex")).update("RMT mobile rehearsal 31337 v1\n").update(JSON.stringify(input)).digest("hex");
  return "0x" + digest as Hex;
}

function hasProof(value: unknown, { fixture, account, attestationKey }: MobileFixture): value is MobileReview {
  return isMobileReview(value) && sameHex(value.request.from, account) && sameHex(value.request.to, fixture.factory)
    && timingSafeEqual(Buffer.from(value.attestation.slice(2), "hex"), Buffer.from(attest(attestationKey, value).slice(2), "hex"));
}

async function prepare({ fixture, account, attestationKey }: MobileFixture, intentId: Hex, deadline?: string): Promise<MobileReview> {
  const base = await prepareTestCreation(fixture, { fields: mobileTestFields, account, intentId, ...(deadline && { deadline }) });
  const { status, request, payouts } = record(await base.json());
  if (status !== "prepared" || !isTestCreationRequest(request) || !isTestCreationPayouts(payouts, false)) throw new Error("Preparation unavailable");
  const decoded = decodeFunctionData({ abi: factoryAbi, data: request.data });
  if (decoded.functionName !== "create") throw new Error("Unexpected call");

  const rpc = fixtureRpc(fixture);
  const head = await verifyCurveFixture(fixture, rpc);
  const at = { blockNumber: head.number };
  const value = BigInt(request.value);
  const [simulation, gas, gasPrice, nonce, pendingNonce, balance, accountCode] = await Promise.all([
    rpc.simulateContract({ address: fixture.factory, abi: factoryAbi, functionName: "create", args: decoded.args, account, value, ...at }),
    rpc.estimateGas({ account, to: request.to, data: request.data, value, ...at }),
    rpc.getGasPrice(), rpc.getTransactionCount({ address: account, ...at }),
    rpc.getTransactionCount({ address: account, blockTag: "pending" }),
    rpc.getBalance({ address: account, ...at }), rpc.getCode({ address: account, ...at }),
  ]);
  const [expectedToken, expectedCurve] = simulation.result;
  const totalGas = gas * gasPrice;
  if (!isMobileAddress(expectedToken) || !isMobileAddress(expectedCurve) || sameHex(expectedToken, expectedCurve)
      || nonce !== pendingNonce || !Number.isSafeInteger(nonce) || gas <= 0n || gasPrice <= 0n || balance < value + totalGas
      || (accountCode && accountCode !== "0x")) throw new Error("Unbound account, insufficient balance or pending nonce");
  const [canonical, confirmedPendingNonce] = await Promise.all([
    rpc.getBlock(at), rpc.getTransactionCount({ address: account, blockTag: "pending" }),
  ]);
  if (!sameHex(canonical.hash, head.hash) || confirmedPendingNonce !== nonce || !isTransactionHash(head.hash)) throw new Error("Preparation changed");
  const review = { request, payouts, expectedToken, expectedCurve, calldataHash: keccak256(request.data),
    nonce: toHex(nonce), gas: toHex(gas), gasPrice: toHex(gasPrice), estimatedL2Wei: totalGas.toString(),
    l1DataFeeWei: "0", reviewBlockNumber: toHex(head.number), reviewBlockHash: head.hash, expiresAt: Date.now() + quoteLifetimeMs } as const;
  return { ...review, attestation: attest(attestationKey, review) };
}

function unchanged(first: MobileReview, next: MobileReview) {
  return sameTestCreationRequest(first.request, next.request)
    && first.payouts.operating === next.payouts.operating && first.payouts.reserve === next.payouts.reserve
    && first.expectedToken === next.expectedToken && first.expectedCurve === next.expectedCurve
    && first.calldataHash === next.calldataHash && first.nonce === next.nonce && first.gas === next.gas && first.gasPrice === next.gasPrice;
}

function exactTx(tx: Transaction, review: MobileReview) {
  const { request } = review;
  return sameHex(tx.from, request.from) && sameHex(tx.to, request.to) && sameHex(tx.input, request.data)
    && tx.chainId === fixtureChainId && tx.value === BigInt(request.value) && BigInt(tx.nonce) === BigInt(review.nonce)
    && tx.gas === BigInt(review.gas) && tx.gasPrice === BigInt(review.gasPrice);
}

async function verify({ fixture }: MobileFixture, review: MobileReview, transactionHash?: Hex) {
  const rpc = fixtureRpc(fixture);
  if (transactionHash) {
    await verifyCurveFixture(fixture, rpc);
    const tx = await rpc.getTransaction({ hash: transactionHash });
    if (!sameHex(tx.hash, transactionHash) || !exactTx(tx, review)) return reply({ status: "mismatch" });
  }
  const result = record(await (await verifyTestCreation(fixture, { request: review.request, ...(transactionHash && { transactionHash }) }, true)).json());
  if (isTransactionHash(result.transactionHash)) {
    const tx = await rpc.getTransaction({ hash: result.transactionHash });
    if (!sameHex(tx.hash, result.transactionHash) || !exactTx(tx, review)) return reply({ status: "mismatch" });
  }
  if (result.status === "confirmed" && (!isMobileAddress(result.token) || !sameHex(result.token, review.expectedToken) || !isMobileAddress(result.curve) || !sameHex(result.curve, review.expectedCurve))) {
    return reply({ status: "mismatch" });
  }
  return reply(result);
}

export async function handleMobileReview(request: Request) {
  const config = configuredMobileReview(request.headers);
  const url = new URL(request.url);
  // The production-style local Next server can reconstruct the numeric origin as localhost.
  if (!config || request.method !== "POST" || url.protocol !== "http:" || url.port !== new URL(config.fixture.origin).port
      || !["127.0.0.1", "localhost"].includes(url.hostname)) return reply({ status: "unavailable" }, 404);
  if (request.headers.get("origin") !== config.fixture.origin || url.search) return reply({ status: "invalid" }, 403);
  const declared = request.headers.get("content-length");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body ||
      (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > jsonLimit))) return reply({ status: "invalid" }, 400);
  let body: Record<string, unknown>;
  try {
    const payload = await readDraftBody(request.body);
    if (payload.tooLarge) return reply({ status: "invalid" }, 413);
    body = record(payload.input);
  } catch {
    return reply({ status: "invalid" }, 400);
  }
  const keyCount = Object.keys(body).length;
  if (body.action === "prepare" && keyCount === 3 && isMobileAddress(body.account) && sameHex(body.account, config.account)
      && isTransactionHash(body.intentId)) {
    try {
      return reply({ status: "prepared", review: await prepare(config, body.intentId) });
    } catch {
      return reply({ status: "unavailable" });
    }
  }
  if (!hasProof(body.review, config)) return reply({ status: "invalid" }, 422);
  if (body.action === "refresh" && keyCount === 2) {
    if (Date.now() >= body.review.expiresAt) return reply({ status: "stale" });
    try {
      const rpc = fixtureRpc(config.fixture);
      const original = await rpc.getBlock({ blockNumber: BigInt(body.review.reviewBlockNumber) });
      if (!sameHex(original.hash, body.review.reviewBlockHash)) return reply({ status: "stale" });
      const renewed = await prepare(config, body.review.request.intentId, body.review.request.deadline);
      return unchanged(body.review, renewed) ? reply({ status: "prepared", review: renewed }) : reply({ status: "stale" });
    } catch {
      return reply({ status: "stale" });
    }
  }
  if (body.action === "verify" && keyCount === (Object.hasOwn(body, "transactionHash") ? 3 : 2)
      && (body.transactionHash === undefined || isTransactionHash(body.transactionHash))) {
    try {
      return await verify(config, body.review, body.transactionHash);
    } catch {
      return reply({ status: "unavailable" });
    }
  }
  return reply({ status: "invalid" }, 400);
}

const isDecimalText = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,79})$/.test(value);
const isShortText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;

const isoTime = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));

function readObservedSender(pathname: string): ObservedSender | null {
  try {
    const file = statSync(pathname);
    if (!file.isFile() || file.size > 65_536) return null;
    const evidence = record(JSON.parse(readFileSync(pathname, "utf8")));
    const { observedAt, expiresAt, proposedSender } = evidence;
    if (evidence.status !== "BLOCKED_NO_BROADCAST" || evidence.broadcastAuthorized !== false || evidence.chainId !== 4663
        || evidence.scope !== "READ_ONLY_4663_MOBILE_PREPARATION" || !isoTime(observedAt) || !isoTime(expiresAt)
        || Date.parse(expiresAt) <= Date.parse(observedAt) || !isMobileAddress(proposedSender) || !sameHex(proposedSender, proposedProductionSender)) return null;
    const sender = record(evidence.sender);
    const { confirmedNonce, pendingNonce, accountType } = sender;
    const anchor = record(sender.anchor);
    if (sender.status !== "OBSERVED" || !isDecimalText(anchor.number) || !isTransactionHash(anchor.hash)
        || !isDecimalText(confirmedNonce) || !isDecimalText(pendingNonce)
        || (accountType !== "CODE_EMPTY" && accountType !== "EIP_7702_DELEGATION" && accountType !== "CONTRACT_CODE")) return null;
    const safes: ObservedSender["safes"] = [];
    const safeEvidence = record(evidence.safes);
    if (safeEvidence.safeVersion === "SafeL2 1.4.1" && safeEvidence.threshold === 2 &&
        Array.isArray(safeEvidence.proposals) && safeEvidence.proposals.length === 2) {
      for (const proposedSafe of safeEvidence.proposals) {
        const item = record(proposedSafe);
        const gas = record(item.gas);
        if ((item.role === "RMT-OPERATIONS" || item.role === "RMT-RESERVE") && isMobileAddress(item.counterfactualAddress)
            && isDecimalText(gas.l2ExecutionWei) && isDecimalText(gas.l1PosterWei) && isDecimalText(gas.estimatedTotalWei)
            && BigInt(gas.l2ExecutionWei) + BigInt(gas.l1PosterWei) === BigInt(gas.estimatedTotalWei)) {
          safes.push({ role: item.role, address: item.counterfactualAddress,
            l2Wei: gas.l2ExecutionWei, l1Wei: gas.l1PosterWei, totalWei: gas.estimatedTotalWei });
        }
      }
    }
    return { observedAt, expiresAt, blockNumber: anchor.number, blockHash: anchor.hash, accountType, confirmedNonce, pendingNonce, safes };
  } catch {
    return null;
  }
}

export function readMobilePlan(): MobilePlan | null {
  const pathname = process.env.RMT_MOBILE_REVIEW_PLAN;
  if (!pathname || !isAbsolute(pathname)) return null;
  try {
    const file = statSync(pathname);
    if (!file.isFile() || file.size > 65_536) return null;
    const raw = record(JSON.parse(readFileSync(pathname, "utf8")));
    const target = record(raw.target);
    const fixture = record(raw.fixture);
    if (raw.status !== "BLOCKED_NO_BROADCAST" || raw.broadcastAuthorized !== false || target.chainId !== 4663
        || !sameHex(typeof target.proposedSender === "string" ? target.proposedSender : undefined, proposedProductionSender)
        || !Array.isArray(target.transactions) || target.transactions.length !== 0
        || fixture.scope !== "LOOPBACK_FIXTURE_ONLY" || fixture.chainId !== 4663 || !Array.isArray(fixture.rows)
        || fixture.rows.length < 1 || fixture.rows.length > 18) return null;
    const rows: MobilePlan["rows"] = [];
    for (const rowInput of fixture.rows) {
      const row = record(rowInput);
      const { id, label, from, to, nonce, valueWei, dataHash, expectedAddress, observedForkGas, authorization, scope, receiptHash } = row;
      if (!isShortText(id) || !isShortText(label) || !isShortText(authorization) || row.chainId !== 4663
          || (scope !== "PROPOSED_SAFE_REVIEW_ONLY" && scope !== "LOOPBACK_FIXTURE_ONLY")
          || (from !== null && !isMobileAddress(from)) || (to !== null && !isMobileAddress(to))
          || (nonce !== null && !isDecimalText(nonce)) || !isDecimalText(valueWei)
          || (dataHash !== null && !isTransactionHash(dataHash)) || (expectedAddress !== null && !isMobileAddress(expectedAddress))
          || (observedForkGas !== null && !isDecimalText(observedForkGas)) || (receiptHash !== null && !isTransactionHash(receiptHash))
          || !Array.isArray(row.dependsOn) || row.dependsOn.length > 18 || !row.dependsOn.every((id) => isShortText(id) && rows.some((item) => item.id === id)) || rows.some((item) => item.id === id)) return null;
      const details = record(row.details);
      const owners = details.owners;
      const saltNonce = details.saltNonce;
      const safe = scope === "PROPOSED_SAFE_REVIEW_ONLY" && Array.isArray(owners) && owners.length === 3 && owners.every(isMobileAddress)
        && owners.every((owner, index) => sameHex(owner, rejectedAccounts[index + 1])) && details.threshold === 2 && isTransactionHash(saltNonce)
        ? { owners, saltNonce } : null;
      if (scope === "PROPOSED_SAFE_REVIEW_ONLY" && !safe) return null;
      const receipt = record(row.receiptBlock);
      const blockNumber = typeof receipt.number === "number" && Number.isSafeInteger(receipt.number) ? String(receipt.number) : receipt.number;
      const receiptBlock = isDecimalText(blockNumber) && isTransactionHash(receipt.hash) ? { number: blockNumber, hash: receipt.hash } : null;
      if (row.receiptBlock != null && !receiptBlock) return null;
      rows.push({ id, label, from, to, nonce, valueWei, dataHash, expectedAddress, observedForkGas, authorization,
        scope, receiptHash, receiptBlock, dependencies: row.dependsOn, safe });
    }
    if (rows.some((row) => row.dependencies.some((id) => id === row.id || !rows.some((item) => item.id === id)))) return null;
    return { rows, observation: readObservedSender(join(dirname(pathname), "sender-observation-4663.json")) };
  } catch {
    return null;
  }
}
