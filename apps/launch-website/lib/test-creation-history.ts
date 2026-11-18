import { isTestCreationRequest, isTransactionHash, sameTestCreationRequest, type TestCreationRequest, type TestCreationVerification } from "./test-creation";
import { isLaunchAddress } from "./launch-data";

export const activeTestCreationKey = "rmt:creation-test:31337:v1";
export const completedTestCreationsKey = "rmt:creation-test:31337:completed:v1";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type TestCreationJournal = { request: TestCreationRequest; transactionHash?: `0x${string}` };
export type CompletedTestCreation = { schemaVersion: 1; request: TestCreationRequest; transactionHash: `0x${string}`;
  verification: TestCreationVerification; archivedAt: number };
export type ArchivedCreationCheck = { transactionHash: `0x${string}`; verification: TestCreationVerification };
export function currentArchivedCreationEvidence(archived: Pick<CompletedTestCreation, "transactionHash"> | undefined, checked: ArchivedCreationCheck | undefined) {
  return archived && checked && archived.transactionHash.toLowerCase() === checked.transactionHash.toLowerCase()
    && (!checked.verification.transactionHash || checked.verification.transactionHash.toLowerCase() === checked.transactionHash.toLowerCase()) ? checked.verification : undefined;
}
export function readActiveTestCreation(storage: Storage): TestCreationJournal | undefined {
  const raw = storage.getItem(activeTestCreationKey); if (raw === null) return;
  if (raw.length > 4096) throw Error("Invalid stored creation request");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("request" in value) || !isTestCreationRequest(value.request)
    || "transactionHash" in value && value.transactionHash !== undefined && !isTransactionHash(value.transactionHash)) throw Error("Invalid stored creation request");
  return { request: value.request, ...("transactionHash" in value && isTransactionHash(value.transactionHash) ? { transactionHash: value.transactionHash } : {}) };
}
export function completedCreationEvidence(value: TestCreationVerification): boolean {
  return isTransactionHash(value.transactionHash) && (value.status === "confirmed" && value.indexed === true && isLaunchAddress(value.token)
    && !/^0x0{40}$/i.test(value.token) || value.status === "reverted" && !value.token);
}
export function readCompletedTestCreations(storage: Storage): CompletedTestCreation[] {
  const raw = storage.getItem(completedTestCreationsKey); if (raw === null) return [];
  if (raw.length > 65_536) throw Error("Completed creation history exceeds its bound");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 2
    || !("schemaVersion" in parsed) || parsed.schemaVersion !== 1 || !("entries" in parsed) || !Array.isArray(parsed.entries)
    || parsed.entries.length > 16) throw Error("Completed creation history is invalid");
  const entries: CompletedTestCreation[] = [];
  for (const raw of parsed.entries) {
    const v = raw as CompletedTestCreation;
    if (!v || Object.keys(v).length !== 5 || v.schemaVersion !== 1 || !isTestCreationRequest(v.request) || !isTransactionHash(v.transactionHash)
      || !v.verification || !completedCreationEvidence(v.verification) || v.verification.transactionHash?.toLowerCase() !== v.transactionHash.toLowerCase()
      || !Number.isSafeInteger(v.archivedAt) || v.archivedAt <= 0 || entries.some(entry => sameTestCreationRequest(entry.request, v.request)
        || entry.transactionHash.toLowerCase() === v.transactionHash.toLowerCase())) throw Error("Completed creation identity is invalid");
    entries.push(v);
  }
  return entries;
}
/** Call only after an explicit fresh canonical verification while holding the
 * payer and original-journal locks. Durable history is written/read back before
 * the active slot is cleared. A crash leaves a recoverable duplicate, not loss. */
export function archiveCompletedTestCreation(storage: Storage, original: TestCreationJournal, verified: TestCreationVerification, now = Date.now()) {
  const active = readActiveTestCreation(storage);
  if (!active || !sameTestCreationRequest(active.request, original.request) || active.transactionHash !== original.transactionHash
    || !completedCreationEvidence(verified) || original.transactionHash && original.transactionHash.toLowerCase() !== verified.transactionHash!.toLowerCase()) throw Error("The original creation is not canonically complete and cannot be archived");
  const entries = readCompletedTestCreations(storage), existing = entries.find(entry => sameTestCreationRequest(entry.request, original.request));
  if (existing && existing.transactionHash.toLowerCase() !== verified.transactionHash!.toLowerCase()) throw Error("Archived creation identity changed");
  if (!existing && entries.length >= 16) throw Error("Completed creation history is full. Existing requests have not been removed.");
  const record: CompletedTestCreation = existing ?? { schemaVersion: 1, request: original.request, transactionHash: verified.transactionHash!, verification: verified, archivedAt: now };
  const updated = existing ? entries : [...entries, record], serialized = JSON.stringify({ schemaVersion: 1, entries: updated });
  if (new TextEncoder().encode(serialized).byteLength > 65_536) throw Error("Completed creation history exceeds its storage bound");
  storage.setItem(completedTestCreationsKey, serialized);
  if (storage.getItem(completedTestCreationsKey) !== serialized || !readCompletedTestCreations(storage).some(entry => sameTestCreationRequest(entry.request, original.request)
    && entry.transactionHash.toLowerCase() === verified.transactionHash!.toLowerCase())) throw Error("Completed creation could not be preserved");
  storage.removeItem(activeTestCreationKey);
  if (storage.getItem(activeTestCreationKey) !== null) throw Error("The original creation slot could not be released safely");
  return updated;
}
