import { isReclaimReview, reclaimAddress, reclaimHash, reclaimVerificationMatches, sameReclaimHex, type ReclaimReview, type ReclaimVerification } from "./reclaim";
import { isTestLifecycleRequest } from "./test-lifecycle";
import { claimProfileDigest } from "./claim-profiles";
import { assertNoPendingReclaimSafe } from "./reclaim-safe-recovery";

export const reclaimJournalNamespace = "rmt.reclaim.pending.v2";
const indexKey = reclaimJournalNamespace + ":index";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
export type ReclaimJournal = { schemaVersion: 2; review: ReclaimReview; stage: "awaiting-wallet" | "wallet-rejected" | "hash-missing" | ReclaimVerification["status"];
  transactionHash: string | null; result: ReclaimVerification | null; createdAt: number; updatedAt: number };
const keyFor = (review: ReclaimReview) => `${reclaimJournalNamespace}:${review.reviewHash}`;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
export function reclaimCampaignIntentKey(account: string): string {
  if (!reclaimAddress(account)) throw Error("A valid campaign creator is required.");
  return "rmt.reclaim.intent.v2:" + account.toLowerCase();
}
export const reclaimJournalTerminal = (entry: ReclaimJournal) => ["confirmed", "reverted", "wallet-rejected"].includes(entry.stage);
export function validReclaimJournal(value: unknown): value is ReclaimJournal {
  try {
    const entry = value as ReclaimJournal;
    return !!entry && Object.keys(entry).length === 7 && entry.schemaVersion === 2 && isReclaimReview(entry.review) && entry.review.status === "prepared"
      && ["awaiting-wallet", "wallet-rejected", "hash-missing", "pending", "confirmed", "reverted", "unavailable", "reorged"].includes(entry.stage)
      && (entry.transactionHash === null || reclaimHash(entry.transactionHash)) && Number.isSafeInteger(entry.createdAt) && entry.createdAt > 0
      && Number.isSafeInteger(entry.updatedAt) && entry.updatedAt >= entry.createdAt
      && (entry.result === null ? !["confirmed", "reverted"].includes(entry.stage) : entry.result.status === entry.stage
        && reclaimVerificationMatches(entry.review, entry.result, entry.transactionHash ?? undefined)
        && (!["confirmed", "reverted"].includes(entry.stage) || entry.transactionHash !== null && sameReclaimHex(entry.transactionHash, entry.result.transactionHash ?? "")));
  } catch { return false; }
}
export function listReclaimJournals(storage: StoragePort): ReclaimJournal[] {
  const raw = storage.getItem(indexKey); if (raw === null) return [];
  if (byteLength(raw) > 8192) throw Error("Reclaim recovery index exceeds its bound. Preserve the original requests.");
  let keys: unknown; try { keys = JSON.parse(raw); } catch { throw Error("Reclaim recovery index is invalid. Preserve the original requests."); }
  if (!Array.isArray(keys) || keys.length > 32 || new Set(keys).size !== keys.length
    || keys.some(key => typeof key !== "string" || !/^rmt\.reclaim\.pending\.v2:0x[0-9a-f]{64}$/i.test(key))) throw Error("Reclaim recovery index is invalid.");
  return keys.map(key => {
    const body = storage.getItem(key); if (!body || byteLength(body) > 65536) throw Error("An original Reclaim request is missing or exceeds its bound.");
    let entry: unknown; try { entry = JSON.parse(body); } catch { throw Error("An original Reclaim request is malformed."); }
    if (!validReclaimJournal(entry) || keyFor(entry.review) !== key) throw Error("An original Reclaim request has an invalid identity.");
    return entry;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
export function storeReclaimJournal(storage: StoragePort, entry: ReclaimJournal): void {
  if (!validReclaimJournal(entry)) throw Error("Invalid Reclaim recovery record.");
  const all = listReclaimJournals(storage), prior = all.find(item => item.review.reviewHash === entry.review.reviewHash);
  if (prior && (prior.createdAt !== entry.createdAt || prior.review.reviewHash !== entry.review.reviewHash || entry.updatedAt < prior.updatedAt
    || prior.transactionHash !== null && (!entry.transactionHash || !sameReclaimHex(prior.transactionHash, entry.transactionHash)))) throw Error("The original Reclaim transaction identity cannot be replaced.");
  if (!prior && all.length >= 32) throw Error("Reclaim recovery is full. No original request will be evicted.");
  const body = JSON.stringify(entry); if (byteLength(body) > 65536) throw Error("Reclaim recovery record exceeds its 64 KiB bound.");
  storage.setItem(keyFor(entry.review), body);
  storage.setItem(indexKey, JSON.stringify(prior ? all.map(item => keyFor(item.review)) : [...all.map(item => keyFor(item.review)), keyFor(entry.review)]));
  if (storage.getItem(keyFor(entry.review)) !== body || !listReclaimJournals(storage).some(item => item.review.reviewHash === entry.review.reviewHash)) throw Error("The original Reclaim request could not be saved before wallet confirmation.");
}
/** A manually entered hash is an untrusted recovery hint. Only a canonical
 * terminal result may establish an absent original hash. Wallet-returned and
 * previously established hashes remain immutable even during provider failure. */
export function reconcileReclaimRecovery(original: ReclaimJournal, result: ReclaimVerification, now: number, candidateHash?: string): ReclaimJournal {
  if (!validReclaimJournal(original) || candidateHash !== undefined && (!reclaimHash(candidateHash)
    || original.transactionHash !== null && !sameReclaimHex(candidateHash, original.transactionHash))
    || !reclaimVerificationMatches(original.review, result, original.transactionHash ?? candidateHash)) throw Error("Recovery does not match the original Reclaim transaction.");
  const canonical = result.status === "confirmed" || result.status === "reverted";
  const transactionHash = original.transactionHash ?? (canonical ? result.transactionHash! : null);
  const retained = { ...result }; if (transactionHash === null) delete retained.transactionHash;
  const next: ReclaimJournal = { ...original, transactionHash, result: retained, stage: retained.status, updatedAt: now };
  if (!validReclaimJournal(next)) throw Error("Recovery cannot replace the original Reclaim identity."); return next;
}
export function assertNoPendingReclaim(storage: StoragePort, account: string): void {
  assertNoPendingHistoricalReclaim(storage, account);
  assertNoPendingReclaimSafe(storage, account);
  if (listReclaimJournals(storage).some(entry => sameReclaimHex(entry.review.actor, account) && !reclaimJournalTerminal(entry))) {
    throw Error("Recover the earlier Reclaim transaction before requesting another wallet submission.");
  }
}

/** Preserve rejected V1 records without admitting any old operation, selector
 * or repayment/return request into the active V2 interface. */
export function assertNoPendingHistoricalReclaim(storage: Pick<Storage, "getItem">, account: string): void {
  const raw = storage.getItem("rmt.reclaim.pending.v1:index"); if (raw === null) return;
  if (byteLength(raw) > 8192) throw Error("Historical Reclaim index exceeds its bound. Preserve original evidence.");
  let keys: unknown; try { keys = JSON.parse(raw); } catch { throw Error("Historical Reclaim index is malformed. Preserve original evidence."); }
  if (!Array.isArray(keys) || keys.length > 32 || new Set(keys).size !== keys.length
    || keys.some(k => typeof k !== "string" || !/^rmt\.reclaim\.pending\.v1:0x[0-9a-f]{64}$/i.test(k))) throw Error("Historical Reclaim identity is invalid.");
  for (const key of keys) {
    const body = storage.getItem(key); if (!body || byteLength(body) > 65536) throw Error("Historical Reclaim request is missing or exceeds its bound.");
    let value: unknown; try { value = JSON.parse(body); } catch { throw Error("Historical Reclaim record is malformed."); }
    const entry = value as { schemaVersion: number; stage: string; transactionHash: string | null; result: null | {status: string;transactionHash?:string;reviewHash:string}; review: {schemaVersion:number;profile:string;actor:string;reviewHash:string} };
    if (!entry || entry.schemaVersion !== 1 || !entry.review || entry.review.schemaVersion !== 1 || entry.review.profile !== "rmt-reclaim-v1"
      || !reclaimAddress(entry.review.actor) || !reclaimHash(entry.review.reviewHash) || key !== "rmt.reclaim.pending.v1:" + entry.review.reviewHash
      || !["awaiting-wallet", "wallet-rejected", "hash-missing", "pending", "confirmed", "reverted", "unavailable", "reorged"].includes(entry.stage)
      || entry.transactionHash !== null && !reclaimHash(entry.transactionHash)) throw Error("Historical Reclaim record has an invalid identity.");
    const {reviewHash,...reviewBody}=entry.review;
    if (claimProfileDigest(reviewBody) !== reviewHash) throw Error("Historical Reclaim review digest changed. Preserve original evidence.");
    const terminal = entry.stage === "wallet-rejected" && entry.transactionHash === null || ["confirmed", "reverted"].includes(entry.stage)
      && entry.result?.status === entry.stage && entry.result.reviewHash === reviewHash && !!entry.transactionHash && sameReclaimHex(entry.result.transactionHash ?? "",entry.transactionHash);
    if (sameReclaimHex(entry.review.actor,account) && !terminal) throw Error("Historical V1 Reclaim request remains unresolved. It cannot be executed by this permanent-retirement candidate.");
  }
}

export function canStartAnotherReclaimCampaign(entry: ReclaimJournal): boolean {
  if (!validReclaimJournal(entry) || entry.review.operation !== "create-campaign" || entry.stage !== "confirmed" || entry.result?.status !== "confirmed"
    || entry.result.indexed !== true || !entry.result.snapshot || !entry.result.canonical) return false;
  const snapshot = entry.result.snapshot;
  return snapshot.history.indexed && snapshot.history.status === "ready" && sameReclaimHex(snapshot.creator, entry.review.actor)
    && sameReclaimHex(snapshot.controller, entry.review.fields.controller!) && BigInt(snapshot.observed.blockNumber) >= BigInt(entry.result.canonical.blockNumber);
}

/** Explicit user action only. Release the matching creation intent after
 * canonical indexing, while preserving every original transaction and hash. */
export function startAnotherReclaimCampaign(storage: StoragePort & Pick<Storage, "removeItem">, entry: ReclaimJournal, account: string): void {
  if (!sameReclaimHex(entry.review.actor, account) || !canStartAnotherReclaimCampaign(entry)) throw Error("Verify and index the original campaign creation first.");
  const stored = listReclaimJournals(storage).find(item => item.review.reviewHash === entry.review.reviewHash);
  if (!stored || !canStartAnotherReclaimCampaign(stored)) throw Error("The original campaign creation must remain verified in recovery history.");
  assertNoPendingReclaim(storage, account);
  const intentKey = reclaimCampaignIntentKey(account);
  if (storage.getItem(intentKey) !== stored.review.fields.intentId) throw Error("The current campaign intent no longer matches this confirmed creation.");
  storage.removeItem(intentKey);
  if (storage.getItem(intentKey) !== null) throw Error("The confirmed intent could not be released. Preserve the original requests.");
}

/** The older lifecycle journal has no shared index. Enumerate only this known
 * local prefix, with hard limits, and preserve malformed original records. */
export function assertNoPendingLifecycleForReclaim(storage: Pick<Storage, "length" | "key" | "getItem">, account: string): void {
  if (!Number.isSafeInteger(storage.length) || storage.length < 0 || storage.length > 256) throw Error("Browser recovery storage exceeds its inspection bound. Preserve the original requests.");
  let count = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i); if (!key?.startsWith("rmt:test-trades:31337:v1:")) continue;
    if (++count > 32 || !/^rmt:test-trades:31337:v1:0x[0-9a-f]{64}$/i.test(key)) throw Error("An earlier lifecycle recovery identity is invalid.");
    const body = storage.getItem(key); if (!body || byteLength(body) > 65536) throw Error("An earlier lifecycle request is missing or exceeds its bound.");
    let value: unknown; try { value = JSON.parse(body); } catch { throw Error("An earlier lifecycle request is malformed. Preserve its original identity."); }
    const journal = value as { pending?: { request: unknown; transactionHash?: string }; history?: { request: unknown; transactionHash?: string }[] };
    const entry = (item: { request: unknown; transactionHash?: string }) => !!item && isTestLifecycleRequest(item.request)
      && (item.transactionHash === undefined || reclaimHash(item.transactionHash));
    if (!journal || !Array.isArray(journal.history) || journal.history.length > 12 || !journal.history.every(item => entry(item) && reclaimHash(item.transactionHash))
      || journal.pending !== undefined && !entry(journal.pending)) throw Error("An earlier lifecycle recovery record is invalid. Preserve its original identity.");
    if (journal.pending && isTestLifecycleRequest(journal.pending.request) && sameReclaimHex(journal.pending.request.from, account)) {
      throw Error("Recover the earlier lifecycle transaction before requesting a Reclaim submission.");
    }
  }
}
