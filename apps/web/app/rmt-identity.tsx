"use client";

import { useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { walletBrowserEnvironment, type WalletBrowserEnvironment } from "../lib/mobile-wallet-link";

type RmtIdentityContextValue = {
  authenticated: boolean;
  activeWalletKind: "embedded" | "external" | null;
  connectTradingWallet: () => void;
  enabled: boolean;
  identityToken: string | null;
  environment: WalletBrowserEnvironment;
  linkEmail: () => void;
  linkGoogle: () => void;
  linkPasskey: () => void;
  linkPhone: () => void;
  linkWallet: () => void;
  linked: {
    email: boolean;
    google: boolean;
    passkey: boolean;
    phone: boolean;
    wallet: boolean;
  };
  login: () => void;
  logout: () => Promise<void>;
  phoneLast4: string;
  ready: boolean;
  supportsOAuth: boolean;
  userId: string;
};

const unavailableIdentity: RmtIdentityContextValue = {
  authenticated: false,
  activeWalletKind: null,
  connectTradingWallet: () => undefined,
  enabled: false,
  environment: "desktop",
  identityToken: null,
  linkEmail: () => undefined,
  linkGoogle: () => undefined,
  linkPasskey: () => undefined,
  linkPhone: () => undefined,
  linkWallet: () => undefined,
  linked: { email: false, google: false, passkey: false, phone: false, wallet: false },
  login: () => undefined,
  logout: async () => undefined,
  phoneLast4: "",
  ready: true,
  supportsOAuth: true,
  userId: ""
};

const RmtIdentityContext = createContext<RmtIdentityContextValue>(unavailableIdentity);

export function PrivyIdentityBridge({ children }: { children: ReactNode }) {
  const {
    authenticated,
    connectWallet: openPrivyWalletConnect,
    linkEmail,
    linkGoogle,
    linkPasskey,
    linkPhone,
    linkWallet,
    login: openPrivyLogin,
    logout,
    ready,
    user
  } = usePrivy();
  const { wallets } = useWallets();
  const { address } = useAccount();
  const { identityToken } = useIdentityToken();
  const [environment] = useState<WalletBrowserEnvironment>(() => {
    if (typeof window === "undefined") return "desktop";
    return walletBrowserEnvironment(window.navigator.userAgent, Boolean((window as Window & { ethereum?: unknown }).ethereum));
  });
  const supportsOAuth = environment !== "mobile-wallet-browser";
  const activeWallet = wallets.find((wallet) => wallet.address.toLowerCase() === address?.toLowerCase());
  const activeWalletKind = activeWallet
    ? activeWallet.walletClientType === "privy" ? "embedded" : "external"
    : null;
  const linked = useMemo(() => ({
    email: Boolean(user?.linkedAccounts.some((account) => account.type === "email")),
    google: Boolean(user?.linkedAccounts.some((account) => account.type === "google_oauth")),
    passkey: Boolean(user?.linkedAccounts.some((account) => account.type === "passkey")),
    phone: Boolean(user?.linkedAccounts.some((account) => account.type === "phone")),
    wallet: Boolean(user?.linkedAccounts.some((account) => (
      account.type === "wallet" && account.walletClientType !== "privy"
    )))
  }), [user?.linkedAccounts]);
  const value = useMemo<RmtIdentityContextValue>(() => ({
    authenticated,
    activeWalletKind,
    connectTradingWallet: () => {
      if (authenticated) {
        openPrivyWalletConnect({
          description: "Connect the external wallet RMT should use for trading.",
          walletChainType: "ethereum-only",
          walletList: ["metamask", "coinbase_wallet", "detected_ethereum_wallets", "wallet_connect"]
        });
        return;
      }
      openPrivyLogin({ loginMethods: ["wallet"], walletChainType: "ethereum-only" });
    },
    enabled: true,
    environment,
    identityToken: identityToken ?? null,
    linkEmail,
    linkGoogle: () => {
      if (supportsOAuth) linkGoogle();
    },
    linkPasskey,
    linkPhone,
    linkWallet: () => linkWallet({ walletChainType: "ethereum-only" }),
    linked,
    login: () => openPrivyLogin({
      loginMethods: supportsOAuth ? ["email", "google", "passkey", "wallet"] : ["wallet"],
      walletChainType: "ethereum-only"
    }),
    logout,
    phoneLast4: user?.linkedAccounts.find((account) => account.type === "phone")?.number.slice(-4) ?? "",
    ready,
    supportsOAuth,
    userId: user?.id ?? ""
  }), [
    authenticated,
    activeWalletKind,
    environment,
    identityToken,
    linkEmail,
    linkGoogle,
    linkPasskey,
    linkPhone,
    linkWallet,
    linked,
    openPrivyLogin,
    openPrivyWalletConnect,
    logout,
    ready,
    supportsOAuth,
    user?.id
  ]);

  return <RmtIdentityContext.Provider value={value}>{children}</RmtIdentityContext.Provider>;
}

export function useRmtIdentity() {
  return useContext(RmtIdentityContext);
}
