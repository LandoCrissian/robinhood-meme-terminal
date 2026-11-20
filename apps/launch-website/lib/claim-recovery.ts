import { keccak256, type Hex } from "viem";
import { claimDelegatePin, claimExecutionIdentity, claimProfileDigest, isClaimExecutionReview, type ClaimExecutionReview } from "./claim-profiles";
import { readEarningsClaimJournal } from "./earnings-claims";
import { claimSettlementProfile, claimSettlementStages, type ClaimSettlementResult } from "./production-claims";
import { isTransactionHash } from "./test-creation";
import { testWalletErrorCode } from "./test-wallet";
import { assertNoPendingReclaim } from "./reclaim-recovery";
import { isProductionWalletOrigin } from "./production-wallet";
import { assertNoPendingProductionCreation } from "./production-creation";
import { assertProductionNonceAboveConsumed, assertProductionNonceAvailable, recordProductionConsumedNonce } from "./production-nonce";

const namespace = "rmt.claim.execution.v1";
export const claimProfileApiPath = "/api/launchpad/test-claim-profiles";
const indexKey = namespace + ":index";
const maxRecords = 64, maxRecordBytes = 65_536;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type ClaimRecoveryStage = "awaiting-wallet" | "wallet-rejected" | "hash-missing" | ClaimSettlementResult["stage"];
export type ClaimRecoveryJournal = {
  schemaVersion: 1; profile: "rmt-claim-recovery-v1"; review: ClaimExecutionReview;
  stage: ClaimRecoveryStage; transactionHash: Hex | null; verification: ClaimSettlementResult | null;
  createdAt: number; updatedAt: number;
};
export const claimJournalKey = (r: ClaimExecutionReview) => `${namespace}:${r.chainId}:${r.inner.factory.toLowerCase()}:${r.gasPayer.toLowerCase()}:${r.intentHash}`;
const slot = (r: ClaimExecutionReview) => `${r.chainId}:${r.gasPayer.toLowerCase()}:${r.gasPayerEvidence.nonce}`;
export const claimAccountLock = (r: ClaimExecutionReview) => `${namespace}:${r.chainId}:${r.gasPayer.toLowerCase()}`;
/** Acquire all resources in this deterministic order. A Safe's authorization
 * nonce can race across different gas payers; a payer nonce can race between
 * direct claims and Safe executions. One composite lock is insufficient. */
export const claimResourceLocks = (r: ClaimExecutionReview) => [claimAccountLock(r), ...(r.wallet.safe
  ? [`${namespace}:${r.chainId}:safe:${r.actor.toLowerCase()}:${r.wallet.safe.nonce}`] : [])].sort();
const terminal = (j: ClaimRecoveryJournal) => ["settled", "reverted"].includes(j.stage)
  || j.stage === "wallet-rejected" && j.review.kind !== "safe-1.4.1";
const canonicalProductionClaim = (j: ClaimRecoveryJournal) => j.stage === "canonical-l2" && j.verification?.indexed === true
  && j.verification.receiptObserved && j.verification.providers.status === "agree"
  && j.verification.providers.ids.length === 2 && j.verification.providers.ids.includes("official") && j.verification.providers.ids.includes("pocket")
  && j.verification.outerReceiptStatus === "success" && j.verification.innerExecution === "success";
const consumedProductionClaim = (j: ClaimRecoveryJournal) => canonicalProductionClaim(j) || j.stage === "settled" || j.stage === "reverted";
const safeSlot = (r: ClaimExecutionReview) => r.wallet.safe ? `${r.chainId}:${r.actor.toLowerCase()}:${r.wallet.safe.nonce}` : null;
const sameSafeProposal = (a: ClaimExecutionReview, b: ClaimExecutionReview) => !!a.wallet.safe && !!b.wallet.safe
  && safeSlot(a) === safeSlot(b) && same(a.wallet.safe.transactionHash, b.wallet.safe.transactionHash);
function rejectedSafeRenewal(j: ClaimRecoveryJournal, review: ClaimExecutionReview) {
  if (j.stage !== "wallet-rejected" || j.transactionHash !== null || j.verification !== null || !sameSafeProposal(j.review, review)) return false;
  // A definite EIP-1193 rejection is different from an unknown wallet outcome.
  // Renewal may refresh the read anchor and outer payer/fee review, but may not
  // replace the Safe CALL, beneficiary, assets, amounts or custody commitment.
  const terms = (r: ClaimExecutionReview) => {
    const { reviewBlockNumber: _number, reviewBlockHash: _hash, reviewTimestamp: _time, reviewExpiresAt: _expires, ...immutable } = r.inner;
    return claimProfileDigest(immutable);
  };
  return terms(j.review) === terms(review);
}
const provenSafeOuterRevert = (j: ClaimRecoveryJournal) => j.review.kind === "safe-1.4.1" && j.stage === "reverted" && !!j.transactionHash
  && j.verification?.providers.status === "agree" && j.verification.receiptObserved && !!j.verification.canonicalAt
  && j.verification.outerReceiptStatus === "reverted";

function keys(storage: Storage): string[] {
  const raw = storage.getItem(indexKey);
  if (raw === null) return [];
  if (raw.length > 16_384) throw new Error("Claim recovery index is unavailable. No transaction was requested.");
  const value = JSON.parse(raw) as { schemaVersion: number; keys: unknown[] };
  if (Object.keys(value).length !== 2 || value.schemaVersion !== 1 || !Array.isArray(value.keys) || value.keys.length > maxRecords
    || value.keys.some(k => typeof k !== "string" || k.length > 256 || !/^rmt\.claim\.execution\.v1:(31337|4663):0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{64}$/.test(k))
    || new Set(value.keys).size !== value.keys.length) throw new Error("Claim recovery index is invalid. Preserve the original intent.");
  return value.keys as string[];
}
function validJournal(value: unknown): value is ClaimRecoveryJournal {
  try {
    const j = value as ClaimRecoveryJournal;
    return Object.keys(j).length === 8 && j.schemaVersion === 1 && j.profile === "rmt-claim-recovery-v1"
      && isClaimExecutionReview(j.review) && ["awaiting-wallet", "wallet-rejected", "hash-missing", ...claimSettlementStages].includes(j.stage)
      && (j.transactionHash === null || isTransactionHash(j.transactionHash))
      && Number.isSafeInteger(j.createdAt) && j.createdAt > 0 && Number.isSafeInteger(j.updatedAt) && j.updatedAt >= j.createdAt
      && (j.verification === null ? ["awaiting-wallet", "wallet-rejected", "hash-missing", "submitted"].includes(j.stage)
        : j.verification.stage === j.stage && matchingResult(j, j.verification));
  } catch { return false; }
}
export function readClaimJournal(storage: Storage, review: ClaimExecutionReview): ClaimRecoveryJournal | null {
  if (!isClaimExecutionReview(review)) throw new Error("Invalid claim review");
  const key = claimJournalKey(review), raw = storage.getItem(key);
  if (raw === null) return null;
  if (raw.length > maxRecordBytes) throw new Error("Claim journal is oversized; preserve the original transaction.");
  const j: unknown = JSON.parse(raw);
  if (!validJournal(j) || claimJournalKey(j.review) !== key) throw new Error("Claim journal identity is invalid.");
  return j;
}
export function listClaimJournals(storage: Storage, factory?: string): ClaimRecoveryJournal[] {
  return keys(storage).map(key => {
    const raw = storage.getItem(key);
    if (!raw || raw.length > maxRecordBytes) throw new Error("A recorded claim intent is missing. Recovery is required.");
    const j: unknown = JSON.parse(raw);
    if (!validJournal(j) || claimJournalKey(j.review) !== key) throw new Error("Recorded claim identity is invalid.");
    return j;
  }).filter(j => !factory || same(j.review.inner.factory, factory)).sort((a, b) => b.createdAt - a.createdAt);
}
/** A proven canonical L2 payment can release the account's next nonce while
 * its immutable journal continues to disclose unverified Ethereum L1 finality.
 * The claim controller separately enforces per-payer and per-Safe nonce locks. */
export function assertNoPendingProductionClaim(storage: Storage, account: string, candidateNonce?: string) {
  const journals = listClaimJournals(storage).filter(j => j.review.chainId === 4663 && same(j.review.gasPayer, account));
  assertProductionNonceAvailable(storage, account, candidateNonce);
  assertProductionNonceAboveConsumed(candidateNonce, journals.filter(consumedProductionClaim).map(j => j.review.gasPayerEvidence.nonce));
  if (journals.some(j => !terminal(j) && !canonicalProductionClaim(j))) {
    throw new Error("Recover the original production claim before another financial request");
  }
}
export function storeClaimJournal(storage: Storage, journal: ClaimRecoveryJournal) {
  if (!validJournal(journal)) throw new Error("Invalid claim recovery record");
  const raw = JSON.stringify(journal); if (raw.length > maxRecordBytes) throw new Error("Claim journal exceeds its storage bound");
  const key = claimJournalKey(journal.review), all = keys(storage);
  const old = readClaimJournal(storage, journal.review);
  if (old && (old.review.reviewHash !== journal.review.reviewHash || (old.transactionHash && old.transactionHash !== journal.transactionHash)
    || old.createdAt !== journal.createdAt)) throw new Error("The original submitted claim cannot be replaced");
  if (!all.includes(key) && all.length >= maxRecords) throw new Error("The bounded claim journal is full; export existing receipts before another claim.");
  // No wallet request happens until both records are read back. A crash before
  // the index write can leave only an unsubmitted orphan, never a sent intent.
  storage.setItem(key, raw);
  storage.setItem(indexKey, JSON.stringify({ schemaVersion: 1, keys: all.includes(key) ? all : [...all, key] }));
  if (storage.getItem(key) !== raw || !keys(storage).includes(key)) throw new Error("Claim intent could not be durably recorded");
}
function matchingResult(j: Pick<ClaimRecoveryJournal, "review" | "transactionHash">, r: ClaimSettlementResult) {
  const v = j.review;
  const uint = (n: unknown): n is string => typeof n === "string" && /^(0|[1-9][0-9]{0,77})$/.test(n) && BigInt(n) < 2n ** 256n;
  const point = (p: unknown): p is NonNullable<ClaimSettlementResult["canonicalAt"]> => !!p && typeof p === "object"
    && "blockNumber" in p && uint(p.blockNumber) && "blockHash" in p && isTransactionHash(p.blockHash)
    && "timestamp" in p && typeof p.timestamp === "string" && Number.isFinite(Date.parse(p.timestamp));
  if (r.schemaVersion !== 1 || r.profile !== claimSettlementProfile || r.chainId !== v.chainId || r.executionEnabled !== false
    || r.scope !== (v.chainId === 31337 ? "synthetic-local" : "production-read-only")
    || !claimSettlementStages.includes(r.stage) || r.intentHash !== v.intentHash || r.reviewHash !== v.reviewHash
    || (r.transactionHash !== undefined && !isTransactionHash(r.transactionHash))
    || (j.transactionHash && r.transactionHash && !same(j.transactionHash, r.transactionHash)) || typeof r.receiptObserved !== "boolean"
    || !r.providers || !["agree", "conflict", "unavailable"].includes(r.providers.status) || !Array.isArray(r.providers.ids)
    || r.providers.ids.length > 2 || r.providers.ids.some(id => typeof id !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(id))
    || new Set(r.providers.ids).size !== r.providers.ids.length || (r.canonicalAt !== undefined && !point(r.canonicalAt))
    || !r.finality || r.finality.productionPolicySupported !== false || !["unverified", "synthetic-local"].includes(r.finality.status)
    || !["unverified", "not-applicable"].includes(r.finality.l1Finality)
    || ![null, "synthetic-local-v1"].includes(r.finality.policy) || typeof r.finality.reason !== "string" || r.finality.reason.length > 1024) return false;
  if (r.stage === "reverted" && (!r.receiptObserved || !r.transactionHash || !point(r.canonicalAt) || r.providers.status !== "agree"
    || r.providers.ids.length !== 2 || !["success", "reverted"].includes(r.outerReceiptStatus ?? "") || r.innerExecution !== "reverted")) return false;
  if (r.stage === "receipt-observed" && (!r.receiptObserved || !r.transactionHash || !point(r.canonicalAt)
    || r.providers.ids.length !== 2 || !["agree", "unavailable"].includes(r.providers.status)
    || r.outerReceiptStatus !== "success" || r.innerExecution !== "unproven"
    || BigInt(r.canonicalAt.blockNumber) <= BigInt(v.inner.reviewBlockNumber))) return false;
  if (["canonical-l2", "indexing-pending", "settled"].includes(r.stage)) {
    const a = r.activity;
    if (!r.receiptObserved || !point(r.canonicalAt) || !a || !r.transactionHash || r.providers.status !== "agree" || r.providers.ids.length !== 2
      || r.outerReceiptStatus !== "success" || r.innerExecution !== "success" || a.schemaVersion !== 1
      || a.intentHash !== v.intentHash || a.chainId !== v.chainId || !same(a.gasPayer, v.gasPayer)
      || !same(a.actor, v.actor) || !same(a.beneficiary, v.beneficiary) || !same(a.ledger, v.inner.ledger)
      || !same(a.factory, v.inner.factory) || !same(a.transactionHash, r.transactionHash)
      || a.operation !== v.inner.operation || a.outerNonce !== v.gasPayerEvidence.nonce || a.innerNonce !== BigInt(v.inner.nonce).toString()
      || !same(a.deploymentBlockHash, v.inner.deploymentBlockHash)
      || (v.inner.operation === "creation-fees" ? a.token !== null : !a.token || !same(a.token, v.inner.token))
      || !uint(a.blockNumber) || BigInt(a.blockNumber) < BigInt(v.inner.reviewBlockNumber) || BigInt(a.blockNumber) > BigInt(r.canonicalAt.blockNumber) || !isTransactionHash(a.blockHash)
      || !Number.isSafeInteger(a.logIndex) || a.logIndex < 0 || !uint(a.nativeWei) || !uint(a.tokenWei)
      || !r.amounts || r.amounts.nativeWei !== a.nativeWei || r.amounts.tokenWei !== a.tokenWei
      || BigInt(a.nativeWei) < BigInt(v.inner.expectedNativeWei) || BigInt(a.tokenWei) < BigInt(v.inner.expectedTokenWei)
      || (["curve-claim", "creation-fees", "lp-claim-native"].includes(v.inner.operation) && a.tokenWei !== "0")
      || (v.inner.operation === "lp-claim-token" && a.nativeWei !== "0")
      || (v.inner.operation.startsWith("lp-") ? !a.pool || a.pool.positionTokenId !== v.inner.positionTokenId
        || a.pool.principalLiquidityWei !== v.inner.principalLiquidityWei : a.pool !== null)
      || (r.stage === "indexing-pending" ? r.indexed !== false : r.indexed !== true)) return false;
  }
  if (r.stage === "settled" && (v.chainId !== 31337 || r.finality.status !== "synthetic-local" || r.finality.policy !== "synthetic-local-v1" || !r.indexed)) return false;
  return true;
}
export function applyClaimSettlement(storage: Storage, original: ClaimRecoveryJournal, result: ClaimSettlementResult, now = Date.now()) {
  if (!matchingResult(original, result)) throw new Error("Settlement response does not match the original claim");
  // An entered recovery hash is only a candidate. An unavailable response or a
  // pending transaction has not proved its exact receipt/envelope identity and
  // must not permanently pin a typo as the immutable original transaction.
  // A hash already returned by the submitting wallet is always retained.
  const boundReceipt = result.receiptObserved && !!result.canonicalAt && result.providers.status === "agree"
    && result.providers.ids.length === 2 && ["receipt-observed", "canonical-l2", "indexing-pending", "settled", "reverted"].includes(result.stage);
  const next: ClaimRecoveryJournal = { ...original, stage: result.stage,
    transactionHash: original.transactionHash ?? (boundReceipt ? result.transactionHash ?? null : null),
    verification: result, updatedAt: Math.max(now, original.updatedAt) };
  if (next.review.chainId === 4663 && consumedProductionClaim(next)) {
    if (!next.transactionHash) throw new Error("Canonical claim receipt identity is required before releasing its nonce");
    // Persist the monotone shared floor before the original intent can be
    // considered released. A failed floor write leaves its old journal intact.
    recordProductionConsumedNonce(storage, next.review.gasPayer, next.review.gasPayerEvidence.nonce, next.transactionHash);
  }
  storeClaimJournal(storage, next); return next;
}

type Wallet = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
type ClaimSubmissionInput = { review: ClaimExecutionReview; storage: Storage; wallet: Wallet;
  location: Pick<Location, "protocol" | "hostname" | "port">;
  revalidate(review: ClaimExecutionReview): Promise<{ status: string; reviewHash?: Hex }>;
  reconcilePrior?(journal: ClaimRecoveryJournal): Promise<ClaimSettlementResult>;
  now?: () => number };

/** Separate production entry point. The historical isolated sender retains its
 * exact loopback-only guard. A production review is usable only after the active
 * server approval binding and the complete unchanged review are revalidated. */
export async function submitProductionClaim(input: Omit<ClaimSubmissionInput, "revalidate"> & {
  approvalBinding: string;
  revalidate(review: ClaimExecutionReview): Promise<{ status: string; executionEnabled?: boolean; approvalBinding?: string; review?: ClaimExecutionReview }>;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.approvalBinding)) throw new Error("Financial approval binding unavailable");
  return submitClaim({ ...input, revalidate: async review => {
    const checked = await input.revalidate(review);
    if (checked.status !== "revalidated" || checked.executionEnabled !== true || checked.approvalBinding !== input.approvalBinding
      || !isClaimExecutionReview(checked.review) || checked.review.chainId !== 4663 || checked.review.reviewHash !== review.reviewHash) {
      throw new Error("Production claim approval or reviewed transaction changed");
    }
    return { status: "unchanged", reviewHash: checked.review.reviewHash };
  } }, "production");
}
/** The historical entry point retains its loopback-only synthetic guard. */
export async function submitIsolatedClaim(input: ClaimSubmissionInput) { return submitClaim(input, "isolated"); }
async function submitClaim(input: ClaimSubmissionInput, mode: "isolated" | "production") {
  const { storage, wallet, location } = input, now = input.now ?? Date.now;
  const review = structuredClone(input.review);
  const isolated = mode === "isolated" && review.chainId === 31337 && review.scope === "isolated-local" && review.fees.status === "synthetic-local"
    && location.protocol === "http:" && location.hostname === "127.0.0.1" && !!location.port;
  const production = mode === "production" && review.chainId === 4663 && review.scope === "production-unsigned"
    && ["verified-nitro", "verified-nitro-zero-poster"].includes(review.fees.status) && isProductionWalletOrigin(location);
  if (!isClaimExecutionReview(review) || (!isolated && !production) || review.status !== "review-only" || !review.outer) {
    throw new Error("Claim execution requires the approved network, origin and wallet profile");
  }
  if (now() >= review.expiresAt * 1000 || claimExecutionIdentity(review) !== review.intentHash) throw new Error("The claim review has expired");
  // Imported after the profile gate to avoid a cycle with the trade controller's
  // claim-journal guard. No wallet method runs during this read-only import.
  const pendingTrade = production ? (await import("./production-trading-wallet")).assertNoPendingProductionTrade : undefined;
  const safeRetryProofs = new Set<string>();
  const assertAvailable = () => {
    if (production) {
      pendingTrade!(storage, review.gasPayer, review.gasPayerEvidence.nonce);
      assertNoPendingProductionCreation(storage, review.gasPayer, review.gasPayerEvidence.nonce);
      assertProductionNonceAvailable(storage, review.gasPayer, review.gasPayerEvidence.nonce);
    }
    assertNoPendingReclaim(storage, review.gasPayer);
    const existing = readClaimJournal(storage, review);
    if (existing && !(existing.stage === "wallet-rejected" && !existing.transactionHash && existing.review.reviewHash === review.reviewHash)) {
      throw new Error("Recover the original claim; it cannot be submitted again");
    }
    for (const j of listClaimJournals(storage)) {
      if (production && j.review.chainId === 4663 && same(j.review.gasPayer, review.gasPayer) && consumedProductionClaim(j)) {
        assertProductionNonceAboveConsumed(review.gasPayerEvidence.nonce, [j.review.gasPayerEvidence.nonce]);
      }
      if (j.review.intentHash === review.intentHash) continue;
      const rejectedRenewal = rejectedSafeRenewal(j, review);
      if (production && j.review.chainId === 4663 && same(j.review.gasPayer, review.gasPayer)
        && !terminal(j) && !canonicalProductionClaim(j) && !rejectedRenewal) throw new Error("Recover the original production claim before another financial request");
      if (!terminal(j) && slot(j.review) === slot(review) && !rejectedRenewal) throw new Error("Another project or claim uses this wallet nonce. Recover it before continuing.");
      if (safeSlot(review) && safeSlot(j.review) === safeSlot(review)
        && (!terminal(j) || provenSafeOuterRevert(j))) {
        if (rejectedRenewal) continue;
        if (!provenSafeOuterRevert(j) || !sameSafeProposal(j.review, review) || !safeRetryProofs.has(j.review.reviewHash)
          || same(j.review.gasPayer, review.gasPayer) && BigInt(review.gasPayerEvidence.nonce) <= BigInt(j.review.gasPayerEvidence.nonce)) {
          throw new Error("This Safe nonce has an earlier authorization. Recover it; only the same proven-reverted Safe proposal may receive a fresh payer review.");
        }
      }
    }
    const legacy = readEarningsClaimJournal(storage, { ...review.inner, from: review.gasPayer });
    const legacyKey = `rmt.earnings.pending.v1:${review.inner.chainId}:${review.inner.factory.toLowerCase()}:${review.gasPayer.toLowerCase()}`;
    if (storage.getItem(legacyKey) !== null && !legacy) throw new Error("Earlier earnings recovery identity is invalid; preserve the original request");
    if (legacy && !["confirmed", "reverted"].includes(legacy.state)) throw new Error("Recover the earlier earnings transaction first");
    return existing;
  };
  // Known Safe outer reverts leave the proposal nonce available. A fresh,
  // read-only reconciliation is mandatory before any explicit same-proposal
  // retry; a stale stored revert or wallet rejection is not revocation.
  for (const j of listClaimJournals(storage)) {
    if (safeSlot(review) && safeSlot(j.review) === safeSlot(review) && provenSafeOuterRevert(j) && sameSafeProposal(j.review, review) && input.reconcilePrior) {
      const result = await input.reconcilePrior(j), checked = applyClaimSettlement(storage, j, result, now());
      if (provenSafeOuterRevert(checked)) safeRetryProofs.add(j.review.reviewHash);
    }
  }
  let existing = assertAvailable();
  // Retain Task074 pending intents; switching controller versions cannot erase
  // an uncertain original direct-wallet broadcast.
  const checkWallet = async () => {
    const needsDelegate = review.kind === "metamask-7702" || review.gasPayerEvidence.kind === "metamask-7702";
    const [accounts, chain, nonce, actorCode, payerCode, checkpoint, targetCode, delegateCode, deployment, originalAnchor] = await Promise.all([
      wallet.request({ method: "eth_accounts" }), wallet.request({ method: "eth_chainId" }),
      wallet.request({ method: "eth_getTransactionCount", params: [review.gasPayer, "pending"] }),
      wallet.request({ method: "eth_getCode", params: [review.actor, "latest"] }),
      wallet.request({ method: "eth_getCode", params: [review.gasPayer, "latest"] }),
      wallet.request({ method: "eth_getBlockByNumber", params: ["0x" + BigInt(review.observed.blockNumber).toString(16), false] }),
      wallet.request({ method: "eth_getCode", params: [review.inner.to, "latest"] }),
      needsDelegate ? wallet.request({ method: "eth_getCode", params: [claimDelegatePin.address, "latest"] }) : undefined,
      production ? wallet.request({ method: "eth_getBlockByNumber", params: [review.inner.deploymentBlockNumber, false] }) : undefined,
      production ? wallet.request({ method: "eth_getBlockByNumber", params: [review.inner.reviewBlockNumber, false] }) : undefined,
    ]);
    const codeHash = (code: unknown) => typeof code === "string" && /^0x(?:[0-9a-f]{2}){0,24576}$/i.test(code) ? keccak256(code as Hex) : null;
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !same(accounts[0], review.gasPayer) || chain !== review.inner.chainId
      || typeof nonce !== "string" || !/^0x[0-9a-f]+$/i.test(nonce) || BigInt(nonce) !== BigInt(review.gasPayerEvidence.nonce)
      || codeHash(actorCode) !== review.wallet.actorCodeHash || codeHash(payerCode) !== review.gasPayerEvidence.codeHash
      || codeHash(targetCode) !== review.inner.targetRuntimeHash || (needsDelegate && codeHash(delegateCode) !== claimDelegatePin.runtimeHash)
      || !checkpoint || typeof checkpoint !== "object" || !("hash" in checkpoint) || typeof checkpoint.hash !== "string" || !same(checkpoint.hash, review.observed.blockHash)
      || !("number" in checkpoint) || typeof checkpoint.number !== "string" || !/^0x[0-9a-f]+$/i.test(checkpoint.number) || BigInt(checkpoint.number) !== BigInt(review.observed.blockNumber)) {
      throw new Error("Wallet account, network, nonce, runtime or reviewed checkpoint changed");
    }
    if (production && review.fees.status === "verified-nitro-zero-poster") {
      const observed = checkpoint as { baseFeePerGas?: unknown };
      if (typeof observed.baseFeePerGas !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(observed.baseFeePerGas)
        || BigInt(observed.baseFeePerGas) !== BigInt(review.fees.zeroPosterPolicy.l2BaseFeeWei)) throw new Error("Wallet native fee policy checkpoint changed");
    }
    const anchored = (value: unknown, number: Hex, hash: Hex) => value && typeof value === "object"
      && "number" in value && typeof value.number === "string" && /^0x[0-9a-f]+$/i.test(value.number) && BigInt(value.number) === BigInt(number)
      && "hash" in value && typeof value.hash === "string" && same(value.hash, hash);
    if (production && (!anchored(deployment, review.inner.deploymentBlockNumber, review.inner.deploymentBlockHash)
      || !anchored(originalAnchor, review.inner.reviewBlockNumber, review.inner.reviewBlockHash))) throw new Error("Wallet deployment or original review anchor changed");
  };
  await checkWallet(); const verified = await input.revalidate(review);
  if (verified.status !== "unchanged" || verified.reviewHash !== review.reviewHash) throw new Error("Claim preflight changed; review fresh terms");
  await checkWallet();
  if (now() >= review.expiresAt * 1000) throw new Error("The claim review has expired");
  // All asynchronous reads are over. The caller holds every resource lock;
  // immediately recheck storage before the synchronous durable intent write.
  existing = assertAvailable();
  const entry: ClaimRecoveryJournal = { schemaVersion: 1, profile: "rmt-claim-recovery-v1", review,
    stage: "awaiting-wallet", transactionHash: null, verification: null, createdAt: existing?.createdAt ?? now(), updatedAt: now() };
  storeClaimJournal(storage, entry);
  try {
    const hash = await wallet.request({ method: "eth_sendTransaction", params: [review.outer] });
    const next: ClaimRecoveryJournal = { ...entry, stage: isTransactionHash(hash) ? "submitted" : "hash-missing",
      transactionHash: isTransactionHash(hash) ? hash : null, updatedAt: now() };
    storeClaimJournal(storage, next); return next;
  } catch (error) {
    const next: ClaimRecoveryJournal = { ...entry, stage: testWalletErrorCode(error) === 4001 ? "wallet-rejected" : "hash-missing", updatedAt: now() };
    storeClaimJournal(storage, next); throw error;
  }
}
