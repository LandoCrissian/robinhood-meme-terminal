import { isExternalEthereumWallet, walletGatewayKey, type WalletGatewayCandidate } from "./wallet-gateway";

export type ConnectedWalletProvider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (name: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (name: string, listener: (...args: unknown[]) => void) => void;
};
export type ConnectedWalletRead = {
  status: "checking" | "ready" | "wrong-chain" | "account-mismatch" | "disconnected" | "unavailable";
  chainId: number | null;
  provider: ConnectedWalletProvider | null;
};
export const uncheckedConnectedWallet: ConnectedWalletRead = { status: "checking", chainId: null, provider: null };

/** Normalize SDK/JSON-RPC network identifiers; never infer a network from login. */
export function connectedWalletChainId(value: unknown): number | null {
  if (typeof value === "string") {
    if (/^eip155:[1-9][0-9]*$/.test(value)) value = value.slice(7);
    if (!/^(?:0x[0-9a-f]+|[1-9][0-9]*)$/i.test(String(value))) return null;
    value = Number(value);
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Keep duplicate bindings ambiguous, including two connectors for one address. */
export function exactConnectedExternalWallet<T extends WalletGatewayCandidate>(wallets: readonly T[], key: string) {
  const matches = wallets.filter(wallet => isExternalEthereumWallet(wallet) && walletGatewayKey(wallet) === key);
  return matches.length === 1 ? matches[0] : undefined;
}
export function soleConnectedExternalWallet<T extends WalletGatewayCandidate>(wallets: readonly T[]) {
  const matches = wallets.filter(isExternalEthereumWallet);
  return matches.length === 1 ? matches[0] : undefined;
}

async function boundedRead<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Wallet read timed out.")), 8_000); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Only non-interactive reads. Never request accounts, signatures, approvals or a chain switch. */
export async function readConnectedWallet(wallet: {
  address: string; getEthereumProvider: () => Promise<unknown>;
}, requiredChainId = 4663): Promise<ConnectedWalletRead> {
  try {
    const provider = await boundedRead(() => wallet.getEthereumProvider()) as ConnectedWalletProvider | null;
    if (!provider || typeof provider.request !== "function") return { status: "unavailable", chainId: null, provider: null };
    const [accounts, rawChain] = await boundedRead(() => Promise.all([
      provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" })
    ]));
    const chainId = connectedWalletChainId(rawChain);
    if (!Array.isArray(accounts) || accounts.length === 0) return { status: "disconnected", chainId, provider };
    // EIP-1193 does not define a selected-account ordering. Keep RMT's exact
    // SDK connector/address binding instead of inferring a signer from index 0.
    if (!accounts.some(account => typeof account === "string" && /^0x[0-9a-f]{40}$/i.test(account)
      && account.toLowerCase() === wallet.address.toLowerCase())) return { status: "account-mismatch", chainId, provider };
    if (!chainId) return { status: "unavailable", chainId: null, provider };
    return { status: chainId === requiredChainId ? "ready" : "wrong-chain", chainId, provider };
  } catch { return { status: "unavailable", chainId: null, provider: null }; }
}

export function connectedWalletMessage(state: ConnectedWalletRead) {
  switch (state.status) {
    case "ready": return "Signing wallet ready on Robinhood Chain.";
    case "checking": return "Checking the connected signing wallet…";
    case "wrong-chain": return "Your signing wallet is on another network. Switch to Robinhood Chain.";
    case "account-mismatch": return "Your wallet app is using a different account. Select the displayed account there or reconnect it.";
    case "disconnected": return "The signing wallet is disconnected. Reconnect it to continue.";
    case "unavailable": return "The signing provider is unavailable. Reconnect your wallet; account sign-in alone is not a wallet connection.";
  }
}
