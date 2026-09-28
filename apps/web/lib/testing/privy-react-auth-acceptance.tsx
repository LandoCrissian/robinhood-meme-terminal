"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

type AcceptanceWallet = {
  address: string;
  connectorType: string;
  linked?: boolean;
  meta: { id: string; name?: string };
  type: "ethereum";
  walletClientType: string;
};

type AcceptanceState = {
  authenticated: boolean;
  identityToken?: string;
  identityTokenAfterRefresh?: string;
  ready: boolean;
  user?: { id: string; linkedAccounts: Array<Record<string, unknown>> };
  wallets: AcceptanceWallet[];
  walletsReady: boolean;
};

declare global {
  interface Window {
    __RMT_PRIVY_BRIDGE_ACCEPTANCE_STATE__?: AcceptanceState;
    __RMT_PRIVY_BRIDGE_ACCEPTANCE_LISTENERS__?: Set<() => void>;
    __RMT_PRIVY_BRIDGE_ACCEPTANCE_PROVIDERS__?: Record<string, unknown>;
    __RMT_PRIVY_BRIDGE_ACCEPTANCE_SET_STATE__?: (patch: Partial<AcceptanceState>) => void;
    __RMT_PRIVY_BRIDGE_ACCEPTANCE_EVENTS__?: string[];
  }
}

const serverState: AcceptanceState = {
  authenticated: false,
  ready: true,
  wallets: [],
  walletsReady: true
};

function currentState() {
  if (typeof window === "undefined") return serverState;
  return window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_STATE__ ?? serverState;
}

function subscribe(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_LISTENERS__ ??= new Set();
  window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_LISTENERS__.add(listener);
  return () => window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_LISTENERS__?.delete(listener);
}

function useAcceptanceState() {
  return useSyncExternalStore(subscribe, currentState, () => serverState);
}

function patchState(patch: Partial<AcceptanceState>) {
  if (typeof window === "undefined") return;
  window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_STATE__ = { ...currentState(), ...patch };
  window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_LISTENERS__?.forEach((listener) => listener());
}

function event(name: string) {
  if (typeof window === "undefined") return;
  window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_EVENTS__ ??= [];
  window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_EVENTS__.push(name);
}

export function PrivyProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_SET_STATE__ = patchState;
    return () => {
      delete window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_SET_STATE__;
    };
  }, []);
  return children;
}

export function usePrivy() {
  const state = useAcceptanceState();
  return {
    authenticated: state.authenticated,
    ready: state.ready,
    user: state.user,
    login: () => { event("LOGIN"); patchState({ authenticated: true }); },
    logout: async () => { event("LOGOUT"); patchState({ authenticated: false, user: undefined, wallets: [] }); },
    linkEmail: () => event("LINK_EMAIL"),
    linkGoogle: () => event("LINK_GOOGLE"),
    linkPasskey: () => event("LINK_PASSKEY"),
    linkPhone: () => event("LINK_PHONE"),
    linkWallet: () => event("LINK_WALLET")
  };
}

export function useWallets() {
  const state = useAcceptanceState();
  return {
    ready: state.walletsReady,
    wallets: state.wallets.map((wallet) => ({
      ...wallet,
      disconnect: async () => event(`DISCONNECT:${wallet.meta.id}`),
      getEthereumProvider: async () => {
        const provider = window.__RMT_PRIVY_BRIDGE_ACCEPTANCE_PROVIDERS__?.[wallet.meta.id];
        if (!provider) throw new Error(`Acceptance provider ${wallet.meta.id} is unavailable.`);
        return provider;
      }
    }))
  };
}

export function useIdentityToken() {
  return { identityToken: useAcceptanceState().identityToken ?? null };
}

export async function getIdentityToken() {
  return currentState().identityToken ?? null;
}

export function useUser() {
  const state = useAcceptanceState();
  return {
    user: state.user,
    refreshUser: async () => {
      event("REFRESH_USER");
      const current = currentState();
      if (current.identityTokenAfterRefresh) patchState({ identityToken: current.identityTokenAfterRefresh });
      return current.user;
    }
  };
}

export function useConnectWallet() {
  return { connectWallet: () => event("CONNECT_EXTERNAL") };
}

export function useAddFunds() {
  return { addFunds: async () => { event("ADD_FUNDS"); throw new Error("Financial actions are disabled in acceptance."); } };
}

export function useSigners() {
  return { signers: [] };
}

export type WalletListEntry = { id: string; name?: string };
