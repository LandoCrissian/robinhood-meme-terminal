// Build-time alias in the disposable browser fixture only. Never a runtime flag.
import React, { useEffect, useSyncExternalStore, type ReactNode } from "react";
type State = { connected: boolean; authenticated: boolean; chainId: string; providerChainId: string;
  accounts: string[]; walletCount: number; walletClientType: string; connectorType: string; providerAvailable: boolean; displayName?: string; address?: string };
const initial: State = { connected: false, authenticated: false, chainId: "eip155:1", providerChainId: "0x1",
  accounts: ["0x0000000000000000000000000000000000000123"], walletCount: 1, walletClientType: "metamask", connectorType: "injected", providerAvailable: true };
let state = initial;
let loginPending = false;
const listeners = new Set<() => void>();
const providerListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const address = "0x0000000000000000000000000000000000000123";
declare global { interface Window {
  __CANNACAT_FIXTURE_WALLET_REQUESTS__?: unknown[]; __CANNACAT_FIXTURE_SYNC_REJECT__?: boolean;
  __CANNACAT_FIXTURE_WALLET_MODE__?: 'reject' | 'hash' | 'wait';
  __CANNACAT_FIXTURE_TX_HASH__?: string;
  __CANNACAT_FIXTURE_RESOLVE_WALLET__?: () => void;
  __CANNACAT_FIXTURE_ATTACH_SECOND__?: boolean;
  __CANNACAT_FIXTURE_CHAIN_SWITCHES__?: number; __CANNACAT_FIXTURE_AUTH_REQUESTS__?: number;
  __CANNACAT_FIXTURE_LOGIN_REQUESTS__?: number;
  __CANNACAT_FIXTURE_UPDATE__?: (next: Partial<State>, event?: "chainChanged" | "accountsChanged" | "disconnect") => void;
} }
function patch(next: Partial<State>) {
  state = { ...state, ...next }; listeners.forEach((listener) => listener());
}
function useState() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state, () => initial); }
const provider = {
  request: ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_accounts") return Promise.resolve(state.accounts);
    if (method === "eth_chainId") return Promise.resolve(state.providerChainId);
    if (method === "eth_sendTransaction") {
      (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ??= []).push(params);
      const rejection = { code: 4001, message: "Synthetic wallet rejection" };
      if (window.__CANNACAT_FIXTURE_WALLET_MODE__ === 'hash') return Promise.resolve(window.__CANNACAT_FIXTURE_TX_HASH__);
      if (window.__CANNACAT_FIXTURE_WALLET_MODE__ === 'wait') return new Promise(resolve => {
        window.__CANNACAT_FIXTURE_RESOLVE_WALLET__ = () => resolve(window.__CANNACAT_FIXTURE_TX_HASH__);
      });
      if (window.__CANNACAT_FIXTURE_SYNC_REJECT__) throw rejection;
      return Promise.reject(rejection);
    }
    throw new Error(`Unsupported fixture wallet method: ${method}`);
  },
  on: (name: string, listener: (...args: unknown[]) => void) => { const set = providerListeners.get(name) ?? new Set(); set.add(listener); providerListeners.set(name, set); },
  removeListener: (name: string, listener: (...args: unknown[]) => void) => { providerListeners.get(name)?.delete(listener); }
};
function wallet() {
  return { address: state.address ?? address, chainId: state.chainId, type: "ethereum" as const, connectorType: state.connectorType, walletClientType: state.walletClientType, linked: state.authenticated,
    meta: { id: `synthetic-${state.walletClientType}`, name: state.displayName || `Test ${state.walletClientType}` }, getEthereumProvider: async () => state.providerAvailable ? provider : null,
    loginOrLink: async () => { window.__CANNACAT_FIXTURE_AUTH_REQUESTS__ = (window.__CANNACAT_FIXTURE_AUTH_REQUESTS__ ?? 0) + 1; patch({ authenticated: true }); },
    switchChain: async () => { window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__ = (window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__ ?? 0) + 1;
      patch({ chainId: "eip155:4663", providerChainId: "0x1237" }); providerListeners.get("chainChanged")?.forEach((listener) => listener("0x1237")); }
  };
}
export function PrivyProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.__CANNACAT_FIXTURE_UPDATE__ = (next, event) => { patch(next); if (event) providerListeners.get(event)?.forEach(listener => listener()); };
    return () => { delete window.__CANNACAT_FIXTURE_UPDATE__; };
  }, []);
  return <>{children}</>;
}
export function usePrivy() { const current = useState(); return { ready: true, authenticated: current.authenticated,
  user: current.authenticated ? { id: "synthetic-user" } : undefined, logout: async () => patch({ connected: false, authenticated: false }) }; }
export function useWallets() { const current = useState(); const primary = wallet(); return { ready: true,
  wallets: current.connected ? (current.walletCount > 1 ? [primary, { ...primary, walletClientType: "rabby", meta: { id: "synthetic-second", name: "Test second wallet" } }] : [primary]) : [] }; }
export function useIdentityToken() { const current = useState(); return { identityToken: current.authenticated ? "synthetic-identity-only" : null }; }
export function useLogin(options?: { onComplete?: () => void; onError?: () => void }) {
  const current = useState();
  useEffect(() => {
    if (loginPending && current.authenticated) { loginPending = false; options?.onComplete?.(); }
  }, [current.authenticated]);
  return { login: () => {
    window.__CANNACAT_FIXTURE_LOGIN_REQUESTS__ = (window.__CANNACAT_FIXTURE_LOGIN_REQUESTS__ ?? 0) + 1;
    loginPending = true; patch({ connected: true, providerAvailable: true });
    // The disposable browser test completes the authentication return explicitly.
    // Connection alone must not be treated as signed authentication.
  } };
}
export function useConnectWallet(options?: { onSuccess?: (result: { wallet: ReturnType<typeof wallet> }) => void }) {
  return { connectWallet: () => {
    if (window.__CANNACAT_FIXTURE_ATTACH_SECOND__) {
      patch({ connected: true, providerAvailable: true, walletCount: 2 });
      options?.onSuccess?.({ wallet: { ...wallet(), walletClientType: 'rabby', meta: { id: 'synthetic-second', name: 'Test second wallet' } } }); return;
    }
    patch({ connected: true, providerAvailable: true }); options?.onSuccess?.({ wallet: wallet() });
  } };
}

