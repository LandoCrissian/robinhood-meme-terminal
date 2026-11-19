import { reclaimHash, sameReclaimHex } from "./reclaim";
import { isReclaimSafeApproval, isReclaimSafeOuterReview, isReclaimSafeProposal, reclaimSafeVerificationMatches,
  type ReclaimSafeApproval, type ReclaimSafeOuterReview, type ReclaimSafeProposal, type ReclaimSafeVerification } from "./reclaim-safe";

export const reclaimSafeJournalNamespace = "rmt.reclaim.safe.v2";
const indexKey = reclaimSafeJournalNamespace + ":index";
type StoragePort = Pick<Storage, "getItem" | "setItem">;
export type ReclaimSafeJournal = { schemaVersion: 1; proposal: ReclaimSafeProposal; approvals: ReclaimSafeApproval[];
  outerReview: ReclaimSafeOuterReview | null; stage: "proposal" | "awaiting-owner" | "approvals-ready" | "awaiting-wallet" | "wallet-rejected" | "hash-missing" | ReclaimSafeVerification["status"];
  transactionHash: string | null; result: ReclaimSafeVerification | null; createdAt: number; updatedAt: number };
const bytes = (v: string) => new TextEncoder().encode(v).byteLength;
const keyFor = (entry: ReclaimSafeJournal) => reclaimSafeJournalNamespace + ":" + entry.proposal.proposalHash;
export function validReclaimSafeJournal(value: unknown): value is ReclaimSafeJournal {
  try {
    const e = value as ReclaimSafeJournal;
    if (!e || Object.keys(e).length !== 9 || e.schemaVersion !== 1 || !isReclaimSafeProposal(e.proposal)
      || !Array.isArray(e.approvals) || e.approvals.length > 2 || !e.approvals.every(a => isReclaimSafeApproval(e.proposal, a))
      || new Set(e.approvals.map(a => a.signer.toLowerCase())).size !== e.approvals.length
      || !["proposal", "awaiting-owner", "approvals-ready", "awaiting-wallet", "wallet-rejected", "hash-missing", "pending", "confirmed", "reverted", "unavailable", "reorged"].includes(e.stage)
      || !Number.isSafeInteger(e.createdAt) || e.createdAt <= 0 || !Number.isSafeInteger(e.updatedAt) || e.updatedAt < e.createdAt
      || e.transactionHash !== null && !reclaimHash(e.transactionHash)) return false;
    if (e.outerReview !== null && (!isReclaimSafeOuterReview(e.outerReview) || e.outerReview.proposal.proposalHash !== e.proposal.proposalHash
      || JSON.stringify(e.outerReview.approvals) !== JSON.stringify(e.approvals))) return false;
    if (["awaiting-wallet", "wallet-rejected", "hash-missing", "pending", "confirmed", "reverted", "unavailable", "reorged"].includes(e.stage) && !e.outerReview) return false;
    if (e.result !== null && (!e.outerReview || e.stage !== e.result.status || !reclaimSafeVerificationMatches(e.outerReview, e.result, e.transactionHash ?? undefined))) return false;
    return !["confirmed", "reverted"].includes(e.stage) || !!e.result && !!e.transactionHash && sameReclaimHex(e.result.transactionHash ?? "", e.transactionHash);
  } catch { return false; }
}
export function listReclaimSafeJournals(storage: StoragePort): ReclaimSafeJournal[] {
  const raw = storage.getItem(indexKey); if (raw === null) return [];
  if (bytes(raw) > 8192) throw Error("Safe recovery index exceeds its bound. Preserve the original proposals.");
  let keys: unknown; try { keys = JSON.parse(raw); } catch { throw Error("Safe recovery index is malformed. Preserve original approvals."); }
  if (!Array.isArray(keys) || keys.length > 32 || new Set(keys).size !== keys.length
    || keys.some(k => typeof k !== "string" || !/^rmt\.reclaim\.safe\.v2:0x[0-9a-f]{64}$/i.test(k))) throw Error("Safe recovery identity is invalid.");
  return keys.map(key => {
    const body = storage.getItem(key); if (!body || bytes(body) > 65536) throw Error("Original Safe proposal is missing or exceeds 64 KiB.");
    let value: unknown; try { value = JSON.parse(body); } catch { throw Error("Original Safe proposal is malformed."); }
    if (!validReclaimSafeJournal(value) || keyFor(value) !== key) throw Error("Original Safe proposal identity is invalid."); return value;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
export function storeReclaimSafeJournal(storage: StoragePort, entry: ReclaimSafeJournal): void {
  if (!validReclaimSafeJournal(entry)) throw Error("Invalid Safe recovery record.");
  const all = listReclaimSafeJournals(storage), prior = all.find(e => e.proposal.proposalHash === entry.proposal.proposalHash);
  if (!prior && all.length >= 32) throw Error("Safe recovery is full. Original proposals will not be evicted.");
  if (prior && (prior.createdAt !== entry.createdAt || entry.updatedAt < prior.updatedAt
    || prior.transactionHash !== null && (entry.transactionHash === null || !sameReclaimHex(prior.transactionHash, entry.transactionHash)))) throw Error("Original Safe transaction identity cannot be replaced.");
  const body = JSON.stringify(entry); if (bytes(body) > 65536) throw Error("Safe recovery record exceeds 64 KiB.");
  storage.setItem(keyFor(entry), body); storage.setItem(indexKey, JSON.stringify(prior ? all.map(keyFor) : [...all.map(keyFor), keyFor(entry)]));
  if (storage.getItem(keyFor(entry)) !== body || !listReclaimSafeJournals(storage).some(e => e.proposal.proposalHash === entry.proposal.proposalHash)) throw Error("Safe proposal could not be saved before the wallet request.");
}
export function assertNoPendingReclaimSafe(storage: StoragePort, account: string): void {
  if (listReclaimSafeJournals(storage).some(e => ["awaiting-wallet", "hash-missing", "pending", "unavailable", "reorged"].includes(e.stage)
    && (sameReclaimHex(e.proposal.safe, account) || sameReclaimHex(e.proposal.gasPayer, account)))) throw Error("Recover the original Safe transaction before requesting another wallet submission.");
}
