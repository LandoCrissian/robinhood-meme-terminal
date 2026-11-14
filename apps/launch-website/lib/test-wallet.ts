import { isLaunchAddress } from "./launch-data";
import { isLocalTestWallet, testCreationChain } from "./test-creation";

type WalletProvider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
};

export type TestWallet = { account: string; provider: WalletProvider; request: WalletProvider["request"] };
type TestWalletAnchor = { blockNumber: string; blockHash: string; reviewBlockNumber?: string; reviewBlockHash?: string };

export const sameWalletHex = (value: unknown, expected: string) =>
  typeof value === "string" && value.toLowerCase() === expected.toLowerCase();

export function testProviderAtWindow() {
  if (!isLocalTestWallet(window.location)) return;
  const provider = (window as typeof window & { ethereum?: WalletProvider }).ethereum;
  return provider && typeof provider.request === "function" ? provider : undefined;
}

function selectedAccount(accounts: unknown) {
  return Array.isArray(accounts) && isLaunchAddress(accounts[0]) && !/^0x0{40}$/i.test(accounts[0])
    ? accounts[0].toLowerCase() : undefined;
}

export function testWalletErrorCode(error: unknown): number | undefined {
  // Match the reviewed #594 wallet handling, including wrapped EIP-1193 errors.
  for (let depth = 0; depth < 6 && error && typeof error === "object"; depth++) {
    const detail = error as { code?: unknown; cause?: unknown };
    if (typeof detail.code === "number") return detail.code;
    error = detail.cause;
  }
}

export async function assertTestWalletBinding(wallet: TestWallet, request?: TestWalletAnchor) {
  if (testProviderAtWindow() !== wallet.provider || wallet.provider.request !== wallet.request) throw new Error("Wallet changed");
  const readBlock = (number: string) => wallet.request.call(wallet.provider, { method: "eth_getBlockByNumber", params: [number, false] });
  const [accounts, chain, anchor, review] = await Promise.all([
    wallet.request.call(wallet.provider, { method: "eth_accounts" }),
    wallet.request.call(wallet.provider, { method: "eth_chainId" }),
    request && readBlock(request.blockNumber),
    request?.reviewBlockNumber && readBlock(request.reviewBlockNumber),
  ]);
  if (!sameWalletHex(selectedAccount(accounts), wallet.account) || chain !== testCreationChain) throw new Error("Wallet changed");
  const matchesBlock = (value: unknown, number: string, hash: string) =>
    !!value && typeof value === "object" && "hash" in value && sameWalletHex(value.hash, hash) &&
    "number" in value && sameWalletHex(value.number, number);
  if (request && !matchesBlock(anchor, request.blockNumber, request.blockHash)) throw new Error("Wallet fixture differs from server fixture");
  if (request?.reviewBlockNumber && (!request.reviewBlockHash || !matchesBlock(review, request.reviewBlockNumber, request.reviewBlockHash))) {
    throw new Error("Wallet review block differs from the server fixture");
  }
}

export async function connectTestWallet(anchor?: TestWalletAnchor) {
  const provider = testProviderAtWindow();
  if (!provider) throw new Error("No test wallet");
  const request = provider.request;
  const account = selectedAccount(await request.call(provider, { method: "eth_requestAccounts" }));
  if (!account) throw new Error("Select an account");
  const connected: TestWallet = { account, provider, request };
  await assertTestWalletBinding(connected, anchor);
  return connected;
}

export function subscribeTestWallet(wallet: TestWallet, listener: () => void) {
  if (!wallet.provider.on || !wallet.provider.removeListener) return;
  const events = ["accountsChanged", "chainChanged", "disconnect"];
  for (const event of events) wallet.provider.on(event, listener);
  return () => {
    for (const event of events) wallet.provider.removeListener?.(event, listener);
  };
}
