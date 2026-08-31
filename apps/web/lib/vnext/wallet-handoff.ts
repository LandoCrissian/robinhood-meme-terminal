import { getAddress } from "viem";
import { parseWalletGatewayKey } from "../wallet-gateway";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./robinhood-assets";

export type VNextWalletHandoffBinding = {
  connectorId: string;
  connectorType: string;
  selectedConnectorType: string;
  walletClientType: string;
  walletName: string;
  wallet: `0x${string}`;
  chainId: 4_663;
};

export type VNextWalletHandoffBindingInput = {
  selectedWalletKey?: string | null;
  selectedWalletKind?: "embedded" | "external" | null;
  selectedWalletName?: string | null;
  connectedAddress?: string;
  connectedChainId?: number;
  connectorId?: string;
  connectorType?: string;
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
 * Proves that the Privy-selected external wallet is the exact Wagmi/Viem
 * connector client that will receive the transaction request. This is a
 * fail-closed binding check; it never guesses by wallet label or address alone.
 */
export function bindVNextExternalWallet(input: VNextWalletHandoffBindingInput): VNextWalletHandoffBinding {
  const selected = parseWalletGatewayKey(input.selectedWalletKey);
  if (input.selectedWalletKind !== "external" || !selected) {
    throw new Error("Select the exact external trading wallet again before opening it.");
  }
  if (!input.connectorId || selected.reportedId !== input.connectorId.trim().toLowerCase()) {
    throw new Error("The selected external wallet connector no longer matches the active wallet client.");
  }
  if (!input.connectorType) {
    throw new Error("The selected external wallet connector type is unavailable.");
  }
  if (!sameAddress(selected.address, input.connectedAddress)
    || !sameAddress(selected.address, input.walletClientAddress)
    || !sameAddress(selected.address, input.recipient)) {
    throw new Error("The selected external wallet, active account, wallet client, and recipient do not match.");
  }
  if (input.connectedChainId !== ROBINHOOD_MAINNET_CHAIN_ID || input.walletClientChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
    throw new Error("The selected external wallet client is not on Robinhood Chain 4663.");
  }
  return {
    connectorId: input.connectorId,
    connectorType: input.connectorType,
    selectedConnectorType: selected.connectorType,
    walletClientType: selected.walletClientType,
    walletName: input.selectedWalletName?.trim() || "Selected external wallet",
    wallet: getAddress(selected.address),
    chainId: ROBINHOOD_MAINNET_CHAIN_ID
  };
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
