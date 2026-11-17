import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { isTransactionHash, testCreationFeeWei, testCreationSignature, type TestCreationFields } from "./test-creation";
import { type TestWallet, testWalletErrorCode } from "./test-wallet";

export const productionCreationPath = "/api/launchpad/production-creation";
export const productionCreationChain = "0x1237";
export const productionCreationFactory = "0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3";
export const productionCreationOrigin = "https://www.rmtlaunch.fun";
export const productionCreationOperating = "0xAF9F10258b091719618c19D057F9cDAB72eFFd8b";
export const productionCreationReserve = "0x8D44078642ce938Fd799b23087BcdD6114A302e5";
export const productionCreationJournalKey = "rmt:creation:4663:7281e1f9:v1";
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
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !sameProductionHex(accounts[0], "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA")) throw new Error("Use the approved creator account");
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
  await assertProductionWallet(wallet, request);
  assertReviewCurrent();
  if (readProductionCreationJournal(storage)) throw new Error("An original creation request requires recovery");
  const journal: ProductionCreationJournal = { request };
  storage.setItem(productionCreationJournalKey, JSON.stringify(journal));
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
