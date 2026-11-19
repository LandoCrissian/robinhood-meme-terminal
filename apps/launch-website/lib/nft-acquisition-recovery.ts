import { isNftAcquisitionReview, nftAddress, nftHash, nftAcquisitionVerificationMatches, sameNftHex, type NftAcquisitionReview, type NftAcquisitionVerification } from "./nft-acquisition";

export const nftAcquisitionJournalNamespace = "rmt.nft-acquisition.pending.v1";
const indexKey = nftAcquisitionJournalNamespace + ":index";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
export type NftAcquisitionJournal = { schemaVersion: 1; review: NftAcquisitionReview; stage: "awaiting-wallet" | "wallet-rejected" | "hash-missing" | NftAcquisitionVerification["status"];
  transactionHash: string | null; result: NftAcquisitionVerification | null; createdAt: number; updatedAt: number };
const keyFor = (review: NftAcquisitionReview) => `${nftAcquisitionJournalNamespace}:${review.reviewHash}`;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
export const nftAcquisitionJournalTerminal = (entry: NftAcquisitionJournal) => ["confirmed", "reverted", "wallet-rejected"].includes(entry.stage);
export function validNftAcquisitionJournal(value: unknown): value is NftAcquisitionJournal {
  try {
    const entry = value as NftAcquisitionJournal;
    return !!entry && Object.keys(entry).length === 7 && entry.schemaVersion === 1 && isNftAcquisitionReview(entry.review) && entry.review.status === "prepared"
      && ["awaiting-wallet", "wallet-rejected", "hash-missing", "pending", "confirmed", "reverted", "unavailable", "reorged"].includes(entry.stage)
      && (entry.transactionHash === null || nftHash(entry.transactionHash)) && Number.isSafeInteger(entry.createdAt) && entry.createdAt > 0
      && Number.isSafeInteger(entry.updatedAt) && entry.updatedAt >= entry.createdAt
      && (entry.result === null ? !["confirmed", "reverted"].includes(entry.stage) : entry.result.status === entry.stage
        && nftAcquisitionVerificationMatches(entry.review, entry.result, entry.transactionHash ?? undefined)
        && (!["confirmed", "reverted"].includes(entry.stage) || entry.transactionHash !== null && sameNftHex(entry.transactionHash, entry.result.transactionHash ?? "")));
  } catch { return false; }
}
export function listNftAcquisitionJournals(storage: StoragePort): NftAcquisitionJournal[] {
  const raw = storage.getItem(indexKey); if (raw === null) return [];
  if (byteLength(raw) > 8192) throw Error("NftAcquisition recovery index exceeds its bound. Preserve the original requests.");
  let keys: unknown; try { keys = JSON.parse(raw); } catch { throw Error("NftAcquisition recovery index is invalid. Preserve the original requests."); }
  if (!Array.isArray(keys) || keys.length > 32 || new Set(keys).size !== keys.length
    || keys.some(key => typeof key !== "string" || !/^rmt\.nft-acquisition\.pending\.v1:0x[0-9a-f]{64}$/i.test(key))) throw Error("NftAcquisition recovery index is invalid.");
  return keys.map(key => {
    const body = storage.getItem(key); if (!body || byteLength(body) > 65536) throw Error("An original NftAcquisition request is missing or exceeds its bound.");
    let entry: unknown; try { entry = JSON.parse(body); } catch { throw Error("An original NftAcquisition request is malformed."); }
    if (!validNftAcquisitionJournal(entry) || keyFor(entry.review) !== key) throw Error("An original NftAcquisition request has an invalid identity.");
    return entry;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
export function storeNftAcquisitionJournal(storage: StoragePort, entry: NftAcquisitionJournal): void {
  if (!validNftAcquisitionJournal(entry)) throw Error("Invalid NftAcquisition recovery record.");
  const all = listNftAcquisitionJournals(storage), prior = all.find(item => item.review.reviewHash === entry.review.reviewHash);
  if (prior && (prior.createdAt !== entry.createdAt || prior.review.reviewHash !== entry.review.reviewHash || entry.updatedAt < prior.updatedAt
    || prior.transactionHash !== null && (!entry.transactionHash || !sameNftHex(prior.transactionHash, entry.transactionHash)))) throw Error("The original NftAcquisition transaction identity cannot be replaced.");
  if (!prior && all.length >= 32) throw Error("NftAcquisition recovery is full. No original request will be evicted.");
  const body = JSON.stringify(entry); if (byteLength(body) > 65536) throw Error("NftAcquisition recovery record exceeds its 64 KiB bound.");
  storage.setItem(keyFor(entry.review), body);
  storage.setItem(indexKey, JSON.stringify(prior ? all.map(item => keyFor(item.review)) : [...all.map(item => keyFor(item.review)), keyFor(entry.review)]));
  if (storage.getItem(keyFor(entry.review)) !== body || !listNftAcquisitionJournals(storage).some(item => item.review.reviewHash === entry.review.reviewHash)) throw Error("The original NftAcquisition request could not be saved before wallet confirmation.");
}
/** A manually entered hash is an untrusted recovery hint. Only a canonical
 * terminal result may establish an absent original hash. Wallet-returned and
 * previously established hashes remain immutable even during provider failure. */
export function reconcileNftAcquisitionRecovery(original: NftAcquisitionJournal, result: NftAcquisitionVerification, now: number, candidateHash?: string): NftAcquisitionJournal {
  if (!validNftAcquisitionJournal(original) || candidateHash !== undefined && (!nftHash(candidateHash)
    || original.transactionHash !== null && !sameNftHex(candidateHash, original.transactionHash))
    || !nftAcquisitionVerificationMatches(original.review, result, original.transactionHash ?? candidateHash)) throw Error("Recovery does not match the original NftAcquisition transaction.");
  const canonical = result.status === "confirmed" || result.status === "reverted";
  const transactionHash = original.transactionHash ?? (canonical ? result.transactionHash! : null);
  const retained = { ...result }; if (transactionHash === null) delete retained.transactionHash;
  const next: NftAcquisitionJournal = { ...original, transactionHash, result: retained, stage: retained.status, updatedAt: now };
  if (!validNftAcquisitionJournal(next)) throw Error("Recovery cannot replace the original NftAcquisition identity."); return next;
}
