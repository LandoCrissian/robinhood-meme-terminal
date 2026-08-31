import { getAddress } from "viem";
import { parseWalletGatewayKey } from "../wallet-gateway";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./robinhood-assets";

export type VNextWalletHandoffBinding = {
  connectorId: string;
  connectorType: string;
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
    walletClientType: selected.walletClientType,
    walletName: input.selectedWalletName?.trim() || "Selected external wallet",
    wallet: getAddress(selected.address),
    chainId: ROBINHOOD_MAINNET_CHAIN_ID
  };
}

export type VNextMobileHandoffState =
  | "idle"
  | "preparing"
  | "opening"
  | "provider_pending"
  | "unresolved"
  | "hash_received";

export function vNextMobileHandoffLabel(state: VNextMobileHandoffState, walletName: string) {
  if (state === "preparing") return "Preparing verified request…";
  if (state === "opening") return `Opening ${walletName}…`;
  if (state === "provider_pending") return "Waiting for wallet review…";
  if (state === "unresolved") return "Wallet request unresolved";
  if (state === "hash_received") return "Transaction hash received · recovery active";
  return "Review verified swap in wallet";
}

export function invokeVNextExternalWalletRequest<T>(send: () => Promise<T>) {
  const pending = send();
  if (!pending || typeof pending.then !== "function") {
    throw new Error("The selected connector did not accept the transaction request.");
  }
  return pending;
}
