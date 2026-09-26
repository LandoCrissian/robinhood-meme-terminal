import type { WalletListEntry } from "@privy-io/react-auth";
import { getAddress } from "viem";

/**
 * One canonical external-wallet option list for the RMT terminal.
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

export function rmtActiveWalletPreferenceKey(userId: string) {
  const normalized = userId.trim();
  if (!normalized) throw new Error("An authenticated user is required for wallet preference storage.");
  return `rmt:active-trading-wallet:v2:${encodeURIComponent(normalized)}`;
}

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

export type LinkedWalletAccount = {
  address?: string;
  chainType?: string;
  connectorType?: string;
  type?: string;
  walletClientType?: string;
};

export type RmtActiveSignerAuthority = {
  adapter: "privy-wagmi-4" | "direct";
  connectorId: string;
  connectorType: string;
  connectorUid: string;
  originConnectorType: string;
  walletClientType: string;
  walletKey: string;
  walletKind: "embedded" | "external";
};

export function isEmbeddedWalletClientType(walletClientType?: string | null) {
  return walletClientType === "privy" || walletClientType === "privy-v2";
}

export function isExternalEthereumWallet<T extends WalletGatewayCandidate>(wallet: T): boolean {
  return wallet.type === "ethereum" && !isEmbeddedWalletClientType(wallet.walletClientType);
}

export function isTradingEthereumWallet<T extends WalletGatewayCandidate>(wallet: T): boolean {
  return wallet.type === "ethereum";
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

/** Mirrors the connector identity emitted by the installed @privy-io/wagmi 4.0.15 adapter. */
export function privyWagmiConnectorId(wallet: Pick<WalletGatewayCandidate, "address" | "meta" | "walletClientType">) {
  const reportedId = wallet.meta?.id?.trim();
  if (!reportedId) return null;
  return wallet.walletClientType === "privy" ? `${reportedId}.${wallet.address}` : reportedId;
}

/**
 * Rebinds a Privy wallet record to the exact connector identity emitted by the
 * installed @privy-io/wagmi adapter. That adapter represents embedded,
 * WalletConnect, and browser wallets as exact `injected` Wagmi connectors, so
 * the SDK transport label is not itself the signing connector type.
 *
 * Account UI, funding destination, quote taker, and signer authority must all
 * publish this same connector-qualified key. The original SDK wallet remains
 * the object used to obtain and activate its provider.
 */
export function privyWalletWagmiIdentity(
  wallet: WalletGatewayCandidate,
  connector: { id: string; type: string }
): WalletGatewayCandidate | undefined {
  if (wallet.type !== "ethereum" || privyWagmiConnectorId(wallet) !== connector.id) {
    return undefined;
  }
  return {
    ...wallet,
    connectorType: connector.type,
    meta: { ...wallet.meta, id: connector.id }
  };
}

/** @deprecated Use the wallet-kind-neutral exact Privy/Wagmi identity helper. */
export const embeddedWalletWagmiIdentity = privyWalletWagmiIdentity;

export function privyWalletSignerAuthority(
  wallet: WalletGatewayCandidate,
  connector: { id: string; type: string; uid: string }
): RmtActiveSignerAuthority | undefined {
  if (!privyWalletWagmiIdentity(wallet, connector) || connector.type !== "injected") return undefined;
  return {
    adapter: "privy-wagmi-4",
    connectorId: connector.id,
    connectorType: connector.type,
    connectorUid: connector.uid,
    originConnectorType: wallet.connectorType,
    walletClientType: wallet.walletClientType,
    walletKey: walletGatewayKey(wallet),
    walletKind: isEmbeddedWalletClientType(wallet.walletClientType) ? "embedded" : "external"
  };
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

export function isLinkedEthereumWalletAccount(account: LinkedWalletAccount) {
  return account.type === "wallet"
    && account.chainType === "ethereum"
    && typeof account.address === "string"
    && /^0x[0-9a-f]{40}$/i.test(account.address);
}

export function linkedExternalEthereumWallets<T extends LinkedWalletAccount>(accounts: readonly T[]) {
  return accounts.filter((account) => isLinkedEthereumWalletAccount(account)
    && !isEmbeddedWalletClientType(account.walletClientType));
}

/**
 * A Privy linked account proves durable ownership, not live signer authority.
 * Keep a preference only when its address, EVM chain, wallet kind, and known
 * client still agree. The connected SDK wallet and exact Wagmi connector must
 * subsequently re-establish authority before a quote or wallet handoff.
 */
export function preferredWalletRemainsLinked(
  accounts: readonly LinkedWalletAccount[],
  preferredWalletKey?: string | null
) {
  const preferred = parseWalletGatewayKey(preferredWalletKey);
  if (!preferred) return false;
  return accounts.some((account) => {
    if (!isLinkedEthereumWalletAccount(account)
      || account.address!.toLowerCase() !== preferred.address
      || isEmbeddedWalletClientType(account.walletClientType) !== isEmbeddedWalletClientType(preferred.walletClientType)) {
      return false;
    }
    const linkedClient = account.walletClientType?.trim().toLowerCase();
    return !linkedClient || linkedClient === preferred.walletClientType;
  });
}

export function shouldAutomaticallyProvisionEmbeddedWallet(input: {
  authenticated: boolean;
  connectedEthereumWalletCount: number;
  linkedEthereumWalletCount: number;
  walletsReady: boolean;
}) {
  return input.authenticated
    && input.walletsReady
    && input.connectedEthereumWalletCount === 0
    && input.linkedEthereumWalletCount === 0;
}

export function bindRmtActiveSigner(input: {
  selectedWalletKey?: string | null;
  selectedWalletKind?: "embedded" | "external" | null;
  selectedSignerAuthority?: RmtActiveSignerAuthority | null;
  connectedAddress?: string;
  connectorId?: string;
  connectorType?: string;
  connectorUid?: string;
}) {
  const selected = parseWalletGatewayKey(input.selectedWalletKey);
  const authority = input.selectedSignerAuthority;
  if ((input.selectedWalletKind !== "external" && input.selectedWalletKind !== "embedded") || !selected) {
    throw new Error("Select the exact trading wallet again before opening it.");
  }
  if (isEmbeddedWalletClientType(selected.walletClientType) !== (input.selectedWalletKind === "embedded")) {
    throw new Error("The selected wallet kind no longer matches the active wallet client.");
  }
  if (!authority || authority.walletKey !== input.selectedWalletKey || authority.walletKind !== input.selectedWalletKind
    || authority.originConnectorType.trim().toLowerCase() !== selected.connectorType
    || authority.walletClientType.trim().toLowerCase() !== selected.walletClientType) {
    throw new Error("The selected signer authority no longer matches the trading wallet.");
  }
  if (!input.connectorId || !input.connectorType || !input.connectorUid) {
    throw new Error("The selected trading wallet connector identity is unavailable.");
  }
  if (authority.connectorId !== input.connectorId || authority.connectorType !== input.connectorType
    || authority.connectorUid !== input.connectorUid) {
    throw new Error("The exact active signer connector changed before wallet review.");
  }
  if (authority.adapter === "privy-wagmi-4") {
    const expectedConnectorId = privyWagmiConnectorId({
      address: selected.address,
      meta: { id: selected.reportedId },
      walletClientType: selected.walletClientType
    });
    if (!expectedConnectorId || expectedConnectorId.toLowerCase() !== input.connectorId.toLowerCase()
      || input.connectorType !== "injected") {
      throw new Error("The Privy wallet no longer matches its exact Wagmi signing connector.");
    }
  } else if (selected.reportedId !== input.connectorId.trim().toLowerCase()
    || selected.connectorType !== input.connectorType.trim().toLowerCase()) {
    throw new Error("The selected trading wallet connector no longer matches the active wallet client.");
  }
  if (!input.connectedAddress || getAddress(selected.address) !== getAddress(input.connectedAddress)) {
    throw new Error("The selected trading wallet no longer matches the connected account.");
  }
  return { address: getAddress(selected.address), authority, selected };
}

/**
 * Returns the one account whose balances RMT may present as the active account.
 * A connected Wagmi address is transport state; it is not display authority
 * until it still matches the user's exact connector-qualified wallet choice.
 */
export function selectedRmtWalletReadAddress(input: Parameters<typeof bindRmtActiveSigner>[0] & {
  connectedChainId?: number;
  requiredChainId: number;
}) {
  if (input.connectedChainId !== input.requiredChainId) return undefined;
  try {
    return bindRmtActiveSigner(input).address;
  } catch {
    return undefined;
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

/** Embedded and external EVM wallets that can be selected as an exact signer. */
export function tradingEthereumWallets<T extends WalletGatewayCandidate>(wallets: readonly T[]) {
  const seen = new Set<string>();
  return wallets.filter((wallet) => {
    if (!isTradingEthereumWallet(wallet)) return false;
    const key = walletGatewayKey(wallet);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function matchingTradingWallets<T extends WalletGatewayCandidate>(wallets: readonly T[], address?: string) {
  if (!address) return [];
  const normalizedAddress = address.toLowerCase();
  return tradingEthereumWallets(wallets).filter((wallet) => wallet.address.toLowerCase() === normalizedAddress);
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
  // An active embedded wallet is the consumer default. Merely linking an
  // external wallet must not silently replace it or force a selection prompt.
  if (params.activeEmbeddedWallet) return false;
  if (params.matchingExternalWalletCount > 0 && !params.activeExternalWalletConfirmed) return true;
  return false;
}

export function walletGatewayDisplayName(wallet: WalletGatewayCandidate) {
  if (isEmbeddedWalletClientType(wallet.walletClientType)) return "RMT wallet";
  const reportedName = wallet.meta?.name?.trim();
  if (reportedName) return reportedName;
  if (wallet.walletClientType === "wallet_connect") return "Mobile wallet";
  return wallet.walletClientType
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
