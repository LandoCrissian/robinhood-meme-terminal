import { keccak256, toHex, type Hex } from "viem";
import { claimDelegatePin } from "./claim-profiles";
import { assertNoPendingProductionClaim } from "./claim-recovery";
import { assertNoPendingProductionCreation } from "./production-creation";
import { assertProductionNonceAvailable, recordProductionConsumedNonce } from "./production-nonce";
import { assertProductionWalletBinding, productionAccountLock, readProductionCapability, type ProductionWallet } from "./production-wallet";
import { isTransactionHash } from "./test-creation";
import { testWalletErrorCode } from "./test-wallet";
import { sameLifecycleValue as same } from "./test-lifecycle";
import { isProductionLifecycleRequest, isProductionNitroZeroPosterEvidence, productionLifecycleCalldataMatches, productionLifecyclePath, sameProductionLifecycleRequest,
  type ProductionLifecycleQuote, type ProductionLifecycleRequest, type ProductionLifecycleVerification } from "./production-lifecycle";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type ProductionTradeJournal = { schemaVersion: 1; request: ProductionLifecycleRequest; quote: ProductionLifecycleQuote; transactionHash?: Hex; createdAt: number;
  verification?: ProductionLifecycleVerification };
export type PreparedProductionTrade = { request: ProductionLifecycleRequest; quote: ProductionLifecycleQuote };
export const productionTradeJournalIndex = "rmt:production:trade:v1:index";
export const productionTradeJournalHistory = "rmt:production:trade:v1:history";
export const productionTradeJournalKey = (account: string, token: string) => `rmt:production:trade:v1:${account.toLowerCase()}:${token.toLowerCase()}`;
const journalError = () => new Error("Preserve the original production transaction; recovery is required.");
const uint = (n: unknown): n is string => typeof n === "string" && /^(0|[1-9][0-9]{0,77})$/.test(n) && BigInt(n) < 2n ** 256n;
function validQuote(q: unknown): q is ProductionLifecycleQuote {
  if (!q || typeof q !== "object" || Array.isArray(q)) return false;
  const r = q as ProductionLifecycleQuote;
  return ["inputWei", "outputWei", "minimumOutputWei", "feeWei", "refundWei", "gasUnits", "gasPriceWei"].every(k => uint(r[k as keyof ProductionLifecycleQuote]))
    && Object.keys(r).every(k => ["inputWei", "outputWei", "minimumOutputWei", "feeWei", "refundWei", "gasUnits", "gasPriceWei", "feePips", "feeAsset", "feeEvidence", "l1PosterGasUnits", "maxPriorityFeePerGasWei", "nitroZeroPosterPolicy", "transactionBaseFeeWei", "observedGasPriceWei"].includes(k))
    && BigInt(r.gasUnits) > 0n && BigInt(r.gasPriceWei) > 0n && (r.feePips === undefined || r.feePips === 3000)
    && uint(r.maxPriorityFeePerGasWei) && BigInt(r.maxPriorityFeePerGasWei) <= BigInt(r.gasPriceWei)
    && (r.feeEvidence === "verified-nitro" && uint(r.l1PosterGasUnits) && BigInt(r.l1PosterGasUnits) > 0n && BigInt(r.l1PosterGasUnits) < BigInt(r.gasUnits)
      && !["nitroZeroPosterPolicy", "transactionBaseFeeWei", "observedGasPriceWei"].some(k => Object.hasOwn(r, k))
      || r.feeEvidence === "verified-nitro-zero-poster" && r.l1PosterGasUnits === "0" && isProductionNitroZeroPosterEvidence(r.nitroZeroPosterPolicy)
        && uint(r.transactionBaseFeeWei) && BigInt(r.transactionBaseFeeWei) > 0n && uint(r.observedGasPriceWei) && BigInt(r.observedGasPriceWei) > 0n
        && BigInt(r.gasPriceWei) >= 2n * [r.transactionBaseFeeWei, r.observedGasPriceWei, r.nitroZeroPosterPolicy.l2BaseFeeWei, r.nitroZeroPosterPolicy.nativeL2BaseFeeWei]
          .map(BigInt).reduce((n, value) => value > n ? value : n, 0n) + BigInt(r.maxPriorityFeePerGasWei))
    && (r.feeAsset === undefined || r.feeAsset === "native" || r.feeAsset === "token");
}
function validJournal(j: unknown): j is ProductionTradeJournal {
  if (!j || typeof j !== "object" || Array.isArray(j)) return false;
  const r = j as ProductionTradeJournal;
  return r.schemaVersion === 1 && isProductionLifecycleRequest(r.request) && validQuote(r.quote)
    && r.quote.inputWei === r.request.amountWei && r.quote.minimumOutputWei === r.request.minimumOutputWei
    && (r.transactionHash === undefined || isTransactionHash(r.transactionHash))
    && Object.keys(r).every(k => ["schemaVersion", "request", "quote", "transactionHash", "createdAt", "verification"].includes(k))
    && (r.verification === undefined || !!r.verification && ["pending", "confirmed", "reverted", "unavailable"].includes(r.verification.status)
      && (!r.verification.transactionHash || same(r.verification.transactionHash, r.transactionHash)))
    && Number.isSafeInteger(r.createdAt) && r.createdAt > 0;
}
function keys(storage: Storage): string[] {
  const raw = storage.getItem(productionTradeJournalIndex); if (raw === null) return [];
  if (raw.length > 16384) throw journalError();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 64 || new Set(value).size !== value.length || value.some(k => typeof k !== "string"
      || !/^rmt:production:trade:v1:0x[0-9a-f]{40}:0x[0-9a-f]{40}$/.test(k))) throw journalError();
  return value;
}
export function readProductionTradeJournal(storage: Storage, account: string, token: string): ProductionTradeJournal | null {
  const key = productionTradeJournalKey(account, token), raw = storage.getItem(key); if (raw === null) return null;
  if (raw.length > 12288) throw journalError();
  const value: unknown = JSON.parse(raw);
  if (!validJournal(value) || productionTradeJournalKey(value.request.from, value.request.token) !== key) throw journalError();
  return value;
}
export function listProductionTradeJournals(storage: Storage) {
  return keys(storage).map(key => {
    const parts = key.split(":"), j = readProductionTradeJournal(storage, parts[4], parts[5]);
    if (!j) throw journalError(); return j;
  });
}
function consumedTrade(j: ProductionTradeJournal) {
  return !!j.transactionHash && same(j.transactionHash, j.verification?.transactionHash)
    && (j.verification?.status === "confirmed" && j.verification.indexed === true || j.verification?.status === "reverted");
}
export function assertNoPendingProductionTrade(storage: Storage, account: string, candidateNonce?: string) {
  const active = listProductionTradeJournals(storage).filter(j => same(j.request.from, account));
  if (active.some(j => !consumedTrade(j))) throw journalError();
  const consumed = [...active, ...listCompletedProductionTradeJournals(storage).filter(j => same(j.request.from, account))];
  const highest = consumed.reduce<ProductionTradeJournal | undefined>((max, j) => !max || BigInt(j.request.nonce) > BigInt(max.request.nonce) ? j : max, undefined);
  if (highest) recordProductionConsumedNonce(storage, account, highest.request.nonce, highest.transactionHash!);
  assertProductionNonceAvailable(storage, account, candidateNonce);
}
function store(storage: Storage, journal: ProductionTradeJournal) {
  if (!validJournal(journal)) throw journalError();
  const key = productionTradeJournalKey(journal.request.from, journal.request.token), all = keys(storage), raw = JSON.stringify(journal);
  const original = readProductionTradeJournal(storage, journal.request.from, journal.request.token);
  if (original && (!sameProductionLifecycleRequest(original.request, journal.request) || original.createdAt !== journal.createdAt
      || original.transactionHash && !same(original.transactionHash, journal.transactionHash))) throw journalError();
  if (!all.includes(key) && all.length >= 64) throw journalError();
  storage.setItem(key, raw); storage.setItem(productionTradeJournalIndex, JSON.stringify(all.includes(key) ? all : [...all, key]));
  if (storage.getItem(key) !== raw || !keys(storage).includes(key)) throw journalError();
}
function remove(storage: Storage, account: string, token: string) {
  const key = productionTradeJournalKey(account, token), all = keys(storage);
  // Update index before removal. A partial failure preserves a blocking orphan.
  storage.setItem(productionTradeJournalIndex, JSON.stringify(all.filter(k => k !== key))); storage.removeItem(key);
  if (storage.getItem(key) !== null) throw journalError();
}
export function clearProductionTradeJournal(storage: Storage, account: string, token: string, verification: ProductionLifecycleVerification) {
  const journal = readProductionTradeJournal(storage, account, token); if (!journal) return;
  if (!journal.transactionHash || !same(journal.transactionHash, verification.transactionHash)
      || !(verification.status === "confirmed" && verification.indexed === true || verification.status === "reverted")) throw journalError();
  recordProductionConsumedNonce(storage, account, journal.request.nonce, journal.transactionHash);
  const history = listCompletedProductionTradeJournals(storage);
  const archived = { ...journal, verification };
  const raw = JSON.stringify([...history.filter(j => !same(j.transactionHash, journal.transactionHash)), archived].slice(-64));
  storage.setItem(productionTradeJournalHistory, raw); if (storage.getItem(productionTradeJournalHistory) !== raw) throw journalError();
  remove(storage, account, token);
}
export function listCompletedProductionTradeJournals(storage: Storage): ProductionTradeJournal[] {
  const raw = storage.getItem(productionTradeJournalHistory); if (raw === null) return [];
  if (raw.length > 786432) throw journalError(); const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 64 || !value.every(j => validJournal(j) && j.transactionHash
      && same(j.transactionHash, j.verification?.transactionHash) && (j.verification?.status === "confirmed" && j.verification.indexed === true || j.verification?.status === "reverted"))) throw journalError();
  return value;
}
/** Persist recovered hashes only after the server proves the exact canonical transaction, never from a candidate/unavailable result. */
export function updateProductionTradeJournalFromVerification(storage: Storage, account: string, token: string, result: ProductionLifecycleVerification) {
  const journal = readProductionTradeJournal(storage, account, token); if (!journal) throw journalError();
  if (!result || !["pending", "confirmed", "reverted", "unavailable"].includes(result.status)
      || result.transactionHash && !isTransactionHash(result.transactionHash)) throw journalError();
  if (result.transactionHash && journal.transactionHash && !same(result.transactionHash, journal.transactionHash)) throw journalError();
  const proved = result.status === "confirmed" && result.indexed === true || result.status === "reverted" || result.status === "pending" && result.settlementPending === true;
  if (!journal.transactionHash && result.transactionHash && proved) journal.transactionHash = result.transactionHash;
  if (journal.transactionHash && (result.status === "confirmed" && result.indexed === true || result.status === "reverted")) {
    recordProductionConsumedNonce(storage, account, journal.request.nonce, journal.transactionHash);
  }
  const verification = !journal.transactionHash && result.transactionHash ? { ...result, transactionHash: undefined } : result;
  store(storage, { ...journal, verification });
  return readProductionTradeJournal(storage, account, token)!;
}
function assertOtherFinancialJournals(storage: Storage, account: string, candidateNonce: string) {
  assertNoPendingProductionCreation(storage, account, candidateNonce);
  assertNoPendingProductionClaim(storage, account, candidateNonce);
}
function quoteDoesNotIncrease(reviewed: ProductionLifecycleQuote, current: ProductionLifecycleQuote) {
  return validQuote(current) && reviewed.feeEvidence === current.feeEvidence && ["inputWei", "outputWei", "minimumOutputWei", "feeWei", "refundWei", "feePips", "feeAsset"].every(k =>
    reviewed[k as keyof ProductionLifecycleQuote] === current[k as keyof ProductionLifecycleQuote])
    && BigInt(current.gasUnits) <= BigInt(reviewed.gasUnits) && BigInt(current.gasPriceWei) <= BigInt(reviewed.gasPriceWei)
    && BigInt(current.maxPriorityFeePerGasWei) <= BigInt(reviewed.maxPriorityFeePerGasWei);
}
async function post(fetcher: typeof fetch, body: object) {
  const response = await fetcher(productionLifecyclePath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Production trading revalidation unavailable");
  return response.json();
}
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)) throw new Error("Wallet returned an invalid quantity");
  return BigInt(value);
}
async function assertWalletReview(wallet: ProductionWallet, prepared: PreparedProductionTrade, guard: () => void, freshQuote?: ProductionLifecycleQuote) {
  const r = prepared.request, q = prepared.quote;
  guard(); await assertProductionWalletBinding(wallet, r); guard();
  if (!same(wallet.account, r.from) || !await productionLifecycleCalldataMatches(r)) throw new Error("Reviewed production transaction changed");
  const request = (method: string, params?: readonly unknown[]) => wallet.request.call(wallet.provider, { method, params });
  const [latestRaw, code, pendingCode, nonce, pendingNonce, gasPrice, balance] = await Promise.all([
    request("eth_getBlockByNumber", ["latest", false]), request("eth_getCode", [r.from, "latest"]), request("eth_getCode", [r.from, "pending"]),
    request("eth_getTransactionCount", [r.from, "latest"]), request("eth_getTransactionCount", [r.from, "pending"]), request("eth_gasPrice"), request("eth_getBalance", [r.from, "pending"]),
  ]);
  guard();
  if (!latestRaw || typeof latestRaw !== "object") throw new Error("Wallet current block unavailable");
  const latest = latestRaw as { number?: unknown; timestamp?: unknown };
  const height = quantity(latest.number), timestamp = quantity(latest.timestamp), review = BigInt(r.reviewBlockNumber);
  if (height < review || height - review > 256n || timestamp >= BigInt(r.deadline) || typeof code !== "string" || code.length > 49154 || !/^0x(?:[0-9a-f]{2})*$/i.test(code)
      || !same(code, typeof pendingCode === "string" ? pendingCode : "") || !same(keccak256(code as Hex), r.walletCodeHash)
      || quantity(nonce) !== BigInt(r.nonce) || quantity(pendingNonce) !== BigInt(r.nonce) || quantity(gasPrice) > BigInt(q.gasPriceWei)
      || quantity(balance) < BigInt(r.value) + BigInt(q.gasUnits) * BigInt(q.gasPriceWei)) throw new Error("Wallet state or reviewed fee changed");
  for (const quote of [q, ...(freshQuote ? [freshQuote] : [])]) if (quote.feeEvidence === "verified-nitro-zero-poster") {
    const proof = quote.nitroZeroPosterPolicy, number = BigInt(proof.blockNumber);
    if (number < review || number > height) throw new Error("Native fee policy checkpoint changed");
    const header = await request("eth_getBlockByNumber", [toHex(number), false]) as { number?: unknown; hash?: unknown; baseFeePerGas?: unknown } | null;
    if (!header || quantity(header.number) !== number || !same(typeof header.hash === "string" ? header.hash : "", proof.blockHash)
        || quantity(header.baseFeePerGas) !== BigInt(proof.l2BaseFeeWei)) throw new Error("Native fee policy checkpoint changed");
  }
  if (code !== "0x") {
    if (!same(code, claimDelegatePin.designator)) throw new Error("Unsupported wallet account");
    const codes = await Promise.all(["latest", "pending"].map(tag => request("eth_getCode", [claimDelegatePin.address, tag])));
    if (!codes.every(v => typeof v === "string" && v.length <= 49154 && /^0x(?:[0-9a-f]{2})+$/i.test(v) && same(keccak256(v as Hex), claimDelegatePin.runtimeHash))) throw new Error("Wallet delegation changed");
  }
  const tx = { from: r.from, to: r.to, data: r.data, value: r.value };
  const [estimate] = await Promise.all([request("eth_estimateGas", [tx]), request("eth_call", [tx, "pending"])]);
  if (quantity(estimate) > BigInt(q.gasUnits)) throw new Error("Reviewed gas limit increased");
  guard(); await assertProductionWalletBinding(wallet, r); guard();
}

/** One explicit type-2 wallet request, durably journaled first. Unknown outcomes are recovered, never resent. */
export async function submitProductionTrade(wallet: ProductionWallet, prepared: PreparedProductionTrade, storage: Storage,
  fetcher: typeof fetch = fetch, guard: () => void = () => {}): Promise<ProductionLifecycleVerification> {
  // Caller-owned UI state may mutate while RPC or a wallet prompt is pending.
  // Snapshot every reviewed field before the first asynchronous boundary.
  prepared = JSON.parse(JSON.stringify(prepared)) as PreparedProductionTrade;
  if (!isProductionLifecycleRequest(prepared.request) || !validQuote(prepared.quote)) throw new Error("Invalid production trade review");
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== "function") throw new Error("Cross-tab transaction protection unavailable");
  return locks.request(productionAccountLock(wallet.account), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Another financial transaction is in progress");
    const r = prepared.request;
    guard(); assertNoPendingProductionTrade(storage, wallet.account, r.nonce); assertOtherFinancialJournals(storage, wallet.account, r.nonce);
    const approval = await readProductionCapability("trading");
    if (!same(approval, r.approvalBinding)) throw new Error("Owner trading approval changed");
    const current = await post(fetcher, { action: "prepare", token: r.token, account: r.from, operation: r.operation, amountWei: r.amountWei, slippageBps: r.slippageBps, prior: r });
    if (!current || current.status !== "prepared" || !isProductionLifecycleRequest(current.request) || !sameProductionLifecycleRequest(r, current.request)
        || !quoteDoesNotIncrease(prepared.quote, current.quote)) throw new Error("Production transaction review changed");
    await assertWalletReview(wallet, prepared, guard, current.quote);
    if (!same(await readProductionCapability("trading"), r.approvalBinding)) throw new Error("Owner trading approval changed");
    guard(); assertNoPendingProductionTrade(storage, wallet.account, r.nonce); assertOtherFinancialJournals(storage, wallet.account, r.nonce);
    const journal: ProductionTradeJournal = { schemaVersion: 1, request: r, quote: prepared.quote, createdAt: Date.now() };
    store(storage, journal);
    let result: unknown;
    try {
      guard(); await assertProductionWalletBinding(wallet, r); guard();
      result = await wallet.request.call(wallet.provider, { method: "eth_sendTransaction", params: [{ from: r.from, to: r.to, data: r.data, value: r.value,
        nonce: r.nonce, chainId: r.chainId, type: "0x2", gas: toHex(BigInt(prepared.quote.gasUnits)), maxFeePerGas: toHex(BigInt(prepared.quote.gasPriceWei)), maxPriorityFeePerGas: toHex(BigInt(prepared.quote.maxPriorityFeePerGasWei)) }] });
    } catch (error) {
      if (testWalletErrorCode(error) === 4001) { remove(storage, r.from, r.token); throw error; }
      return { status: "pending", indexed: false };
    }
    if (isTransactionHash(result)) { journal.transactionHash = result; store(storage, journal); }
    try {
      const verification = await post(fetcher, { action: "verify", request: r, ...(journal.transactionHash && { transactionHash: journal.transactionHash }) }) as ProductionLifecycleVerification;
      if (!verification || !["pending", "confirmed", "reverted", "unavailable"].includes(verification.status)) throw journalError();
      updateProductionTradeJournalFromVerification(storage, r.from, r.token, verification);
      return verification;
    } catch { return { status: "pending", ...(journal.transactionHash && { transactionHash: journal.transactionHash }), indexed: false }; }
  });
}
