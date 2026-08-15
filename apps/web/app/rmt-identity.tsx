"use client";

import { useConnectWallet, useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { walletBrowserEnvironment, type WalletBrowserEnvironment } from "../lib/mobile-wallet-link";
import {
  RMT_ACTIVE_WALLET_SESSION_KEY,
  externalEthereumWallets,
  isEmbeddedWalletClientType,
  isConnectorSelectionConfirmed,
  matchingExternalWallets,
  resolveActiveExternalWallet,
  rmtExternalWalletOptions,
  requiresExplicitWalletSelection,
  walletGatewayDisplayName,
  walletGatewayKey
} from "../lib/wallet-gateway";

type RmtIdentityContextValue = {
  authenticated: boolean;
  activeWalletKey: string | null;
  activeWalletKind: "embedded" | "external" | null;
  activeWalletName: string | null;
  clearTradingWalletPreference: () => void;
  clearWalletConnectionError: () => void;
  connectTradingWallet: () => void;
  enabled: boolean;
  externalWalletCount: number;
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
  selectTradingWallet: (walletKey: string) => Promise<void>;
  supportsOAuth: boolean;
  userId: string;
  walletConnectionError: string;
  walletSelectionRequired: boolean;
};

const unavailableIdentity: RmtIdentityContextValue = {
  authenticated: false,
  activeWalletKey: null,
  activeWalletKind: null,
  activeWalletName: null,
  clearTradingWalletPreference: () => undefined,
  clearWalletConnectionError: () => undefined,
  connectTradingWallet: () => undefined,
  enabled: false,
  externalWalletCount: 0,
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
  selectTradingWallet: async () => undefined,
  supportsOAuth: true,
  userId: "",
  walletConnectionError: "",
  walletSelectionRequired: false
};

const RmtIdentityContext = createContext<RmtIdentityContextValue>(unavailableIdentity);

export function PrivyIdentityBridge({ children }: { children: ReactNode }) {
  const {
    authenticated,
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
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();
  const { identityToken } = useIdentityToken();
  const [preferredWalletKey, setPreferredWalletKey] = useState<string | null>(null);
  const [pendingActivationKey, setPendingActivationKey] = useState<string | null>(null);
  const [appliedWalletKey, setAppliedWalletKey] = useState<string | null>(null);
  const [walletConnectionError, setWalletConnectionError] = useState("");
  const lastAppliedWalletKey = useRef<string | null>(null);
  const [environment] = useState<WalletBrowserEnvironment>(() => {
    if (typeof window === "undefined") return "desktop";
    return walletBrowserEnvironment(window.navigator.userAgent, Boolean((window as Window & { ethereum?: unknown }).ethereum));
  });
  const supportsOAuth = environment !== "mobile-wallet-browser";

  useEffect(() => {
    setPreferredWalletKey(window.sessionStorage.getItem(RMT_ACTIVE_WALLET_SESSION_KEY));
  }, []);

  const externalWallets = useMemo(() => externalEthereumWallets(wallets), [wallets]);
  const addressMatches = useMemo(() => matchingExternalWallets(wallets, address), [address, wallets]);
  const activeExternalWallet = useMemo(
    () => resolveActiveExternalWallet(wallets, address, preferredWalletKey),
    [address, preferredWalletKey, wallets]
  );
  const embeddedAddressMatch = wallets.find((wallet) => (
    wallet.address.toLowerCase() === address?.toLowerCase()
    && isEmbeddedWalletClientType(wallet.walletClientType)
  ));
  const activeConnectorConfirmed = isConnectorSelectionConfirmed({
    appliedWalletKey,
    authenticated,
    matchingWalletCount: addressMatches.length,
    wallet: activeExternalWallet
  });
  const activeWalletKind = activeConnectorConfirmed
    ? "external"
    : addressMatches.length > 0
      ? null
      : embeddedAddressMatch
        ? "embedded"
        : null;
  const rememberTradingWallet = useCallback((walletKey: string) => {
    setPreferredWalletKey(walletKey);
    if (typeof window !== "undefined") window.sessionStorage.setItem(RMT_ACTIVE_WALLET_SESSION_KEY, walletKey);
  }, []);
  const clearTradingWalletPreference = useCallback(() => {
    lastAppliedWalletKey.current = null;
    setAppliedWalletKey(null);
    setPendingActivationKey(null);
    setPreferredWalletKey(null);
    if (typeof window !== "undefined") window.sessionStorage.removeItem(RMT_ACTIVE_WALLET_SESSION_KEY);
  }, []);
  const activateTradingWallet = useCallback(async (walletKey: string) => {
    const wallet = externalWallets.find((candidate) => walletGatewayKey(candidate) === walletKey);
    if (!wallet) throw new Error("The selected external wallet is no longer connected.");
    if (authenticated && !wallet.linked) await wallet.loginOrLink();
    await setActiveWallet(wallet);
    lastAppliedWalletKey.current = walletKey;
    setAppliedWalletKey(walletKey);
    rememberTradingWallet(walletKey);
  }, [authenticated, externalWallets, rememberTradingWallet, setActiveWallet]);
  const { connectWallet: openExternalWalletConnect } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      if (wallet.type !== "ethereum" || isEmbeddedWalletClientType(wallet.walletClientType)) {
        setWalletConnectionError("RMT trading requires an external Ethereum wallet.");
        return;
      }
      setWalletConnectionError("");
      setPendingActivationKey(walletGatewayKey(wallet));
    },
    onError: () => setWalletConnectionError("The external wallet connection did not complete.")
  });

  useEffect(() => {
    if (!pendingActivationKey) return;
    if (!externalWallets.some((wallet) => walletGatewayKey(wallet) === pendingActivationKey)) return;
    const walletKey = pendingActivationKey;
    setPendingActivationKey(null);
    void activateTradingWallet(walletKey).catch((error) => {
      setWalletConnectionError(error instanceof Error ? error.message : "The external wallet could not be activated.");
    });
  }, [activateTradingWallet, externalWallets, pendingActivationKey]);

  useEffect(() => {
    if (!preferredWalletKey || lastAppliedWalletKey.current === preferredWalletKey) return;
    const wallet = externalWallets.find((candidate) => walletGatewayKey(candidate) === preferredWalletKey);
    if (!wallet || wallet.address.toLowerCase() !== address?.toLowerCase()) return;
    if (authenticated && !wallet.linked) return;
    lastAppliedWalletKey.current = preferredWalletKey;
    void setActiveWallet(wallet)
      .then(() => setAppliedWalletKey(preferredWalletKey))
      .catch(() => {
        lastAppliedWalletKey.current = null;
        setAppliedWalletKey(null);
        setWalletConnectionError("RMT could not restore the selected wallet connector. Choose it again.");
      });
  }, [address, authenticated, externalWallets, preferredWalletKey, setActiveWallet]);

  useEffect(() => {
    if (!activeExternalWallet || addressMatches.length !== 1 || (authenticated && !activeExternalWallet.linked)) return;
    const activeKey = walletGatewayKey(activeExternalWallet);
    if (preferredWalletKey === activeKey) return;
    rememberTradingWallet(activeKey);
  }, [activeExternalWallet, addressMatches.length, authenticated, preferredWalletKey, rememberTradingWallet]);
  const linked = useMemo(() => ({
    email: Boolean(user?.linkedAccounts.some((account) => account.type === "email")),
    google: Boolean(user?.linkedAccounts.some((account) => account.type === "google_oauth")),
    passkey: Boolean(user?.linkedAccounts.some((account) => account.type === "passkey")),
    phone: Boolean(user?.linkedAccounts.some((account) => account.type === "phone")),
    wallet: Boolean(user?.linkedAccounts.some((account) => (
      account.type === "wallet" && !isEmbeddedWalletClientType(account.walletClientType)
    )))
  }), [user?.linkedAccounts]);
  const value = useMemo<RmtIdentityContextValue>(() => ({
    authenticated,
    activeWalletKey: activeConnectorConfirmed && activeExternalWallet ? walletGatewayKey(activeExternalWallet) : null,
    activeWalletKind,
    activeWalletName: activeExternalWallet ? walletGatewayDisplayName(activeExternalWallet) : null,
    clearTradingWalletPreference,
    clearWalletConnectionError: () => setWalletConnectionError(""),
    connectTradingWallet: () => {
      if (authenticated) {
        openExternalWalletConnect({
          description: "Connect the external wallet RMT should use for trading.",
          walletChainType: "ethereum-only",
          walletList: rmtExternalWalletOptions()
        });
        return;
      }
      openPrivyLogin({ loginMethods: ["wallet"], walletChainType: "ethereum-only" });
    },
    enabled: true,
    environment,
    externalWalletCount: externalWallets.length,
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
    logout: async () => {
      clearTradingWalletPreference();
      await logout();
    },
    phoneLast4: user?.linkedAccounts.find((account) => account.type === "phone")?.number.slice(-4) ?? "",
    ready,
    selectTradingWallet: activateTradingWallet,
    supportsOAuth,
    userId: user?.id ?? "",
    walletConnectionError,
    walletSelectionRequired: requiresExplicitWalletSelection({
      activeEmbeddedWallet: activeWalletKind === "embedded",
      activeExternalWalletConfirmed: activeConnectorConfirmed,
      externalWalletCount: externalWallets.length,
      hasActiveAddress: Boolean(address),
      matchingExternalWalletCount: addressMatches.length
    })
  }), [
    authenticated,
    activeExternalWallet,
    activeConnectorConfirmed,
    activeWalletKind,
    activateTradingWallet,
    address,
    addressMatches.length,
    clearTradingWalletPreference,
    environment,
    externalWallets.length,
    identityToken,
    linkEmail,
    linkGoogle,
    linkPasskey,
    linkPhone,
    linkWallet,
    linked,
    openPrivyLogin,
    openExternalWalletConnect,
    logout,
    ready,
    supportsOAuth,
    user?.id,
    walletConnectionError
  ]);

  return <RmtIdentityContext.Provider value={value}>{children}</RmtIdentityContext.Provider>;
}

export function useRmtIdentity() {
  return useContext(RmtIdentityContext);
}
