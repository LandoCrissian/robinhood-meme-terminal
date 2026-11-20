import { isTransactionHash } from "./test-creation";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type ReadStorage = Pick<globalThis.Storage, "getItem">;
type Floor = { account: string; nonce: string; transactionHash: string };
export const productionNonceFloorKey = "rmt:financial:consumed-nonces:4663:v1";
const fail = () => new Error("The original production transaction needs fresh canonical reconciliation before this nonce can be reused.");
function nonce(value: unknown) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,15}|0x(?:0|[1-9a-f][0-9a-f]{0,13}))$/i.test(value)) throw fail();
  const n = BigInt(value); if (n >= BigInt(Number.MAX_SAFE_INTEGER)) throw fail(); return n;
}
function account(value: string) {
  if (!/^0x[0-9a-f]{40}$/i.test(value) || BigInt(value) <= 0xffffn) throw fail(); return value.toLowerCase();
}
function floors(storage: ReadStorage): Floor[] {
  const raw = storage.getItem(productionNonceFloorKey); if (raw === null) return [];
  if (raw.length > 16384) throw fail(); const value = JSON.parse(raw) as { schemaVersion: number; floors: Floor[] };
  if (!value || Object.keys(value).length !== 2 || value.schemaVersion !== 1 || !Array.isArray(value.floors) || value.floors.length > 64) throw fail();
  const seen = new Set<string>();
  for (const row of value.floors) {
    if (!row || Object.keys(row).length !== 3 || account(row.account) !== row.account || seen.has(row.account)
        || row.nonce !== "0x" + nonce(row.nonce).toString(16) || !isTransactionHash(row.transactionHash)
        || row.transactionHash !== row.transactionHash.toLowerCase()) throw fail();
    seen.add(row.account);
  }
  return value.floors;
}
/** Both hex wallet quantities and canonical decimal journal quantities are
 * accepted. A consumed nonce is a durable floor even if a later reorg rewinds
 * the provider's observed account nonce. It is never an automatic retry. */
export function assertProductionNonceAboveConsumed(candidateNonce: string | undefined, consumedNonces: readonly string[]) {
  const consumed = consumedNonces.map(nonce);
  if (candidateNonce === undefined) { if (consumed.length) throw fail(); return; }
  const candidate = nonce(candidateNonce);
  if (consumed.some(n => candidate <= n)) throw fail();
}
export function assertProductionNonceAvailable(storage: ReadStorage, owner: string, candidateNonce: string | undefined) {
  const who = account(owner), all = floors(storage), existing = all.find(row => row.account === who);
  if (!existing && all.length >= 64) throw fail();
  assertProductionNonceAboveConsumed(candidateNonce, existing ? [existing.nonce] : []);
}
/** Call only after exact confirmed/indexed or canonically reverted receipt
 * proof. Read back the monotone floor before clearing or evicting any receipt.
 * Account capacity fails closed; another account's evidence is never evicted. */
export function recordProductionConsumedNonce(storage: Storage, owner: string, consumedNonce: string, transactionHash: string) {
  const who = account(owner), consumed = nonce(consumedNonce); if (!isTransactionHash(transactionHash)) throw fail();
  const all = floors(storage), existing = all.find(row => row.account === who);
  if (existing && nonce(existing.nonce) >= consumed) return;
  if (!existing && all.length >= 64) throw fail();
  const row = { account: who, nonce: "0x" + consumed.toString(16), transactionHash: transactionHash.toLowerCase() };
  const updated = existing ? all.map(item => item.account === who ? row : item) : [...all, row];
  const raw = JSON.stringify({ schemaVersion: 1, floors: updated });
  storage.setItem(productionNonceFloorKey, raw);
  if (storage.getItem(productionNonceFloorKey) !== raw || !floors(storage).some(item => item.account === who && item.nonce === row.nonce && item.transactionHash === row.transactionHash)) throw fail();
}
