import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { isTransactionHash, testCreationFeeWei, testCreationSignature, type TestCreationFields, type TestCreationVerification } from "./test-creation";
import { type TestWallet, testWalletErrorCode } from "./test-wallet";
import { assertProductionNonceAvailable, recordProductionConsumedNonce } from "./production-nonce";
import { withProductionNonceStore } from "./production-nonce-store";
import { isLaunchAddress } from "./launch-data";
import { rmtCreationOwner } from "./owner-creation";

export const productionCreationPath = "/api/launchpad/production-creation";
export const productionCreationChain = "0x1237";
export const productionCreationFactory = "0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3";
export const productionCreationOrigin = "https://www.rmtlaunch.fun";
export const productionCreationOperating = "0xAF9F10258b091719618c19D057F9cDAB72eFFd8b";
export const productionCreationReserve = "0x8D44078642ce938Fd799b23087BcdD6114A302e5";
export const productionCreationJournalKey = "rmt:creation:4663:7281e1f9:v1";
export const completedProductionCreationsKey = "rmt:creation:4663:7281e1f9:completed:v1";
export const productionCreationAbi = parseAbi([testCreationSignature]);
export const sameProductionHex = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
export type ProductionCreationRequest = {
  from: Address; to: typeof productionCreationFactory; data: Hex; value: Hex; chainId: typeof productionCreationChain;
  intentId: Hex; deadline: string; blockNumber: Hex; blockHash: Hex; nonce: Hex;
};
export type ProductionCreationJournal = { request: ProductionCreationRequest; transactionHash?: Hex };
const quantity = (value: unknown): value is Hex => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i.test(value);

export function isProductionCreationRequest(value: unknown): value is ProductionCreationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 10) return false;
  const item = value as Partial<ProductionCreationRequest>;
  if (typeof item.from !== "string" || !/^0x[0-9a-f]{40}$/i.test(item.from) || BigInt(item.from) <= 0xffffn
    || item.to !== productionCreationFactory || item.chainId !== productionCreationChain
    || !quantity(item.value) || BigInt(item.value) !== testCreationFeeWei || !quantity(item.nonce)
    || !quantity(item.blockNumber) || BigInt(item.blockNumber) < 116835102n || !isTransactionHash(item.blockHash)
    || !isTransactionHash(item.intentId) || typeof item.deadline !== "string" || !/^[1-9][0-9]{0,11}$/.test(item.deadline)
    || typeof item.data !== "string" || item.data.length > 2058 || !/^0x(?:[0-9a-f]{2}){4,}$/i.test(item.data)) return false;
  try {
    const call = decodeFunctionData({ abi: productionCreationAbi, data: item.data as Hex });
    return call.functionName === "create" && sameProductionHex(call.args[5], item.intentId)
      && call.args[6] === BigInt(item.deadline)
      && sameProductionHex(encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: call.args }), item.data);
  } catch { return false; }
}

export function productionCalldataMatches(request: ProductionCreationRequest, fields: TestCreationFields) {
  try {
    return sameProductionHex(request.data, encodeFunctionData({ abi: productionCreationAbi, functionName: "create",
      args: [fields.name, fields.symbol, fields.projectURI, fields.treasury ? getAddress(fields.treasury) : zeroAddress,
        fields.treasuryShareBps, request.intentId, BigInt(request.deadline)] }));
  } catch { return false; }
}

export function readProductionCreationJournal(storage: Pick<Storage, "getItem">): ProductionCreationJournal | undefined {
  const text = storage.getItem(productionCreationJournalKey);
  if (!text) return;
  if (text.length > 4096) throw new Error("Invalid creation recovery record");
  const value = JSON.parse(text) as Partial<ProductionCreationJournal>;
  if (!value || !isProductionCreationRequest(value.request) || Object.keys(value).some((key) => !["request", "transactionHash"].includes(key))
      || (value.transactionHash !== undefined && !isTransactionHash(value.transactionHash))) throw new Error("Invalid creation recovery record");
  return value as ProductionCreationJournal;
}

export type CompletedProductionCreation = { schemaVersion: 1; request: ProductionCreationRequest; transactionHash: Hex;
  verification: TestCreationVerification; archivedAt: number };
function completeCreationEvidence(value: TestCreationVerification) {
  return value && isTransactionHash(value.transactionHash) && (value.status === "confirmed" && value.indexed === true
    && isLaunchAddress(value.token) && !/^0x0{40}$/i.test(value.token)
    || value.status === "reverted" && value.token === undefined && value.indexed !== true);
}
export function readCompletedProductionCreations(storage: Pick<Storage, "getItem">): CompletedProductionCreation[] {
  const raw = storage.getItem(completedProductionCreationsKey); if (raw === null) return [];
  if (raw.length > 65_536) throw new Error("Completed production creation history exceeds its bound");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || value.schemaVersion !== 1
    || !Array.isArray(value.entries) || value.entries.length > 16) throw new Error("Invalid completed creation history");
  const seen = new Set<string>();
  for (const record of value.entries) {
    if (!record || Object.keys(record).length !== 5 || record.schemaVersion !== 1 || !isProductionCreationRequest(record.request)
      || !isTransactionHash(record.transactionHash) || !completeCreationEvidence(record.verification)
      || !sameProductionHex(record.transactionHash, record.verification.transactionHash)
      || !Number.isSafeInteger(record.archivedAt) || record.archivedAt <= 0 || seen.has(record.transactionHash.toLowerCase())) throw new Error("Invalid completed creation identity");
    seen.add(record.transactionHash.toLowerCase());
  }
  return value.entries;
}
export function assertNoPendingProductionCreation(storage: Pick<Storage, "getItem">, account: string, candidateNonce?: string) {
  const active = readProductionCreationJournal(storage);
  if (active && sameProductionHex(active.request.from, account)) throw new Error("Recover the original creation transaction before another financial request");
  assertProductionNonceAvailable(storage, account, candidateNonce);
  for (const record of readCompletedProductionCreations(storage)) {
    if (sameProductionHex(record.request.from, account) && (candidateNonce === undefined || BigInt(candidateNonce) <= BigInt(record.request.nonce))) {
      throw new Error("Wallet nonce rewound. Reconcile the original completed creation before another financial request");
    }
  }
}
/** Explicit fresh canonical verification under the shared account/journal locks
 * is mandatory. Preserve complete history and the monotonic nonce floor before
 * clearing the active slot; interruption can never erase an uncertain send. */
export function archiveCompletedProductionCreation(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  original: ProductionCreationJournal, verification: TestCreationVerification, now = Date.now()) {
  const active = readProductionCreationJournal(storage);
  if (!active || !sameProductionCreationRequest(active.request, original.request) || active.transactionHash !== original.transactionHash
    || !completeCreationEvidence(verification) || original.transactionHash && !sameProductionHex(original.transactionHash, verification.transactionHash!)) {
    throw new Error("Original creation is not canonically complete");
  }
  const entries = readCompletedProductionCreations(storage), existing = entries.find(record => sameProductionCreationRequest(record.request, original.request));
  if (existing && !sameProductionHex(existing.transactionHash, verification.transactionHash!)) throw new Error("Archived creation identity changed");
  if (!existing && entries.length >= 16) throw new Error("Completed creation history is full. Preserve existing receipts before another creation");
  const record: CompletedProductionCreation = existing ?? { schemaVersion: 1, request: original.request, transactionHash: verification.transactionHash!, verification, archivedAt: now };
  const raw = JSON.stringify({ schemaVersion: 1, entries: existing ? entries : [...entries, record] });
  if (raw.length > 65_536) throw new Error("Completed creation history exceeds its bound");
  storage.setItem(completedProductionCreationsKey, raw);
  if (storage.getItem(completedProductionCreationsKey) !== raw || !readCompletedProductionCreations(storage).some(entry => entry.transactionHash === record.transactionHash)) {
    throw new Error("Completed creation could not be preserved");
  }
  recordProductionConsumedNonce(storage, original.request.from, original.request.nonce, record.transactionHash);
  storage.removeItem(productionCreationJournalKey);
  if (storage.getItem(productionCreationJournalKey) !== null) throw new Error("Original creation remains recoverable; archive release was interrupted");
  return record;
}

export type ProductionWallet = { account: Address; provider: TestWallet["provider"]; request: TestWallet["request"] };
export function productionProviderAtWindow() {
  if (window.location.origin !== productionCreationOrigin) return;
  const provider = (window as typeof window & { ethereum?: TestWallet["provider"] }).ethereum;
  return provider && typeof provider.request === "function" ? provider : undefined;
}
export function isProductionWalletOrigin(location: Pick<Location, "origin">) { return location.origin === productionCreationOrigin; }
export async function connectProductionWallet(): Promise<ProductionWallet> {
  const provider = productionProviderAtWindow();
  if (!provider) throw new Error("Open the approved origin in your wallet browser");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !sameProductionHex(accounts[0], rmtCreationOwner)) throw new Error("Use the approved creator account");
  const wallet = { account: getAddress(accounts[0].toLowerCase()), provider, request: provider.request };
  await assertProductionWallet(wallet);
  return wallet;
}
export function sameProductionCreationRequest(left: ProductionCreationRequest, right: ProductionCreationRequest) {
  return Object.keys(left).every((key) => {
    const k = key as keyof ProductionCreationRequest;
    return left[k].toLowerCase() === right[k].toLowerCase();
  });
}
export async function assertProductionWallet(wallet: ProductionWallet, request?: ProductionCreationRequest) {
  if (!sameProductionHex(wallet.account, rmtCreationOwner)) throw new Error("Use the approved creator account");
  if (wallet.provider.request !== wallet.request) throw new Error("Wallet provider changed");
  const [accounts, chain] = await Promise.all([
    wallet.request.call(wallet.provider, { method: "eth_accounts" }), wallet.request.call(wallet.provider, { method: "eth_chainId" }),
  ]);
  if (!Array.isArray(accounts) || !sameProductionHex(accounts[0], wallet.account) || chain !== productionCreationChain
      || (request && !sameProductionHex(request.from, wallet.account))) throw new Error("Wallet account or chain changed");
  if (request) {
    const [nonce, block] = await Promise.all([
      wallet.request.call(wallet.provider, { method: "eth_getTransactionCount", params: [wallet.account, "pending"] }),
      wallet.request.call(wallet.provider, { method: "eth_getBlockByNumber", params: [request.blockNumber, false] }),
    ]);
    if (typeof nonce !== "string" || BigInt(nonce) !== BigInt(request.nonce) || !block || typeof block !== "object"
        || !sameProductionHex((block as { hash?: string }).hash, request.blockHash)) throw new Error("Nonce or reviewed block changed");
  }
}

// Caller must hold the browser's exclusive journal lock and revalidate release,
// draft, account and chain immediately before this operation. Persist before the
// sole wallet send; a lost hash/transport error can never trigger an automatic retry.
export async function submitProductionCreation(wallet: ProductionWallet, request: ProductionCreationRequest,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, assertReviewCurrent: () => void) {
  if (!isProductionCreationRequest(request)) throw new Error("Invalid creation request");
  if (readProductionCreationJournal(storage)) throw new Error("An original creation request requires recovery");
  assertNoPendingProductionCreation(storage, wallet.account, request.nonce);
  const [{ assertNoPendingProductionClaim }, { assertNoPendingProductionTrade }] = await Promise.all([
    import("./claim-recovery"), import("./production-trading-wallet"),
  ]);
  const checkJournals = () => withProductionNonceStore(storage, view => {
    assertNoPendingProductionCreation(view, wallet.account, request.nonce);
    assertNoPendingProductionClaim(view, wallet.account, request.nonce); assertNoPendingProductionTrade(view, wallet.account, request.nonce);
  });
  await checkJournals();
  await assertProductionWallet(wallet, request);
  assertReviewCurrent();
  if (readProductionCreationJournal(storage)) throw new Error("An original creation request requires recovery");
  assertNoPendingProductionCreation(storage, wallet.account, request.nonce);
  await checkJournals();
  const journal: ProductionCreationJournal = { request };
  storage.setItem(productionCreationJournalKey, JSON.stringify(journal));
  const persisted = readProductionCreationJournal(storage);
  if (!persisted || !sameProductionCreationRequest(persisted.request, request) || persisted.transactionHash) throw new Error("Creation intent could not be durably recorded");
  assertReviewCurrent();
  try {
    const { from, to, data, value, chainId, nonce } = request;
    const result = await wallet.request.call(wallet.provider, { method: "eth_sendTransaction", params: [{ from, to, data, value, chainId, nonce }] });
    if (isTransactionHash(result)) {
      journal.transactionHash = result;
      storage.setItem(productionCreationJournalKey, JSON.stringify(journal));
    }
    return journal;
  } catch (error) {
    if (testWalletErrorCode(error) === 4001) storage.removeItem(productionCreationJournalKey);
    throw error;
  }
}
