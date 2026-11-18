import { isLaunchAddress } from "./launch-data";
import { isTransactionHash } from "./test-creation";

type Address = `0x${string}`;
type Hex = `0x${string}`;
export const earningsClaimPath = "/api/launchpad/test-earnings";
export const earningsClaimOperations = ["curve-claim", "lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token", "creation-fees"] as const;
export type EarningsClaimOperation = typeof earningsClaimOperations[number];
export type EarningsClaimAmounts = { nativeWei: string; tokenWei: string };
export type EarningsClaimRequest = {
  schemaVersion: 1; operation: EarningsClaimOperation; chainId: "0x7a69" | "0x1237";
  from: Address; to: Address; data: Hex; value: "0x0"; nonce: Hex;
  factory: Address; token: Address; originCurve: Address; ledger: Address; beneficiary: Address; discoveryRecipient: Address;
  factoryRuntimeHash: Hex; targetRuntimeHash: Hex;
  deploymentBlockNumber: Hex; deploymentBlockHash: Hex;
  reviewBlockNumber: Hex; reviewBlockHash: Hex; reviewTimestamp: number; reviewExpiresAt: number;
  // Only collectLpFees has an on-chain deadline. Claims have an off-chain review expiry.
  deadline: string | null;
  expectedNativeWei: string; expectedTokenWei: string;
  positionTokenId: string | null; principalLiquidityWei: string | null;
};
export type EarningsClaimQuote = { gasUnits: string; gasPriceWei: string; estimatedNetworkFeeWei: string;
  amounts: EarningsClaimAmounts; amountSemantics: "current-credit-may-grow" | "original-position-fees-may-grow" | "factory-global-fees-may-grow";
  transactions: 1; onchainDeadline: boolean };
export type EarningsClaimVerification = { status: "pending" | "confirmed" | "reverted" | "unavailable";
  transactionHash?: Hex; settlementPending?: boolean; indexed?: boolean; amounts?: EarningsClaimAmounts; reason?: string };
export type EarningsPreparedClaim = { status: "prepared"; request: EarningsClaimRequest; quote: EarningsClaimQuote };

const zero = "0x0000000000000000000000000000000000000000";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (value: unknown): value is Address => isLaunchAddress(value) && !same(value, zero);
const uint = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const quantity = (value: unknown): value is Hex => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i.test(value);
const keys = ["schemaVersion", "operation", "chainId", "from", "to", "data", "value", "nonce", "factory", "token", "originCurve", "ledger", "beneficiary", "discoveryRecipient",
  "factoryRuntimeHash", "targetRuntimeHash", "deploymentBlockNumber", "deploymentBlockHash", "reviewBlockNumber", "reviewBlockHash", "reviewTimestamp",
  "reviewExpiresAt", "deadline", "expectedNativeWei", "expectedTokenWei", "positionTokenId", "principalLiquidityWei"];

export function isEarningsClaimOperation(value: unknown): value is EarningsClaimOperation {
  return typeof value === "string" && earningsClaimOperations.includes(value as EarningsClaimOperation);
}

export function isEarningsClaimRequest(value: unknown): value is EarningsClaimRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Partial<EarningsClaimRequest>;
  if (Object.keys(r).length !== keys.length || !keys.every(key => Object.hasOwn(r, key)) || r.schemaVersion !== 1
    || !isEarningsClaimOperation(r.operation) || !["0x7a69", "0x1237"].includes(r.chainId ?? "")
    || ![r.from, r.to, r.factory, r.ledger, r.beneficiary, r.discoveryRecipient].every(address) || r.value !== "0x0" || !quantity(r.nonce)
    || BigInt(r.nonce!) > BigInt(Number.MAX_SAFE_INTEGER)
    || ![r.factoryRuntimeHash, r.targetRuntimeHash, r.deploymentBlockHash, r.reviewBlockHash].every(isTransactionHash)
    || !quantity(r.deploymentBlockNumber) || !quantity(r.reviewBlockNumber) || BigInt(r.deploymentBlockNumber!) < 1n
    || BigInt(r.reviewBlockNumber!) < BigInt(r.deploymentBlockNumber!)
    || !Number.isSafeInteger(r.reviewTimestamp) || r.reviewTimestamp! < 1 || !Number.isSafeInteger(r.reviewExpiresAt)
    || r.reviewExpiresAt !== r.reviewTimestamp! + 180 || !uint(r.expectedNativeWei) || !uint(r.expectedTokenWei)
    || typeof r.data !== "string" || !/^0x(?:[0-9a-f]{2}){4,100}$/i.test(r.data)) return false;
  if (r.operation === "creation-fees") {
    if (r.token !== zero || r.originCurve !== zero || !same(r.to!, r.factory!) || !same(r.ledger!, r.factory!)) return false;
  } else if (!address(r.token) || !address(r.originCurve)) return false;
  if (r.operation === "lp-collect") {
    if (!uint(r.deadline) || BigInt(r.deadline) !== BigInt(r.reviewTimestamp!) + 180n || !uint(r.positionTokenId)
      || r.positionTokenId === "0" || !uint(r.principalLiquidityWei) || r.principalLiquidityWei === "0" || !same(r.beneficiary!, r.ledger!)) return false;
  } else if (r.deadline !== null) return false;
  if (r.operation.startsWith("lp-") && (!uint(r.positionTokenId) || r.positionTokenId === "0"
      || !uint(r.principalLiquidityWei) || r.principalLiquidityWei === "0")) return false;
  if (!r.operation.startsWith("lp-") && (r.positionTokenId !== null || r.principalLiquidityWei !== null)) return false;
  if (r.operation !== "lp-collect" && r.operation !== "creation-fees" && (!same(r.from!, r.beneficiary!) || !same(r.from!, r.discoveryRecipient!) || !same(r.to!, r.ledger!))) return false;
  if ((r.operation === "curve-claim" || r.operation === "creation-fees" || r.operation === "lp-claim-native") && r.expectedTokenWei !== "0") return false;
  if (r.operation === "lp-claim-token" && r.expectedNativeWei !== "0") return false;
  return r.expectedNativeWei !== "0" || r.expectedTokenWei !== "0";
}

export async function encodeEarningsClaim(operation: EarningsClaimOperation, token: Address, deadline: string | null): Promise<Hex> {
  const { encodeFunctionData, parseAbi } = await import("viem");
  if (operation === "lp-collect") {
    if (!uint(deadline)) throw new Error("Collection deadline required");
    return encodeFunctionData({ abi: parseAbi(["function collectLpFees(address token,uint256 deadline)"]), functionName: "collectLpFees", args: [token, BigInt(deadline)] });
  }
  if (deadline !== null) throw new Error("This claim has no on-chain deadline");
  if (operation === "creation-fees") return "0x60fd947d";
  if (operation === "lp-claim-native" || operation === "lp-claim-token") return encodeFunctionData({ abi: parseAbi(["function claimAsset(bool native)"]),
    functionName: "claimAsset", args: [operation === "lp-claim-native"] });
  return "0x4e71d92d";
}

export async function claimCalldataMatches(request: EarningsClaimRequest) {
  return isEarningsClaimRequest(request) && same(request.data, await encodeEarningsClaim(request.operation, request.token, request.deadline));
}

export function sameEarningsClaimRequest(left: EarningsClaimRequest, right: EarningsClaimRequest) {
  return keys.every(key => {
    const a = left[key as keyof EarningsClaimRequest], b = right[key as keyof EarningsClaimRequest];
    return typeof a === "string" && typeof b === "string" && a.startsWith("0x") ? same(a, b) : a === b;
  });
}

export type EarningsClaimJournal = { schemaVersion: 1; request: EarningsClaimRequest; state: "awaiting-wallet" | "submitted" | "hash-missing" | "confirmed" | "reverted";
  transactionHash: Hex | null; createdAt: number; updatedAt: number };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const journalKey = (request: EarningsClaimRequest) => `rmt.earnings.pending.v1:${request.chainId}:${request.factory.toLowerCase()}:${request.from.toLowerCase()}`;

export function readEarningsClaimJournal(storage: Storage, request: EarningsClaimRequest): EarningsClaimJournal | null {
  try {
    const raw = storage.getItem(journalKey(request));
    if (!raw || raw.length > 8192) return null;
    const j = JSON.parse(raw) as EarningsClaimJournal;
    return Object.keys(j).length === 6 && j.schemaVersion === 1 && isEarningsClaimRequest(j.request)
      && j.request.chainId === request.chainId && same(j.request.factory, request.factory) && same(j.request.from, request.from)
      && ["awaiting-wallet", "submitted", "hash-missing", "confirmed", "reverted"].includes(j.state)
      && (j.transactionHash === null || isTransactionHash(j.transactionHash)) && Number.isSafeInteger(j.createdAt) && j.createdAt > 0
      && Number.isSafeInteger(j.updatedAt) && j.updatedAt >= j.createdAt ? j : null;
  } catch { return null; }
}

export function storeEarningsClaimJournal(storage: Storage, journal: EarningsClaimJournal) {
  if (!isEarningsClaimRequest(journal.request) || JSON.stringify(journal).length > 8192) throw new Error("Invalid earnings journal");
  storage.setItem(journalKey(journal.request), JSON.stringify(journal));
  const saved = readEarningsClaimJournal(storage, journal.request);
  if (!saved || !sameEarningsClaimRequest(saved.request, journal.request) || saved.state !== journal.state || saved.transactionHash !== journal.transactionHash) {
    throw new Error("Earnings journal could not be persisted");
  }
}

export function clearRejectedEarningsClaim(storage: Storage, original: EarningsClaimRequest) {
  const j = readEarningsClaimJournal(storage, original);
  // Only explicit wallet rejection clears an unsubmitted request; timeouts,
  // disconnects and missing hashes retain the original nonce for reconciliation.
  if (j?.state === "awaiting-wallet" && sameEarningsClaimRequest(j.request, original) && j.transactionHash === null) storage.removeItem(journalKey(original));
}

type Wallet = { request: (input: { method: string; params?: unknown[] }) => Promise<unknown> };
export async function sendEarningsClaim(input: {
  request: EarningsClaimRequest; quote: EarningsClaimQuote; wallet: Wallet; storage: Storage;
  location: Pick<Location, "protocol" | "hostname" | "port">;
  revalidate: (prior: EarningsClaimRequest) => Promise<EarningsPreparedClaim>;
  now?: () => number;
}) {
  const { request, wallet, storage, location } = input;
  const now = input.now ?? Date.now;
  if (request.chainId !== "0x7a69" || location.protocol !== "http:" || location.hostname !== "127.0.0.1" || !location.port
    || !await claimCalldataMatches(request)) throw new Error("Earnings execution is unavailable outside the isolated fixture");
  const existing = readEarningsClaimJournal(storage, request);
  if (existing && !["confirmed", "reverted"].includes(existing.state)) throw new Error("Recover the existing earnings transaction first");
  if (!uint(input.quote.gasUnits) || BigInt(input.quote.gasUnits) < 21000n || BigInt(input.quote.gasUnits) > 30_000_000n
    || !uint(input.quote.gasPriceWei) || input.quote.gasPriceWei === "0"
    || input.quote.estimatedNetworkFeeWei !== (BigInt(input.quote.gasUnits) * BigInt(input.quote.gasPriceWei)).toString()) throw new Error("Invalid network cost review");
  const readWallet = async () => {
    const accounts = await wallet.request({ method: "eth_accounts" });
    const chain = await wallet.request({ method: "eth_chainId" });
    if (!Array.isArray(accounts) || !address(accounts[0]) || !same(accounts[0], request.from) || chain !== request.chainId) throw new Error("Wallet account or network changed");
  };
  await readWallet();
  const checked = await input.revalidate(request);
  if (checked.status !== "prepared" || !sameEarningsClaimRequest(checked.request, request) || now() >= request.reviewExpiresAt * 1000) throw new Error("Earnings review is stale");
  await readWallet();
  // The server re-estimates at revalidation. A different cost needs a new review,
  // never an automatic fee increase or a silently changed wallet request.
  if (checked.quote.gasUnits !== input.quote.gasUnits || checked.quote.gasPriceWei !== input.quote.gasPriceWei) throw new Error("Review the refreshed network cost");
  const pendingNonce = await wallet.request({ method: "eth_getTransactionCount", params: [request.from, "pending"] });
  const runtime = await wallet.request({ method: "eth_getCode", params: [request.to, "latest"] });
  const { keccak256 } = await import("viem");
  if (!quantity(pendingNonce) || BigInt(pendingNonce) !== BigInt(request.nonce)) throw new Error("Wallet pending nonce changed");
  if (typeof runtime !== "string" || runtime.length > 49154 || !/^0x(?:[0-9a-f]{2}){1,24576}$/i.test(runtime)
    || !same(keccak256(runtime as Hex), request.targetRuntimeHash)) throw new Error("Wallet contract runtime changed");
  await readWallet();
  const journal: EarningsClaimJournal = { schemaVersion: 1, request, state: "awaiting-wallet", transactionHash: null, createdAt: now(), updatedAt: now() };
  storeEarningsClaimJournal(storage, journal);
  try {
    const hash = await wallet.request({ method: "eth_sendTransaction", params: [{ from: request.from, to: request.to, data: request.data,
      value: "0x0", chainId: request.chainId, nonce: request.nonce, gas: "0x" + BigInt(input.quote.gasUnits).toString(16) }] });
    journal.state = isTransactionHash(hash) ? "submitted" : "hash-missing";
    journal.transactionHash = isTransactionHash(hash) ? hash : null;
    journal.updatedAt = now(); storeEarningsClaimJournal(storage, journal);
    return journal;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 4001) clearRejectedEarningsClaim(storage, request);
    // Other errors may occur after broadcast. Keep the original journal and do
    // not ask the wallet again; nonce recovery determines what actually happened.
    throw error;
  }
}
