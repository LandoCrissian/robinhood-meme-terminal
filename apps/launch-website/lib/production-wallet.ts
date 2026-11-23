import { isLaunchAddress } from "./launch-data";
import { type TestWallet, sameWalletHex } from "./test-wallet";

export type ProductionWallet = TestWallet;
export type FinancialCapability = "trading" | "claims";
// Financial flows share bounded receipt indexes and one consumed-nonce floor
// map. Serializing all production account writers also protects cross-account
// tabs from overwriting another account's durable floor or capacity admission.
export const productionAccountLock = (_account: string) => "rmt:financial:4663:durable-storage";
export function isProductionWalletOrigin(location: Pick<Location, "protocol" | "hostname" | "port">) {
  return location.protocol === "https:" && location.hostname === "www.rmtlaunch.fun" && location.port === "";
}
export function productionProviderAtWindow() {
  if (!isProductionWalletOrigin(window.location)) return;
  const provider = (window as typeof window & { ethereum?: TestWallet["provider"] }).ethereum;
  return provider && typeof provider.request === "function" ? provider : undefined;
}
export async function readProductionCapability(scope: FinancialCapability) {
  if (!isProductionWalletOrigin(window.location)) throw new Error("Production wallet origin unavailable");
  const response = await fetch("/api/launchpad/config", { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
  const capability = await response.json() as { status?: string; readiness?: string; chainId?: number; trading?: string; claims?: string;
    approvals?: Partial<Record<FinancialCapability, string>> };
  if (response.status === 503 || capability.readiness === "unavailable") {
    throw new Error("Network verification is temporarily unavailable. Your amount is unchanged; try again shortly.");
  }
  if (!response.ok || capability.status !== "production-financial" || capability.chainId !== 4663 || capability[scope] !== "enabled"
    || !/^[a-f0-9]{64}$/.test(capability.approvals?.[scope] ?? "")) throw new Error("This financial capability is not activated");
  return capability.approvals![scope]!;
}
export async function assertProductionWalletBinding(wallet: ProductionWallet, anchor?: {
  blockNumber: string; blockHash: string; reviewBlockNumber?: string; reviewBlockHash?: string;
}) {
  if (productionProviderAtWindow() !== wallet.provider || wallet.provider.request !== wallet.request) throw new Error("Wallet provider changed");
  const request = (method: string, params?: readonly unknown[]) => wallet.request.call(wallet.provider, { method, params });
  const [accounts, chain, deployment, reviewed] = await Promise.all([request("eth_accounts"), request("eth_chainId"),
    anchor && request("eth_getBlockByNumber", [anchor.blockNumber, false]),
    anchor?.reviewBlockNumber && request("eth_getBlockByNumber", [anchor.reviewBlockNumber, false])]);
  if (!Array.isArray(accounts) || !sameWalletHex(accounts[0], wallet.account) || chain !== "0x1237") throw new Error("Wallet account or network changed");
  const matches = (value: unknown, number: string, hash: string) => !!value && typeof value === "object"
    && "number" in value && sameWalletHex(value.number, number) && "hash" in value && sameWalletHex(value.hash, hash);
  if (anchor && !matches(deployment, anchor.blockNumber, anchor.blockHash)) throw new Error("Wallet deployment checkpoint differs");
  if (anchor?.reviewBlockNumber && (!anchor.reviewBlockHash || !matches(reviewed, anchor.reviewBlockNumber, anchor.reviewBlockHash))) {
    throw new Error("Wallet review checkpoint differs");
  }
}
export async function connectProductionFinancialWallet(scope: FinancialCapability): Promise<ProductionWallet> {
  // Recheck the server gate before any wallet prompt, including an explicit
  // connection click on a page rendered before an operator disabled the route.
  await readProductionCapability(scope);
  const provider = productionProviderAtWindow();
  if (!provider) throw new Error("No supported wallet provider");
  const request = provider.request;
  const accounts = await request.call(provider, { method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !isLaunchAddress(accounts[0]) || /^0x0{40}$/i.test(accounts[0])) throw new Error("Select a wallet account");
  if (scope === "trading" && await request.call(provider, {method:"eth_chainId"}) !== "0x1237") {
    await request.call(provider, {method:"wallet_switchEthereumChain", params:[{chainId:"0x1237"}]});
  }
  const wallet = { account: accounts[0].toLowerCase(), provider, request };
  await assertProductionWalletBinding(wallet);
  return wallet;
}
