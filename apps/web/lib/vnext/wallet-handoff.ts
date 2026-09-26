import { getAddress } from "viem";
import { bindRmtActiveSigner, type RmtActiveSignerAuthority } from "../wallet-gateway";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./robinhood-assets";

export type { RmtActiveSignerAuthority } from "../wallet-gateway";

export type VNextWalletHandoffBinding = {
  adapter: RmtActiveSignerAuthority["adapter"];
  connectorId: string;
  connectorType: string;
  connectorUid: string;
  originConnectorType: string;
  selectedConnectorType: string;
  walletClientType: string;
  walletKind: "embedded" | "external";
  walletName: string;
  wallet: `0x${string}`;
  chainId: 4_663;
};

export type VNextWalletHandoffBindingInput = {
  selectedWalletKey?: string | null;
  selectedWalletKind?: "embedded" | "external" | null;
  selectedWalletName?: string | null;
  selectedSignerAuthority?: RmtActiveSignerAuthority | null;
  connectedAddress?: string;
  connectedChainId?: number;
  connectorId?: string;
  connectorType?: string;
  connectorUid?: string;
  walletClientAddress?: string;
  walletClientChainId?: number;
  recipient?: string;
};

function sameAddress(left?: string, right?: string) {
  if (!left || !right) return false;
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

/**
 * Proves that the Privy-selected embedded or external wallet is the exact Wagmi/Viem
 * connector client that will receive the transaction request. This is a
 * fail-closed binding check; it never guesses by wallet label or address alone.
 */
export function bindVNextTradingWallet(input: VNextWalletHandoffBindingInput): VNextWalletHandoffBinding {
  const { address: selectedAddress, authority, selected } = bindRmtActiveSigner(input);
  if (!sameAddress(selectedAddress, input.walletClientAddress)
    || !sameAddress(selectedAddress, input.recipient)) {
    throw new Error("The selected trading wallet, active account, wallet client, and recipient do not match.");
  }
  if (input.connectedChainId !== ROBINHOOD_MAINNET_CHAIN_ID || input.walletClientChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
    throw new Error("The selected trading wallet client is not on Robinhood Chain 4663.");
  }
  return {
    adapter: authority.adapter,
    connectorId: authority.connectorId,
    connectorType: authority.connectorType,
    connectorUid: authority.connectorUid,
    originConnectorType: authority.originConnectorType,
    selectedConnectorType: selected.connectorType,
    walletClientType: selected.walletClientType,
    walletKind: authority.walletKind,
    walletName: input.selectedWalletName?.trim() || (input.selectedWalletKind === "embedded" ? "RMT wallet" : "Selected external wallet"),
    wallet: selectedAddress,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID
  };
}

/** @deprecated Use the wallet-kind-aware binding. Kept for durable imports. */
export const bindVNextExternalWallet = bindVNextTradingWallet;

/**
 * Privy's embedded EVM wallet is implemented as a Wagmi `injected` connector,
 * but it is already exact and connector-qualified through Privy. EIP-6963
 * provider selection is required only for a user-selected external injected
 * wallet, never merely because the connector's transport type is `injected`.
 */
export function requiresVNextInjectedSignerSelection(
  provider: string,
  binding: Pick<VNextWalletHandoffBinding, "adapter" | "originConnectorType" | "walletKind">
) {
  return provider === "zero-x-swap"
    && binding.adapter === "direct"
    && binding.walletKind === "external"
    && binding.originConnectorType.trim().toLowerCase() === "injected";
}

export type VNextMobileHandoffState =
  | "idle"
  | "preparing"
  | "ready_to_open"
  | "opening"
  | "provider_pending"
  | "unresolved"
  | "hash_received";

export function vNextMobileHandoffLabel(state: VNextMobileHandoffState, walletName: string) {
  if (state === "preparing") return "Preparing verified request…";
  if (state === "ready_to_open") return `Open ${walletName} & review`;
  if (state === "opening") return `Opening ${walletName}…`;
  if (state === "provider_pending") return `Transaction request sent to ${walletName}`;
  if (state === "unresolved") return "Wallet request unresolved";
  if (state === "hash_received") return "Transaction hash received · recovery active";
  return "Review verified swap in wallet";
}

type UnknownRecord = Record<string, unknown>;

export type VNextWalletTransport = {
  kind: "walletconnect" | "injected" | "unknown";
  sessionPeerBound: boolean;
  peerWalletName: string | null;
  safeMobileOpenUri: string | null;
  mobileOpenSource: "session_peer_redirect_native" | "session_peer_redirect_universal" | "none";
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function safeSessionRedirect(value: unknown) {
  if (typeof value !== "string" || value.length < 4 || value.length > 2_048 || /[\u0000-\u001f\s]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (["javascript:", "data:", "file:"].includes(parsed.protocol)) return null;
    return value;
  } catch {
    return null;
  }
}

/** Reads only non-secret peer metadata from the exact connector provider. */
export function inspectVNextWalletTransport(provider: unknown, connectorType?: string): VNextWalletTransport {
  const root = record(provider);
  const metadata = record(record(record(root?.session)?.peer)?.metadata);
  const redirect = record(metadata?.redirect);
  const native = safeSessionRedirect(redirect?.native);
  const universal = safeSessionRedirect(redirect?.universal);
  const peerWalletName = typeof metadata?.name === "string" && /^[\x20-\x7e]{1,80}$/.test(metadata.name)
    ? metadata.name : null;
  const walletConnect = Boolean(root?.isWalletConnect) || Boolean(metadata)
    || /wallet[_ -]?connect/i.test(connectorType ?? "");
  if (walletConnect) return {
    kind: "walletconnect",
    sessionPeerBound: Boolean(metadata),
    peerWalletName,
    safeMobileOpenUri: native ?? universal,
    mobileOpenSource: native
      ? "session_peer_redirect_native"
      : universal ? "session_peer_redirect_universal" : "none"
  };
  if (/injected/i.test(connectorType ?? "") || typeof root?.request === "function") return {
    kind: "injected",
    sessionPeerBound: false,
    peerWalletName: null,
    safeMobileOpenUri: null,
    mobileOpenSource: "none"
  };
  return {
    kind: "unknown",
    sessionPeerBound: false,
    peerWalletName: null,
    safeMobileOpenUri: null,
    mobileOpenSource: "none"
  };
}

export function isVNextMobileBrowser(userAgent: string) {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);
}

export function openVNextSelectedWallet(uri: string, navigate: (target: string) => void) {
  const safe = safeSessionRedirect(uri);
  if (!safe) return false;
  navigate(safe);
  return true;
}

export function emitVNextWalletHandoffDiagnostic(input: {
  event: string;
  connectorId?: string;
  connectorType?: string;
  walletClientType?: string;
  selectedWalletName?: string;
  chainId?: number;
  redirectCapable?: boolean;
  lifecycleState?: VNextMobileHandoffState | "PROMPT_REQUESTED" | "USER_REJECTED";
  requestId?: string;
}) {
  if (typeof console === "undefined") return;
  console.info("[RMT wallet handoff]", { ...input, timestampMs: Date.now() });
}

export function invokeVNextExternalWalletRequest<T>(send: () => Promise<T>) {
  const pending = send();
  if (!pending || typeof pending.then !== "function") {
    throw new Error("The selected connector did not accept the transaction request.");
  }
  return pending;
}
