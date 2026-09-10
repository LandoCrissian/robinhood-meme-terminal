"use client";

import { useConnectWallet, useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { activateSelectedWallet, idleWalletConnection, WalletConnectionController, type WalletConnectionSnapshot } from "../lib/wallet-connection-controller";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { injectedSignerSelection, startInjectedSignerDiscovery } from "../lib/injected-wallet-signer";
import { useAccount, useConnect, useConfig, useSwitchAccount } from "wagmi";
import { walletBrowserEnvironment, type WalletBrowserEnvironment } from "../lib/mobile-wallet-link";
import {
  RMT_ACTIVE_WALLET_SESSION_KEY,
  externalEthereumWallets,
  isEmbeddedWalletClientType,
  isConnectorSelectionConfirmed,
  matchingExternalWallets,
  resolveActiveExternalWallet,
  rmtExternalWalletOptions,
  rmtInjectedWalletOptions,
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
  walletConnection: WalletConnectionSnapshot;
  retryWalletConnection: () => void;
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
  walletConnection: idleWalletConnection,
  retryWalletConnection: () => undefined,
  walletConnectionError: "",
  walletSelectionRequired: false
};

const RmtIdentityContext = createContext<RmtIdentityContextValue>(unavailableIdentity);

function isLoopbackAcceptanceHost() {
  return typeof window !== "undefined"
    && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
}

export function BrowserAcceptanceIdentityBridge({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const acceptanceEnabled = process.env.NEXT_PUBLIC_RMT_BROWSER_ACCEPTANCE_PROFILE === "true" && isLoopbackAcceptanceHost();
  const connector = connectors.find((candidate) => candidate.id === "rmt-walletconnect-fixture")
    ?? connectors.find((candidate) => candidate.id === "injected" || candidate.type === "injected");
  const connectTradingWallet = useCallback(() => {
    if (acceptanceEnabled && connector) connect({ connector, chainId: 4_663 });
  }, [acceptanceEnabled, connect, connector]);

  useEffect(() => {
    if (acceptanceEnabled && !isConnected && connector) connect({ connector, chainId: 4_663 });
  }, [acceptanceEnabled, connect, connector, isConnected]);

  const value = useMemo<RmtIdentityContextValue>(() => acceptanceEnabled ? {
    authenticated: isConnected,
    activeWalletKey: isConnected && address && connector ? walletGatewayKey({
      address,
      connectorType: connector.type,
      walletClientType: "browser-acceptance",
      meta: { id: connector.id, name: "Deterministic browser wallet" },
      type: "ethereum"
    }) : null,
    activeWalletKind: isConnected ? "external" : null,
    activeWalletName: isConnected ? "Deterministic browser wallet" : null,
    clearTradingWalletPreference: () => undefined,
    clearWalletConnectionError: () => undefined,
    connectTradingWallet,
    enabled: true,
    environment: "desktop",
    externalWalletCount: 1,
    identityToken: isConnected ? "deterministic-browser-acceptance-token" : null,
    linkEmail: () => undefined,
    linkGoogle: () => undefined,
    linkPasskey: () => undefined,
    linkPhone: () => undefined,
    linkWallet: connectTradingWallet,
    linked: { email: false, google: false, passkey: false, phone: false, wallet: isConnected },
    login: connectTradingWallet,
    logout: async () => undefined,
    phoneLast4: "",
    ready: true,
    selectTradingWallet: async () => connectTradingWallet(),
    supportsOAuth: false,
    userId: isConnected && address ? `browser-acceptance:${address.toLowerCase()}` : "",
    walletConnection: idleWalletConnection,
    retryWalletConnection: connectTradingWallet,
    walletConnectionError: "",
    walletSelectionRequired: false
  } : unavailableIdentity, [acceptanceEnabled, address, connectTradingWallet, connector, isConnected]);

  useLayoutEffect(() => {
    if (!acceptanceEnabled) return;
    injectedSignerSelection.setIdentity({ authenticated: value.authenticated, userId: value.userId,
      linkedAddress: value.authenticated ? address : undefined, activeWalletKey: value.activeWalletKey,
      address, chainId: isConnected ? 4663 : undefined });
  }, [acceptanceEnabled, value.authenticated, value.userId, value.activeWalletKey, address, isConnected]);
  useEffect(() => {
    if (!acceptanceEnabled) return;
    startInjectedSignerDiscovery();
    return () => injectedSignerSelection.setIdentity({ authenticated: false, userId: "", activeWalletKey: null });
  }, [acceptanceEnabled]);

  return <RmtIdentityContext.Provider value={value}>{children}</RmtIdentityContext.Provider>;
}

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
  const config = useConfig();
  const { connectAsync } = useConnect();
  const { switchAccountAsync } = useSwitchAccount();
  const { address, chainId, connector } = useAccount();
  const [connectionController] = useState(() => new WalletConnectionController());
  const walletConnection = useSyncExternalStore(connectionController.subscribe, connectionController.getSnapshot, () => idleWalletConnection);
  const { identityToken } = useIdentityToken();
  const [preferredWalletKey, setPreferredWalletKey] = useState<string | null>(null);
  const [appliedWalletKey, setAppliedWalletKey] = useState<string | null>(null);
  const [walletConnectionError, setWalletConnectionError] = useState("");
  const restored = useRef(false);
  const currentIdentity = useRef({ wallets, authenticated, userId: user?.id });
  useLayoutEffect(() => { currentIdentity.current = { wallets, authenticated, userId: user?.id }; }, [wallets, authenticated, user?.id]);
  useEffect(() => () => connectionController.dispose(), [connectionController]);
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
  const activeConnectorConfirmed = walletConnection.state === "CONNECTED"
    && walletConnection.connectorUid === connector?.uid
    && walletConnection.walletKey === appliedWalletKey
    && walletConnection.walletKey === (activeExternalWallet ? walletGatewayKey(activeExternalWallet) : null)
    && isConnectorSelectionConfirmed({
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
  const linkedSignerAddress = authenticated && activeExternalWallet?.linked
    && user?.linkedAccounts.some((account) => account.type === "wallet"
      && !isEmbeddedWalletClientType(account.walletClientType)
      && account.address.toLowerCase() === activeExternalWallet.address.toLowerCase())
    ? activeExternalWallet.address : undefined;
  const signerWalletKey = activeConnectorConfirmed && activeExternalWallet ? walletGatewayKey(activeExternalWallet) : null;
  useLayoutEffect(() => {
    injectedSignerSelection.setIdentity({ authenticated, userId: user?.id ?? "", linkedAddress: linkedSignerAddress,
      activeWalletKey: signerWalletKey, address, chainId });
  }, [authenticated, user?.id, linkedSignerAddress, signerWalletKey, address, chainId]);
  useEffect(() => {
    startInjectedSignerDiscovery();
    return () => injectedSignerSelection.setIdentity({ authenticated: false, userId: "", activeWalletKey: null });
  }, []);
  const rememberTradingWallet = useCallback((walletKey: string) => {
    setPreferredWalletKey(walletKey);
    if (typeof window !== "undefined") window.sessionStorage.setItem(RMT_ACTIVE_WALLET_SESSION_KEY, walletKey);
  }, []);
  const clearTradingWalletPreference = useCallback(() => {
    connectionController.cancel();
    injectedSignerSelection.invalidate();
    restored.current = true;
    setAppliedWalletKey(null);
    setPreferredWalletKey(null);
    window.sessionStorage.removeItem(RMT_ACTIVE_WALLET_SESSION_KEY);
  }, [connectionController]);
  // Privy's connectWallet events are global {wallet} notifications without attempt IDs.
  // They are discovery only: no callback may select, authenticate, or activate a wallet.
  const { connectWallet: openExternalWalletConnect } = useConnectWallet();
  const connectTradingWallet = useCallback(() => {
    restored.current = true;
    injectedSignerSelection.invalidate();
    setAppliedWalletKey(null);
    setWalletConnectionError("");
    connectionController.begin();
    try {
      openExternalWalletConnect({
        description: "Connect a wallet, then explicitly choose it in RMT.",
        walletChainType: "ethereum-only",
        walletList: environment === "mobile-wallet-browser" ? rmtInjectedWalletOptions() : rmtExternalWalletOptions()
      });
    } catch { connectionController.fail(); }
  }, [connectionController, environment, openExternalWalletConnect]);
  const activateTradingWallet = useCallback(async (walletKey: string) => {
    restored.current = true;
    injectedSignerSelection.invalidate();
    setAppliedWalletKey(null);
    setWalletConnectionError("");
    // Do not deduplicate here: indistinguishable SDK bindings must fail closed.
    const matches = currentIdentity.current.wallets.filter(candidate => candidate.type === "ethereum"
      && !isEmbeddedWalletClientType(candidate.walletClientType) && walletGatewayKey(candidate) === walletKey);
    if (matches.length !== 1) { connectionController.begin(walletKey); connectionController.fail("Wallet binding is ambiguous or unavailable. Choose another wallet."); return; }
    const wallet = matches[0];
    const startingUser = currentIdentity.current.userId;
    let activatedUid: string | null = null;
    await connectionController.select(walletKey, scope => activateSelectedWallet(scope, wallet, {
      stillSelected: () => {
        const current = currentIdentity.current;
        return (!startingUser || current.userId === startingUser) && (!activatedUid || config.state.current === activatedUid) && current.wallets.filter(candidate => walletGatewayKey(candidate) === walletKey).length === 1;
      },
      currentProvider: () => {
        const matches = currentIdentity.current.wallets.filter(candidate => walletGatewayKey(candidate) === walletKey);
        if (matches.length !== 1) throw new Error("Wallet binding changed.");
        return matches[0].getEthereumProvider();
      },
      needsLogin: () => !currentIdentity.current.authenticated || !wallet.linked,
      activate: async (provider, check) => {
        // @privy-io/wagmi 4.0.15 setActiveWallet dispatches void mutations.
        // Await the real Wagmi mutation instead, with independently checked provider identity.
        const candidates = config.connectors.filter(candidate => candidate.id === wallet.meta.id);
        if (candidates.length !== 1) throw new Error("Connector binding is ambiguous.");
        const selected = candidates[0];
        check();
        const connectorProvider = await selected.getProvider();
        check();
        if (connectorProvider !== provider) throw new Error("Connector provider does not match selected wallet.");
        await config.storage?.removeItem(`${selected.id}.disconnected`);
        check();
        if (config.state.connections.has(selected.uid)) await switchAccountAsync({ connector: selected });
        else await connectAsync({ connector: selected });
        check();
        if (config.state.current !== selected.uid || !config.state.connections.get(selected.uid)?.accounts.some(account => account.toLowerCase() === wallet.address.toLowerCase())) {
          throw new Error("Active connector does not match selected wallet.");
        }
        activatedUid = selected.uid;
        return selected.uid;
      }
    }), () => {
      if (!activatedUid || config.state.current !== activatedUid) throw new Error("Active connector changed before commit.");
      setAppliedWalletKey(walletKey);
      rememberTradingWallet(walletKey);
    });
  }, [connectionController, config, connectAsync, switchAccountAsync, rememberTradingWallet]);

  useEffect(() => {
    if (restored.current || !preferredWalletKey || connectionController.getSnapshot().state !== "IDLE") return;
    if (!externalWallets.some(wallet => walletGatewayKey(wallet) === preferredWalletKey)) return;
    // Restore uses the same bounded, independently validated path as an explicit choice.
    void activateTradingWallet(preferredWalletKey);
  }, [activateTradingWallet, connectionController, externalWallets, preferredWalletKey]);
  const previousUser = useRef(user?.id);
  useLayoutEffect(() => {
    if (previousUser.current && previousUser.current !== user?.id) clearTradingWalletPreference();
    previousUser.current = user?.id;
  }, [user?.id, clearTradingWalletPreference]);
  useLayoutEffect(() => {
    if (walletConnection.state !== "CONNECTED" || activeConnectorConfirmed) return;
    injectedSignerSelection.invalidate();
    connectionController.fail("The active wallet changed. Choose your wallet again.");
  }, [activeConnectorConfirmed, connectionController, walletConnection.state]);
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
    connectTradingWallet,
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
    walletConnection,
    retryWalletConnection: () => {
      if (walletConnection.walletKey) void activateTradingWallet(walletConnection.walletKey);
      else connectTradingWallet();
    },
    walletConnectionError: walletConnection.error || walletConnectionError,
    walletSelectionRequired: walletConnection.state !== "CONNECTED" && externalWallets.length > 0 || requiresExplicitWalletSelection({
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
    connectTradingWallet,
    walletConnection,
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
