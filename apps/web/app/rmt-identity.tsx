"use client";

import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { createContext, useContext, useMemo, type ReactNode } from "react";

type RmtIdentityContextValue = {
  authenticated: boolean;
  enabled: boolean;
  identityToken: string | null;
  linkEmail: () => void;
  linkGoogle: () => void;
  linkPasskey: () => void;
  linkWallet: () => void;
  linked: {
    email: boolean;
    google: boolean;
    passkey: boolean;
    wallet: boolean;
  };
  login: () => void;
  logout: () => Promise<void>;
  ready: boolean;
  userId: string;
};

const unavailableIdentity: RmtIdentityContextValue = {
  authenticated: false,
  enabled: false,
  identityToken: null,
  linkEmail: () => undefined,
  linkGoogle: () => undefined,
  linkPasskey: () => undefined,
  linkWallet: () => undefined,
  linked: { email: false, google: false, passkey: false, wallet: false },
  login: () => undefined,
  logout: async () => undefined,
  ready: true,
  userId: ""
};

const RmtIdentityContext = createContext<RmtIdentityContextValue>(unavailableIdentity);

export function PrivyIdentityBridge({ children }: { children: ReactNode }) {
  const {
    authenticated,
    linkEmail,
    linkGoogle,
    linkPasskey,
    linkWallet,
    login,
    logout,
    ready,
    user
  } = usePrivy();
  const { identityToken } = useIdentityToken();
  const linked = useMemo(() => ({
    email: Boolean(user?.linkedAccounts.some((account) => account.type === "email")),
    google: Boolean(user?.linkedAccounts.some((account) => account.type === "google_oauth")),
    passkey: Boolean(user?.linkedAccounts.some((account) => account.type === "passkey")),
    wallet: Boolean(user?.linkedAccounts.some((account) => (
      account.type === "wallet" && account.walletClientType !== "privy"
    )))
  }), [user?.linkedAccounts]);
  const value = useMemo<RmtIdentityContextValue>(() => ({
    authenticated,
    enabled: true,
    identityToken: identityToken ?? null,
    linkEmail,
    linkGoogle,
    linkPasskey,
    linkWallet: () => linkWallet({ walletChainType: "ethereum-only" }),
    linked,
    login,
    logout,
    ready,
    userId: user?.id ?? ""
  }), [
    authenticated,
    identityToken,
    linkEmail,
    linkGoogle,
    linkPasskey,
    linkWallet,
    linked,
    login,
    logout,
    ready,
    user?.id
  ]);

  return <RmtIdentityContext.Provider value={value}>{children}</RmtIdentityContext.Provider>;
}

export function useRmtIdentity() {
  return useContext(RmtIdentityContext);
}
