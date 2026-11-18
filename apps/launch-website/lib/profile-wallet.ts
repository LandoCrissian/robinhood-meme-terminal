import { getAddress, stringToHex, type Address } from "viem";
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { profileDeleteStatement, profileSignInStatement, type ProfileChallenge } from "./profiles";

export const accountChainId = 4663;
export const accountChainHex = "0x1237";
export type AccountProvider = {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
  isMetaMask?: boolean; isRabby?: boolean;
};
export type AccountWallet = { id: string; name: string; provider: AccountProvider };
export type ConnectedAccount = AccountWallet & { address: Address; request: AccountProvider["request"]; chainId: number };
export const sameAccount = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const address = (input: unknown): input is Address => typeof input === "string" && /^0x[0-9a-f]{40}$/i.test(input) && BigInt(input) > 0xffffn;

export function discoverAccountWallets(announce: (wallet: AccountWallet) => void) {
  const seen = new Set<AccountProvider>();
  function receive(event: Event) {
    const detail = (event as CustomEvent<{ info?: { uuid?: string; name?: string }; provider?: AccountProvider }>).detail;
    if (!detail?.provider || typeof detail.provider.request !== "function" || seen.has(detail.provider) || seen.size >= 8
      || !detail.info?.uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detail.info.uuid)
      || !detail.info.name || detail.info.name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(detail.info.name)) return;
    seen.add(detail.provider); announce({ id: detail.info.uuid, name: detail.info.name, provider: detail.provider });
  }
  window.addEventListener("eip6963:announceProvider", receive);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const fallback = (window as typeof window & { ethereum?: AccountProvider }).ethereum;
  if (fallback && typeof fallback.request === "function" && !seen.has(fallback)) {
    seen.add(fallback); announce({ id: "injected", name: fallback.isRabby ? "Rabby" : fallback.isMetaMask ? "MetaMask" : "Browser wallet", provider: fallback });
  }
  return () => window.removeEventListener("eip6963:announceProvider", receive);
}

export async function connectAccountWallet(wallet: AccountWallet): Promise<ConnectedAccount> {
  const request = wallet.provider.request;
  const accounts = await request.call(wallet.provider, { method: "eth_requestAccounts" });
  const [chain, selected] = await Promise.all([
    request.call(wallet.provider, { method: "eth_chainId" }), request.call(wallet.provider, { method: "eth_accounts" }),
  ]);
  if (wallet.provider.request !== request || !Array.isArray(accounts) || !address(accounts[0]) || !Array.isArray(selected)
      || !sameAccount(selected[0], accounts[0]) || typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain)
      || !Number.isSafeInteger(Number(BigInt(chain))) || BigInt(chain) <= 0n) {
    throw new Error("The wallet did not provide a supported account and network.");
  }
  return { ...wallet, address: getAddress(accounts[0].toLowerCase()), request, chainId: Number(BigInt(chain)) };
}

export async function assertConnectedAccount(wallet: ConnectedAccount) {
  if (wallet.provider.request !== wallet.request) throw new Error("Wallet provider changed. Connect again.");
  const [accounts, chain] = await Promise.all([
    wallet.request.call(wallet.provider, { method: "eth_accounts" }), wallet.request.call(wallet.provider, { method: "eth_chainId" }),
  ]);
  if (!Array.isArray(accounts) || !sameAccount(accounts[0], wallet.address) || chain !== accountChainHex) {
    throw new Error("Wallet account or network changed. Connect and review again.");
  }
}

export function subscribeAccountWallet(wallet: ConnectedAccount, changed: () => void) {
  for (const event of ["accountsChanged", "chainChanged", "disconnect"]) wallet.provider.on?.(event, changed);
  return () => { for (const event of ["accountsChanged", "chainChanged", "disconnect"]) wallet.provider.removeListener?.(event, changed); };
}

export async function signAccountMessage(wallet: ConnectedAccount, message: string, assertCurrent: () => void) {
  if (!message || message.length > 8_192) throw new Error("Unsupported sign-in message.");
  await assertConnectedAccount(wallet); assertCurrent();
  const result = await wallet.request.call(wallet.provider, { method: "personal_sign", params: [stringToHex(message), wallet.address] });
  await assertConnectedAccount(wallet); assertCurrent();
  if (typeof result !== "string" || !/^0x[0-9a-f]{130}$/i.test(result)) throw new Error("The wallet returned an unsupported sign-in response.");
  return result;
}

export function assertAccountChallenge(challenge: ProfileChallenge, wallet: ConnectedAccount,
  location: Pick<Location, "host" | "origin" | "protocol">, now = Date.now()) {
  if (!challenge || typeof challenge.message !== "string" || challenge.message.length > 8_192
      || typeof challenge.nonce !== "string" || !/^[a-z0-9]{8,64}$/i.test(challenge.nonce)
      || !["login", "delete-profile"].includes(challenge.purpose)) throw new Error("Unsupported sign-in challenge.");
  const parsed = parseSiweMessage(challenge.message), expiration = Date.parse(challenge.expiresAt);
  if (!validateSiweMessage({ message: parsed, address: wallet.address, domain: location.host, nonce: challenge.nonce, time: new Date(now) })
      || parsed.chainId !== accountChainId || parsed.version !== "1" || parsed.uri !== location.origin
      || parsed.statement !== (challenge.purpose === "login" ? profileSignInStatement : profileDeleteStatement)
      || !parsed.issuedAt || parsed.issuedAt.getTime() > now + 15_000 || parsed.issuedAt.getTime() < now - 600_000
      || !parsed.expirationTime || parsed.expirationTime.getTime() !== expiration || expiration <= now || expiration > now + 600_000
      || (parsed.scheme !== undefined && parsed.scheme + ":" !== location.protocol) || parsed.resources?.length) {
    throw new Error("The sign-in request does not match this account, network, website or expiry.");
  }
  if (createSiweMessage(parsed as Parameters<typeof createSiweMessage>[0]) !== challenge.message) throw new Error("Unsupported sign-in message formatting.");
}
