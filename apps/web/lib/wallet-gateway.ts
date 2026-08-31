import type { WalletListEntry } from "@privy-io/react-auth";

/**
 * One canonical external-wallet admission list for the RMT terminal.
 *
 * Privy resolves `detected_ethereum_wallets` through EIP-6963 (and the
 * compatible injected-provider fallback). This is how wallets such as Rabby
 * enter RMT without relying on Privy's deprecated `rabby_wallet` identifier.
 */
export const RMT_EXTERNAL_WALLET_LIST = [
  "metamask",
  "coinbase_wallet",
  "detected_ethereum_wallets",
  "wallet_connect"
] as const satisfies readonly WalletListEntry[];

export const RMT_INJECTED_WALLET_LIST = [
  "detected_ethereum_wallets"
] as const satisfies readonly WalletListEntry[];

export function rmtExternalWalletOptions(): WalletListEntry[] {
  return [...RMT_EXTERNAL_WALLET_LIST];
}

export function rmtInjectedWalletOptions(): WalletListEntry[] {
  return [...RMT_INJECTED_WALLET_LIST];
}

export const RMT_ACTIVE_WALLET_SESSION_KEY = "rmt:active-trading-wallet:v1";

export type WalletGatewayCandidate = {
  address: string;
  connectedAt?: number;
  connectorType: string;
  linked?: boolean;
  meta?: {
    id?: string;
    name?: string;
  };
  type?: "ethereum" | "solana";
  walletClientType: string;
};

export function isEmbeddedWalletClientType(walletClientType?: string | null) {
  return walletClientType === "privy" || walletClientType === "privy-v2";
}

export function isExternalEthereumWallet<T extends WalletGatewayCandidate>(wallet: T): boolean {
  return wallet.type === "ethereum" && !isEmbeddedWalletClientType(wallet.walletClientType);
}

export function walletGatewayKey(wallet: WalletGatewayCandidate) {
  const reportedIdentity = wallet.meta?.id?.trim().toLowerCase() || "unreported";
  return JSON.stringify([
    wallet.connectorType.trim().toLowerCase(),
    wallet.walletClientType.trim().toLowerCase(),
    reportedIdentity,
    wallet.address.trim().toLowerCase()
  ]);
}

export type WalletGatewayIdentity = {
  connectorType: string;
  walletClientType: string;
  reportedId: string;
  address: string;
};

export function parseWalletGatewayKey(value?: string | null): WalletGatewayIdentity | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 4 || parsed.some((part) => typeof part !== "string" || !part)) {
      return null;
    }
    const [connectorType, walletClientType, reportedId, address] = parsed;
    if (!/^0x[0-9a-f]{40}$/i.test(address)) return null;
    return {
      connectorType: connectorType.toLowerCase(),
      walletClientType: walletClientType.toLowerCase(),
      reportedId: reportedId.toLowerCase(),
      address: address.toLowerCase()
    };
  } catch {
    return null;
  }
}

export function externalEthereumWallets<T extends WalletGatewayCandidate>(wallets: readonly T[]) {
  const seen = new Set<string>();
  return wallets.filter((wallet) => {
    if (!isExternalEthereumWallet(wallet)) return false;
    const key = walletGatewayKey(wallet);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function matchingExternalWallets<T extends WalletGatewayCandidate>(wallets: readonly T[], address?: string) {
  if (!address) return [];
  const normalizedAddress = address.toLowerCase();
  return externalEthereumWallets(wallets).filter((wallet) => wallet.address.toLowerCase() === normalizedAddress);
}

/**
 * Resolves the exact active external wallet without guessing between two
 * connectors that expose the same address. A remembered connector identity
 * wins only when its address still equals Wagmi's active address. If more than
 * one connector matches and no exact preference exists, RMT fails closed and
 * asks the trader to choose.
 */
export function resolveActiveExternalWallet<T extends WalletGatewayCandidate>(
  wallets: readonly T[],
  address?: string,
  preferredWalletKey?: string | null
) {
  const matches = matchingExternalWallets(wallets, address);
  if (preferredWalletKey) {
    const preferred = matches.find((wallet) => walletGatewayKey(wallet) === preferredWalletKey);
    if (preferred) return preferred;
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function isConnectorSelectionConfirmed(params: {
  appliedWalletKey?: string | null;
  authenticated: boolean;
  matchingWalletCount: number;
  wallet?: WalletGatewayCandidate;
}) {
  if (!params.wallet) return false;
  if (params.authenticated && !params.wallet.linked) return false;
  if (params.matchingWalletCount <= 0) return false;
  if (params.matchingWalletCount === 1) return true;
  return params.appliedWalletKey === walletGatewayKey(params.wallet);
}

export function requiresExplicitWalletSelection(params: {
  activeEmbeddedWallet: boolean;
  activeExternalWalletConfirmed: boolean;
  externalWalletCount: number;
  hasActiveAddress: boolean;
  matchingExternalWalletCount: number;
}) {
  if (!params.hasActiveAddress) return false;
  if (params.matchingExternalWalletCount > 0 && !params.activeExternalWalletConfirmed) return true;
  return params.activeEmbeddedWallet && params.externalWalletCount > 0;
}

export function walletGatewayDisplayName(wallet: WalletGatewayCandidate) {
  const reportedName = wallet.meta?.name?.trim();
  if (reportedName) return reportedName;
  if (wallet.walletClientType === "wallet_connect") return "Mobile wallet";
  return wallet.walletClientType
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
