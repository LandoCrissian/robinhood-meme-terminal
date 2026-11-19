import { nftHash, sameNftHex } from "./nft-acquisition";
import { isNftAcquisitionSafeApproval, isNftAcquisitionSafeOuterReview, isNftAcquisitionSafeProposal, nftAcquisitionSafeVerificationMatches,
  type NftAcquisitionSafeApproval, type NftAcquisitionSafeOuterReview, type NftAcquisitionSafeProposal, type NftAcquisitionSafeVerification } from "./nft-acquisition-safe";

export const nftAcquisitionSafeJournalNamespace = "rmt.nft-acquisition.safe.v1";
const indexKey = nftAcquisitionSafeJournalNamespace + ":index";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
export type NftAcquisitionSafeJournal = { schemaVersion: 1; proposal: NftAcquisitionSafeProposal; approvals: NftAcquisitionSafeApproval[];
  outerReview: NftAcquisitionSafeOuterReview | null; stage: "proposal" | "awaiting-owner" | "approvals-ready" | "awaiting-wallet" | "wallet-rejected" | "hash-missing" | NftAcquisitionSafeVerification["status"];
  transactionHash: string | null; result: NftAcquisitionSafeVerification | null; createdAt: number; updatedAt: number };
const bytes = (v: string) => new TextEncoder().encode(v).byteLength;
const keyFor = (entry: NftAcquisitionSafeJournal) => nftAcquisitionSafeJournalNamespace + ":" + entry.proposal.proposalHash;
export function validNftAcquisitionSafeJournal(value: unknown): value is NftAcquisitionSafeJournal {
  try {
    const e = value as NftAcquisitionSafeJournal;
    if (!e || Object.keys(e).length !== 9 || e.schemaVersion !== 1 || !isNftAcquisitionSafeProposal(e.proposal)
      || !Array.isArray(e.approvals) || e.approvals.length > 2 || !e.approvals.every(a => isNftAcquisitionSafeApproval(e.proposal, a))
      || new Set(e.approvals.map(a => a.signer.toLowerCase())).size !== e.approvals.length
      || !["proposal", "awaiting-owner", "approvals-ready", "awaiting-wallet", "wallet-rejected", "hash-missing", "pending", "confirmed", "reverted", "unavailable", "reorged"].includes(e.stage)
      || !Number.isSafeInteger(e.createdAt) || e.createdAt <= 0 || !Number.isSafeInteger(e.updatedAt) || e.updatedAt < e.createdAt
      || e.transactionHash !== null && !nftHash(e.transactionHash)) return false;
    if (e.outerReview !== null && (!isNftAcquisitionSafeOuterReview(e.outerReview) || e.outerReview.proposal.proposalHash !== e.proposal.proposalHash
      || JSON.stringify(e.outerReview.approvals) !== JSON.stringify(e.approvals))) return false;
    if (["awaiting-wallet", "wallet-rejected", "hash-missing", "pending", "confirmed", "reverted", "unavailable", "reorged"].includes(e.stage) && !e.outerReview) return false;
    if (e.result !== null && (!e.outerReview || e.stage !== e.result.status || !nftAcquisitionSafeVerificationMatches(e.outerReview, e.result, e.transactionHash ?? undefined))) return false;
    return !["confirmed", "reverted"].includes(e.stage) || !!e.result && !!e.transactionHash && sameNftHex(e.result.transactionHash ?? "", e.transactionHash);
  } catch { return false; }
}
export function listNftAcquisitionSafeJournals(storage: StoragePort): NftAcquisitionSafeJournal[] {
  const raw = storage.getItem(indexKey); if (raw === null) return [];
  if (bytes(raw) > 8192) throw Error("Safe recovery index exceeds its bound. Preserve the original proposals.");
  let keys: unknown; try { keys = JSON.parse(raw); } catch { throw Error("Safe recovery index is malformed. Preserve original approvals."); }
  if (!Array.isArray(keys) || keys.length > 32 || new Set(keys).size !== keys.length
    || keys.some(k => typeof k !== "string" || !/^rmt\.nft-acquisition\.safe\.v1:0x[0-9a-f]{64}$/i.test(k))) throw Error("Safe recovery identity is invalid.");
  return keys.map(key => {
    const body = storage.getItem(key); if (!body || bytes(body) > 65536) throw Error("Original Safe proposal is missing or exceeds 64 KiB.");
    let value: unknown; try { value = JSON.parse(body); } catch { throw Error("Original Safe proposal is malformed."); }
    if (!validNftAcquisitionSafeJournal(value) || keyFor(value) !== key) throw Error("Original Safe proposal identity is invalid."); return value;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
export function storeNftAcquisitionSafeJournal(storage: StoragePort, entry: NftAcquisitionSafeJournal): void {
  if (!validNftAcquisitionSafeJournal(entry)) throw Error("Invalid Safe recovery record.");
  const all = listNftAcquisitionSafeJournals(storage), prior = all.find(e => e.proposal.proposalHash === entry.proposal.proposalHash);
  if (!prior && all.length >= 32) throw Error("Safe recovery is full. Original proposals will not be evicted.");
  if (prior && (prior.createdAt !== entry.createdAt || entry.updatedAt < prior.updatedAt
    || prior.transactionHash !== null && (entry.transactionHash === null || !sameNftHex(prior.transactionHash, entry.transactionHash)))) throw Error("Original Safe transaction identity cannot be replaced.");
  const body = JSON.stringify(entry); if (bytes(body) > 65536) throw Error("Safe recovery record exceeds 64 KiB.");
  storage.setItem(keyFor(entry), body); storage.setItem(indexKey, JSON.stringify(prior ? all.map(keyFor) : [...all.map(keyFor), keyFor(entry)]));
  if (storage.getItem(keyFor(entry)) !== body || !listNftAcquisitionSafeJournals(storage).some(e => e.proposal.proposalHash === entry.proposal.proposalHash)) throw Error("Safe proposal could not be saved before the wallet request.");
}
/** Never turn an unavailable manual hash into the immutable Safe journal hash. */
export function reconcileNftAcquisitionSafeRecovery(original: NftAcquisitionSafeJournal, result: NftAcquisitionSafeVerification, now: number, candidateHash?: string): NftAcquisitionSafeJournal {
  if (!validNftAcquisitionSafeJournal(original) || !original.outerReview || candidateHash !== undefined && (!nftHash(candidateHash)
    || original.transactionHash !== null && !sameNftHex(candidateHash, original.transactionHash))
    || !nftAcquisitionSafeVerificationMatches(original.outerReview, result, original.transactionHash ?? candidateHash)) throw Error("Recovery does not match the original Safe transaction.");
  const canonical = result.status === "confirmed" || result.status === "reverted";
  const transactionHash = original.transactionHash ?? (canonical ? result.transactionHash! : null);
  const retained = { ...result }; if (transactionHash === null) delete retained.transactionHash;
  const next: NftAcquisitionSafeJournal = { ...original, transactionHash, result: retained, stage: retained.status, updatedAt: now };
  if (!validNftAcquisitionSafeJournal(next)) throw Error("Recovery cannot replace the original Safe identity."); return next;
}
export function assertNoPendingNftAcquisitionSafe(storage: StoragePort, account: string): void {
  if (listNftAcquisitionSafeJournals(storage).some(e => ["awaiting-wallet", "hash-missing", "pending", "unavailable", "reorged"].includes(e.stage)
    && (sameNftHex(e.proposal.safe, account) || sameNftHex(e.proposal.gasPayer, account)))) throw Error("Recover the original Safe transaction before requesting another wallet submission.");
}
