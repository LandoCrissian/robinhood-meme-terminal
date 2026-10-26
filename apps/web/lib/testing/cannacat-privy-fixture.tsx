// Build-time alias in the disposable browser fixture only. Never a runtime flag.
import React, { useSyncExternalStore, type ReactNode } from "react";
type State = { connected: boolean; authenticated: boolean; chainId: string };
const initial: State = { connected: false, authenticated: false, chainId: "eip155:1" };
let state = initial;
const listeners = new Set<() => void>();
const providerListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const address = "0x0000000000000000000000000000000000000123";
declare global { interface Window { __CANNACAT_FIXTURE_WALLET_REQUESTS__?: unknown[]; } }
function patch(next: Partial<State>) {
  state = { ...state, ...next }; listeners.forEach((listener) => listener());
}
function useState() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state, () => initial); }
const provider = {
  request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_accounts") return [address];
    if (method === "eth_chainId") return state.chainId === "eip155:4663" ? "0x1237" : "0x1";
    if (method === "eth_sendTransaction") {
      (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ??= []).push(params);
      throw { code: 4001, message: "Synthetic wallet rejection" };
    }
    throw new Error(`Unsupported fixture wallet method: ${method}`);
  },
  on: (name: string, listener: (...args: unknown[]) => void) => { const set = providerListeners.get(name) ?? new Set(); set.add(listener); providerListeners.set(name, set); },
  removeListener: (name: string, listener: (...args: unknown[]) => void) => { providerListeners.get(name)?.delete(listener); }
};
function wallet() {
  return { address, chainId: state.chainId, type: "ethereum" as const, connectorType: "injected", walletClientType: "metamask", linked: state.authenticated,
    meta: { id: "synthetic-wallet", name: "Test wallet" }, getEthereumProvider: async () => provider,
    loginOrLink: async () => { patch({ authenticated: true }); },
    switchChain: async () => { patch({ chainId: "eip155:4663" }); providerListeners.get("chainChanged")?.forEach((listener) => listener("0x1237")); }
  };
}
export function PrivyProvider({ children }: { children: ReactNode }) { return <>{children}</>; }
export function usePrivy() { const current = useState(); return { ready: true, authenticated: current.authenticated,
  user: current.authenticated ? { id: "synthetic-user" } : undefined, logout: async () => patch({ connected: false, authenticated: false }) }; }
export function useWallets() { const current = useState(); return { ready: true, wallets: current.connected ? [wallet()] : [] }; }
export function useIdentityToken() { const current = useState(); return { identityToken: current.authenticated ? "synthetic-identity-only" : null }; }
export function useConnectWallet(options: { onSuccess: (result: { wallet: ReturnType<typeof wallet> }) => void }) {
  return { connectWallet: () => { patch({ connected: true }); options.onSuccess({ wallet: wallet() }); } };
}
