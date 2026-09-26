"use client";

import { useConnectWallet, useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { activateSelectedWallet, idleWalletConnection, WalletConnectionController, type WalletConnectionSnapshot } from "../lib/wallet-connection-controller";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { injectedSignerSelection, startInjectedSignerDiscovery } from "../lib/injected-wallet-signer";
import { useAccount, useConnect, useConfig, useDisconnect, useReconnect, useSwitchAccount, useSwitchChain } from "wagmi";
import { walletBrowserEnvironment, type WalletBrowserEnvironment } from "../lib/mobile-wallet-link";
import { accountFirstBrowserAcceptanceEnabled } from "../lib/account-first-browser-acceptance";
import { canPublishEmbeddedWalletAuthority, embeddedWalletRecordRecovery, resolveAutomaticEmbeddedWalletCandidate, resolveConfirmedEmbeddedWalletKey, resolveExactEmbeddedWalletCandidate, waitForEmbeddedWalletActivation, waitForEmbeddedWalletRecord, waitForExactWalletConnector } from "../lib/embedded-wallet-activation";
import {
  RMT_ACTIVE_WALLET_SESSION_KEY,
  externalEthereumWallets,
  isEmbeddedWalletClientType,
  isConnectorSelectionConfirmed,
  linkedExternalEthereumWallets,
  preferredWalletRemainsLinked,
  privyWagmiConnectorId,
  privyWalletSignerAuthority,
  privyWalletWagmiIdentity,
  rmtActiveWalletPreferenceKey,
  rmtExternalWalletOptions,
  rmtInjectedWalletOptions,
  requiresExplicitWalletSelection,
  shouldAutomaticallyProvisionEmbeddedWallet,
  walletGatewayDisplayName,
  walletGatewayKey,
  type RmtActiveSignerAuthority
} from "../lib/wallet-gateway";

export type RmtTradingWalletSummary = {
  address: string;
  key: string;
  kind: "embedded" | "external";
  name: string;
};

type RmtIdentityContextValue = {
  authenticated: boolean;
  activeWalletKey: string | null;
  activeWalletKind: "embedded" | "external" | null;
  activeSignerAuthority: RmtActiveSignerAuthority | null;
  activeWalletName: string | null;
  clearTradingWalletPreference: () => void;
  clearWalletConnectionError: () => void;
  connectTradingWallet: () => void;
  enabled: boolean;
  externalWalletCount: number;
  embeddedWalletProvisioning: "signed-out" | "checking" | "creating" | "connecting" | "ready" | "not-required" | "failed";
  embeddedWalletProvisioningError: string;
  embeddedWalletRecovery: "retry" | "reauthenticate" | "reload-session";
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
  tradingWallets: readonly RmtTradingWalletSummary[];
  userId: string;
  walletConnection: WalletConnectionSnapshot;
  retryWalletConnection: () => void;
  retryEmbeddedWalletProvisioning: () => void;
  restartEmbeddedWalletSession: () => void;
  walletConnectionError: string;
  walletSelectionRequired: boolean;
};

const unavailableIdentity: RmtIdentityContextValue = {
  authenticated: false,
  activeWalletKey: null,
  activeWalletKind: null,
  activeSignerAuthority: null,
  activeWalletName: null,
  clearTradingWalletPreference: () => undefined,
  clearWalletConnectionError: () => undefined,
  connectTradingWallet: () => undefined,
  enabled: false,
  externalWalletCount: 0,
  embeddedWalletProvisioning: "signed-out",
  embeddedWalletProvisioningError: "",
  embeddedWalletRecovery: "retry",
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
  tradingWallets: [],
  userId: "",
  walletConnection: idleWalletConnection,
  retryWalletConnection: () => undefined,
  retryEmbeddedWalletProvisioning: () => undefined,
  restartEmbeddedWalletSession: () => undefined,
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
    activeSignerAuthority: isConnected && address && connector ? {
      adapter: "direct",
      connectorId: connector.id,
      connectorType: connector.type,
      connectorUid: connector.uid,
      originConnectorType: connector.type,
      walletClientType: "browser-acceptance",
      walletKey: walletGatewayKey({
        address,
        connectorType: connector.type,
        walletClientType: "browser-acceptance",
        meta: { id: connector.id },
        type: "ethereum"
      }),
      walletKind: "external"
    } : null,
    activeWalletName: isConnected ? "Deterministic browser wallet" : null,
    clearTradingWalletPreference: () => undefined,
    clearWalletConnectionError: () => undefined,
    connectTradingWallet,
    enabled: true,
    environment: "desktop",
    externalWalletCount: 1,
    embeddedWalletProvisioning: isConnected ? "not-required" : "signed-out",
    embeddedWalletProvisioningError: "",
    embeddedWalletRecovery: "retry",
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
    tradingWallets: isConnected && address && connector ? [{
      address,
      key: walletGatewayKey({
        address,
        connectorType: connector.type,
        walletClientType: "browser-acceptance",
        meta: { id: connector.id, name: "Deterministic browser wallet" },
        type: "ethereum"
      }),
      kind: "external",
      name: "Deterministic browser wallet"
    }] : [],
    userId: isConnected && address ? `browser-acceptance:${address.toLowerCase()}` : "",
    walletConnection: idleWalletConnection,
    retryWalletConnection: connectTradingWallet,
    retryEmbeddedWalletProvisioning: () => undefined,
    restartEmbeddedWalletSession: () => undefined,
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

type AccountAcceptanceEvent = {
  at: number;
  type: "LOGIN_REQUESTED" | "NEW_USER_PROVISIONING_REQUESTED" | "PROVISIONING_STARTED" | "PROVISIONING_FAILED" | "CONNECTING"
    | "RETURNING_CONNECTING" | "RETURNING_REUSED" | "READY" | "LOGGED_OUT"
    | "LINKED_EXTERNAL_COLD_RETURN" | "EXTERNAL_RECONNECT_REQUESTED" | "EXTERNAL_RECONNECTED"
    | "PREFERENCE_HYDRATING" | "TRANSPORT_REHYDRATED" | "PREFERENCE_HYDRATED" | "SIGNER_AUTHORITY_PUBLISHED";
  address?: string;
  walletKey?: string;
};

type AccountAcceptanceMode = "embedded-onboarding" | "linked-external-cold-return" | "external-preference-hydration";
export type AccountAcceptanceBalanceScenario = "positive" | "zero-input" | "erc20-no-gas";

declare global {
  interface Window {
    __RMT_ACCOUNT_ACCEPTANCE_CONFIG__?: {
      failFirstProvisioning?: boolean;
      mode?: AccountAcceptanceMode;
      preferenceHydrationDelayMs?: number;
      provisioningDelayMs?: number;
      returningUser?: boolean;
      storedExternalWalletKey?: string;
      walletBalanceScenario?: AccountAcceptanceBalanceScenario;
    };
    __RMT_ACCOUNT_ACCEPTANCE_EVENTS__?: AccountAcceptanceEvent[];
    __RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__?: Array<{
      activeWalletKey: string | null;
      at: number;
      mode: AccountAcceptanceMode;
      preferenceLoaded: boolean;
      preferredWalletKey: string | null;
    }>;
    __RMT_ACCOUNT_ACCEPTANCE_SET_SIGNER_UID__?: (connectorUid: string | null) => void;
  }
}

function recordAccountAcceptanceEvent(event: AccountAcceptanceEvent) {
  if (!accountFirstBrowserAcceptanceEnabled()) return;
  window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__ ??= [];
  window.__RMT_ACCOUNT_ACCEPTANCE_EVENTS__.push(event);
}

/** Loopback-only account fixture. It exercises the public account UI without replacing any API handler. */
export function AccountFirstAcceptanceIdentityBridge({ children }: { children: ReactNode }) {
  const acceptanceEnabled = accountFirstBrowserAcceptanceEnabled();
  const { address, chainId, connector, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { reconnectAsync } = useReconnect();
  const wagmiConfig = useConfig();
  const [mode, setMode] = useState<AccountAcceptanceMode>("embedded-onboarding");
  const [returningUser, setReturningUser] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [provisioning, setProvisioning] = useState<"signed-out" | "creating" | "connecting" | "failed" | "ready">("signed-out");
  const [acceptanceSignerUid, setAcceptanceSignerUid] = useState<string | null>(null);
  const [externalReconnectRequested, setExternalReconnectRequested] = useState(false);
  const [externalReady, setExternalReady] = useState(false);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [preferredWalletKey, setPreferredWalletKey] = useState<string | null>(null);
  const failedOnce = useRef(false);
  const generation = useRef(0);
  const transportRecorded = useRef(false);
  const fixtureConnector = connectors.find((candidate) => candidate.id === "rmt-walletconnect-fixture");
  const transportExactConnection = Boolean(acceptanceEnabled && authenticated && isConnected && address
    && chainId === 4_663 && connector?.id === "rmt-walletconnect-fixture");
  const transportExactConnectionRef = useRef(transportExactConnection);
  useLayoutEffect(() => { transportExactConnectionRef.current = transportExactConnection; }, [transportExactConnection]);
  const exactConnection = mode === "embedded-onboarding" && transportExactConnection && provisioning === "ready";
  const embeddedCandidate = exactConnection && address && connector ? {
    address,
    // The loopback account harness models embedded-account UX on the existing
    // deterministic connector. Its direct test adapter must preserve the real
    // connector identity instead of claiming production Privy/Wagmi authority.
    connectorType: connector.type,
    walletClientType: "privy-v2",
    meta: { id: connector.id, name: "RMT wallet" },
    type: "ethereum" as const
  } : undefined;
  const embeddedKey = embeddedCandidate ? walletGatewayKey(embeddedCandidate) : null;

  useEffect(() => {
    if (!acceptanceEnabled) return;
    const configuredMode = window.__RMT_ACCOUNT_ACCEPTANCE_CONFIG__?.mode ?? "embedded-onboarding";
    setMode(configuredMode);
    if (configuredMode === "embedded-onboarding") return;
    setAuthenticated(true);
    setProvisioning("signed-out");
    if (configuredMode === "linked-external-cold-return") {
      recordAccountAcceptanceEvent({ at: Date.now(), type: "LINKED_EXTERNAL_COLD_RETURN" });
      return;
    }
    recordAccountAcceptanceEvent({ at: Date.now(), type: "PREFERENCE_HYDRATING" });
    const delay = Math.max(0, Math.min(
      window.__RMT_ACCOUNT_ACCEPTANCE_CONFIG__?.preferenceHydrationDelayMs ?? 500,
      5_000
    ));
    const timeout = window.setTimeout(() => {
      const stored = window.__RMT_ACCOUNT_ACCEPTANCE_CONFIG__?.storedExternalWalletKey ?? null;
      setPreferredWalletKey(stored);
      setPreferenceLoaded(true);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [acceptanceEnabled]);

  useEffect(() => {
    if (!acceptanceEnabled || mode !== "external-preference-hydration" || !preferenceLoaded) return;
    recordAccountAcceptanceEvent({
      at: Date.now(),
      type: "PREFERENCE_HYDRATED",
      walletKey: preferredWalletKey ?? undefined
    });
  }, [acceptanceEnabled, mode, preferenceLoaded, preferredWalletKey]);

  useEffect(() => {
    if (!acceptanceEnabled) return;
    window.__RMT_ACCOUNT_ACCEPTANCE_SET_SIGNER_UID__ = setAcceptanceSignerUid;
    return () => {
      delete window.__RMT_ACCOUNT_ACCEPTANCE_SET_SIGNER_UID__;
    };
  }, [acceptanceEnabled]);

  useEffect(() => {
    if (!acceptanceEnabled || mode !== "embedded-onboarding"
      || window.__RMT_ACCOUNT_ACCEPTANCE_CONFIG__?.returningUser !== true) return;
    setReturningUser(true);
    setAuthenticated(true);
    setProvisioning("connecting");
  }, [acceptanceEnabled, mode]);

  useEffect(() => {
    if (!acceptanceEnabled || mode !== "embedded-onboarding" || !returningUser || !fixtureConnector || transportExactConnection) return;
    const attempt = ++generation.current;
    recordAccountAcceptanceEvent({ at: Date.now(), type: "RETURNING_CONNECTING" });
    let reconnectAttempted = false;
    let poll = 0;
    const deadline = window.setTimeout(() => {
      if (generation.current !== attempt || transportExactConnectionRef.current) return;
      generation.current += 1;
      window.clearTimeout(poll);
      setProvisioning("failed");
      recordAccountAcceptanceEvent({ at: Date.now(), type: "PROVISIONING_FAILED" });
    }, 5_000);
    const resumeWhenWagmiIsIdle = () => {
      if (generation.current !== attempt || transportExactConnectionRef.current) return;
      const status = wagmiConfig.state.status;
      if (!reconnectAttempted && status === "disconnected") {
        reconnectAttempted = true;
        void reconnectAsync({ connectors: [fixtureConnector] }).catch(() => undefined);
      }
      poll = window.setTimeout(resumeWhenWagmiIsIdle, 50);
    };
    resumeWhenWagmiIsIdle();
    return () => {
      window.clearTimeout(deadline);
      window.clearTimeout(poll);
    };
  }, [acceptanceEnabled, fixtureConnector, mode, reconnectAsync, returningUser, transportExactConnection, wagmiConfig]);

  useEffect(() => {
    if (!acceptanceEnabled || mode !== "external-preference-hydration" || !authenticated
      || !fixtureConnector || transportExactConnection) return;
    void connectAsync({ connector: fixtureConnector, chainId: 4_663 }).catch(() => undefined);
  }, [acceptanceEnabled, authenticated, connectAsync, fixtureConnector, mode, transportExactConnection]);

  useEffect(() => {
    if (mode !== "external-preference-hydration" || !transportExactConnection || transportRecorded.current) return;
    transportRecorded.current = true;
    recordAccountAcceptanceEvent({ at: Date.now(), type: "TRANSPORT_REHYDRATED", address: address?.toLowerCase() });
  }, [address, mode, transportExactConnection]);

  const startProvisioning = useCallback(() => {
    if (!acceptanceEnabled || mode !== "embedded-onboarding" || !fixtureConnector) return;
    const attempt = ++generation.current;
    const config = window.__RMT_ACCOUNT_ACCEPTANCE_CONFIG__;
    const delay = Math.max(0, Math.min(config?.provisioningDelayMs ?? 350, 5_000));
    setProvisioning("creating");
    recordAccountAcceptanceEvent({ at: Date.now(), type: "PROVISIONING_STARTED" });
    window.setTimeout(() => {
      if (generation.current !== attempt) return;
      if (config?.failFirstProvisioning && !failedOnce.current) {
        failedOnce.current = true;
        setProvisioning("failed");
        recordAccountAcceptanceEvent({ at: Date.now(), type: "PROVISIONING_FAILED" });
        return;
      }
      setProvisioning("connecting");
      recordAccountAcceptanceEvent({ at: Date.now(), type: "CONNECTING" });
      if (transportExactConnectionRef.current) return;
      void connectAsync({ connector: fixtureConnector, chainId: 4_663 }).catch(() => {
        if (generation.current !== attempt) return;
        setProvisioning("failed");
        recordAccountAcceptanceEvent({ at: Date.now(), type: "PROVISIONING_FAILED" });
      });
    }, delay);
  }, [acceptanceEnabled, connectAsync, fixtureConnector, mode]);

  useEffect(() => {
    if (!transportExactConnection || !address || provisioning !== "connecting") return;
    setProvisioning("ready");
    if (returningUser) recordAccountAcceptanceEvent({ at: Date.now(), type: "RETURNING_REUSED", address: address.toLowerCase() });
    recordAccountAcceptanceEvent({ at: Date.now(), type: "READY", address: address.toLowerCase() });
  }, [address, provisioning, returningUser, transportExactConnection]);

  const login = useCallback(() => {
    if (!acceptanceEnabled || mode !== "embedded-onboarding" || authenticated) return;
    setAuthenticated(true);
    recordAccountAcceptanceEvent({ at: Date.now(), type: "LOGIN_REQUESTED" });
    recordAccountAcceptanceEvent({ at: Date.now(), type: "NEW_USER_PROVISIONING_REQUESTED" });
    startProvisioning();
  }, [acceptanceEnabled, authenticated, mode, startProvisioning]);

  const connectTradingWallet = useCallback(() => {
    if (!acceptanceEnabled || mode === "embedded-onboarding") return;
    setExternalReconnectRequested(true);
    recordAccountAcceptanceEvent({ at: Date.now(), type: "EXTERNAL_RECONNECT_REQUESTED" });
    if (!transportExactConnection && fixtureConnector) {
      void connectAsync({ connector: fixtureConnector, chainId: 4_663 }).catch(() => undefined);
    }
  }, [acceptanceEnabled, connectAsync, fixtureConnector, mode, transportExactConnection]);

  useEffect(() => {
    if (!externalReconnectRequested || !transportExactConnection || externalReady) return;
    setExternalReady(true);
    recordAccountAcceptanceEvent({ at: Date.now(), type: "EXTERNAL_RECONNECTED", address: address?.toLowerCase() });
  }, [address, externalReady, externalReconnectRequested, transportExactConnection]);

  const logout = useCallback(async () => {
    if (!acceptanceEnabled) return;
    generation.current += 1;
    if (isConnected) await disconnectAsync();
    setAuthenticated(false);
    setProvisioning("signed-out");
    setExternalReconnectRequested(false);
    setExternalReady(false);
    recordAccountAcceptanceEvent({ at: Date.now(), type: "LOGGED_OUT" });
  }, [acceptanceEnabled, disconnectAsync, isConnected]);

  const tradingWallets = useMemo<readonly RmtTradingWalletSummary[]>(() => embeddedCandidate && embeddedKey ? [{
    address: embeddedCandidate.address,
    key: embeddedKey,
    kind: "embedded",
    name: "RMT wallet"
  }] : externalReady && address && connector ? [{
    address,
    key: walletGatewayKey({
      address,
      connectorType: connector.type,
      walletClientType: "browser-acceptance-external",
      meta: { id: connector.id },
      type: "ethereum"
    }),
    kind: "external",
    name: "Connected wallet"
  }] : [], [address, connector, embeddedCandidate, embeddedKey, externalReady]);

  const externalKey = externalReady && address && connector ? walletGatewayKey({
    address,
    connectorType: connector.type,
    walletClientType: "browser-acceptance-external",
    meta: { id: connector.id },
    type: "ethereum"
  }) : null;
  const activeWalletKey = exactConnection ? embeddedKey : externalReady ? externalKey : null;
  const activeWalletKind = exactConnection ? "embedded" as const : externalReady ? "external" as const : null;

  const value = useMemo<RmtIdentityContextValue>(() => acceptanceEnabled ? {
    authenticated,
    activeWalletKey,
    activeWalletKind,
    activeSignerAuthority: activeWalletKey && activeWalletKind && connector ? {
      adapter: "direct",
      connectorId: connector.id,
      connectorType: connector.type,
      connectorUid: acceptanceSignerUid ?? connector.uid,
      originConnectorType: connector.type,
      walletClientType: activeWalletKind === "embedded" ? "privy-v2" : "browser-acceptance-external",
      walletKey: activeWalletKey,
      walletKind: activeWalletKind
    } : null,
    activeWalletName: exactConnection ? "RMT wallet" : externalReady ? "Connected wallet" : null,
    clearTradingWalletPreference: () => undefined,
    clearWalletConnectionError: () => undefined,
    connectTradingWallet,
    enabled: true,
    environment: "desktop",
    externalWalletCount: externalReady ? 1 : 0,
    embeddedWalletProvisioning: !authenticated ? "signed-out" : mode === "embedded-onboarding" ? provisioning : "not-required",
    embeddedWalletProvisioningError: provisioning === "failed"
      ? "RMT could not finish creating this wallet. Retry here; you do not need to sign in again."
      : "",
    embeddedWalletRecovery: "retry",
    identityToken: authenticated ? "deterministic-browser-acceptance-token" : null,
    linkEmail: () => undefined,
    linkGoogle: () => undefined,
    linkPasskey: () => undefined,
    linkPhone: () => undefined,
    linkWallet: connectTradingWallet,
    linked: { email: authenticated, google: false, passkey: false, phone: false, wallet: mode !== "embedded-onboarding" },
    login,
    logout,
    phoneLast4: "",
    ready: true,
    selectTradingWallet: async () => connectTradingWallet(),
    supportsOAuth: true,
    tradingWallets,
    userId: authenticated ? "account-first-browser-acceptance" : "",
    walletConnection: idleWalletConnection,
    retryWalletConnection: startProvisioning,
    retryEmbeddedWalletProvisioning: startProvisioning,
    restartEmbeddedWalletSession: () => undefined,
    walletConnectionError: "",
    walletSelectionRequired: mode !== "embedded-onboarding" && !externalReady
  } : unavailableIdentity, [acceptanceEnabled, acceptanceSignerUid, activeWalletKey, activeWalletKind, authenticated, connectTradingWallet, exactConnection, externalReady, login, logout, mode, provisioning, startProvisioning, tradingWallets]);

  useLayoutEffect(() => {
    if (!acceptanceEnabled) return;
    injectedSignerSelection.setIdentity({
      authenticated: value.authenticated,
      userId: value.userId,
      activeWalletKey: value.activeWalletKey,
      address: value.activeWalletKey ? address : undefined,
      chainId: value.activeWalletKey ? chainId : undefined
    });
    window.__RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__ ??= [];
    window.__RMT_ACCOUNT_ACCEPTANCE_AUTHORITY_HISTORY__.push({
      activeWalletKey: value.activeWalletKey,
      at: Date.now(),
      mode,
      preferenceLoaded,
      preferredWalletKey
    });
    if (value.activeWalletKey) {
      recordAccountAcceptanceEvent({ at: Date.now(), type: "SIGNER_AUTHORITY_PUBLISHED", walletKey: value.activeWalletKey });
    }
  }, [acceptanceEnabled, address, chainId, mode, preferenceLoaded, preferredWalletKey, value.activeWalletKey, value.authenticated, value.userId]);
  useEffect(() => () => {
    generation.current += 1;
    if (acceptanceEnabled) injectedSignerSelection.setIdentity({ authenticated: false, userId: "", activeWalletKey: null });
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
  const { wallets, ready: walletsReady } = useWallets();
  const config = useConfig();
  const { connectAsync } = useConnect();
  const { switchAccountAsync } = useSwitchAccount();
  const { switchChainAsync } = useSwitchChain();
  const { address, chainId, connector } = useAccount();
  const [connectionController] = useState(() => new WalletConnectionController());
  const walletConnection = useSyncExternalStore(connectionController.subscribe, connectionController.getSnapshot, () => idleWalletConnection);
  const { identityToken } = useIdentityToken();
  const [preferredWalletKey, setPreferredWalletKey] = useState<string | null>(null);
  const [walletPreferenceLoadedForUser, setWalletPreferenceLoadedForUser] = useState<string | null>(null);
  const [appliedWalletKey, setAppliedWalletKey] = useState<string | null>(null);
  const [walletConnectionError, setWalletConnectionError] = useState("");
  const [embeddedProvisioningAttempt, setEmbeddedProvisioningAttempt] = useState<"idle" | "creating" | "connecting" | "failed">("idle");
  const [embeddedProvisioningError, setEmbeddedProvisioningError] = useState("");
  const restored = useRef(false);
  const automaticProvisioningUser = useRef<string | undefined>(undefined);
  const automaticEmbeddedActivation = useRef<string | undefined>(undefined);
  const embeddedActivationGeneration = useRef(0);
  const linkedExternalWalletAccounts = useMemo(
    () => linkedExternalEthereumWallets(user?.linkedAccounts ?? []),
    [user?.linkedAccounts]
  );
  const linkedEmbeddedWalletCount = useMemo(() => (user?.linkedAccounts ?? []).filter((account) => (
    account.type === "wallet"
      && account.chainType === "ethereum"
      && isEmbeddedWalletClientType(account.walletClientType)
  )).length, [user?.linkedAccounts]);
  const walletPreferenceLoaded = Boolean(authenticated && user?.id && walletPreferenceLoadedForUser === user.id);
  const currentIdentity = useRef({
    wallets,
    authenticated,
    hasLinkedEmbeddedWallet: linkedEmbeddedWalletCount > 0,
    hasLinkedExternalWallet: linkedExternalWalletAccounts.length > 0,
    preferredWalletKey,
    userId: user?.id
  });
  useLayoutEffect(() => {
    currentIdentity.current = {
      wallets,
      authenticated,
      hasLinkedEmbeddedWallet: linkedEmbeddedWalletCount > 0,
      hasLinkedExternalWallet: linkedExternalWalletAccounts.length > 0,
      preferredWalletKey,
      userId: user?.id
    };
  }, [wallets, authenticated, linkedEmbeddedWalletCount, linkedExternalWalletAccounts.length, preferredWalletKey, user?.id]);
  useEffect(() => () => connectionController.dispose(), [connectionController]);
  const [environment] = useState<WalletBrowserEnvironment>(() => {
    if (typeof window === "undefined") return "desktop";
    return walletBrowserEnvironment(window.navigator.userAgent, Boolean((window as Window & { ethereum?: unknown }).ethereum));
  });
  const supportsOAuth = environment !== "mobile-wallet-browser";

  useEffect(() => {
    setWalletPreferenceLoadedForUser(null);
    if (!authenticated || !user?.id) {
      setPreferredWalletKey(null);
      return;
    }
    let durable: string | null = null;
    let sessionPreference: string | null = null;
    try {
      const preferenceKey = rmtActiveWalletPreferenceKey(user.id);
      durable = window.localStorage.getItem(preferenceKey);
      sessionPreference = window.sessionStorage.getItem(preferenceKey);
    } catch {
      // Storage is only a preference aid. Exact active-connector proof remains
      // authoritative and a reconnected external wallet still forces a choice.
    }
    setPreferredWalletKey(durable ?? sessionPreference);
    setWalletPreferenceLoadedForUser(user.id);
  }, [authenticated, user?.id]);

  const rememberTradingWallet = useCallback((walletKey: string) => {
    setPreferredWalletKey(walletKey);
    if (typeof window !== "undefined") {
      try {
        if (user?.id) {
          const preferenceKey = rmtActiveWalletPreferenceKey(user.id);
          window.sessionStorage.setItem(preferenceKey, walletKey);
          window.localStorage.setItem(preferenceKey, walletKey);
        }
      } catch {
        // Keep the exact in-memory selection for this mounted session. A future
        // session will ask rather than infer another signer.
      }
    }
  }, [user?.id]);

  const externalWallets = useMemo(() => externalEthereumWallets(wallets), [wallets]);
  const embeddedWallets = useMemo(() => wallets.filter((wallet) => (
    wallet.type === "ethereum" && isEmbeddedWalletClientType(wallet.walletClientType)
  )), [wallets]);
  const walletBindings = useMemo(() => {
    return wallets.flatMap((wallet) => {
      if (wallet.type !== "ethereum") return [];
      const rawKey = walletGatewayKey(wallet);
      const connectorId = privyWagmiConnectorId(wallet);
      const connectors = connectorId ? config.connectors.filter((candidate) => candidate.id === connectorId) : [];
      const walletConnector = connectors.length === 1 ? connectors[0] : undefined;
      if (!walletConnector) return [];
      const signer = privyWalletWagmiIdentity(wallet, walletConnector);
      const authority = privyWalletSignerAuthority(wallet, walletConnector);
      return signer && authority ? [{
        authority,
        connector: walletConnector,
        key: rawKey,
        kind: isEmbeddedWalletClientType(wallet.walletClientType) ? "embedded" as const : "external" as const,
        rawKey,
        signer,
        wallet
      }] : [];
    });
  }, [config.connectors, wallets]);
  const embeddedWalletBindings = useMemo(
    () => walletBindings.filter((binding) => binding.kind === "embedded"),
    [walletBindings]
  );
  const externalWalletBindings = useMemo(
    () => walletBindings.filter((binding) => binding.kind === "external"),
    [walletBindings]
  );
  const tradingWallets = useMemo<readonly RmtTradingWalletSummary[]>(() => {
    const summaries = [
    ...embeddedWallets.map((wallet) => ({
      address: wallet.address,
      key: walletGatewayKey(wallet),
      kind: "embedded" as const,
      name: walletGatewayDisplayName(wallet)
    })),
    ...externalWalletBindings.map(({ key, wallet }) => ({
      address: wallet.address,
      key,
      kind: "external" as const,
      name: walletGatewayDisplayName(wallet)
    }))];
    const seen = new Set<string>();
    return summaries.filter(({ key }) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [embeddedWallets, externalWalletBindings]);
  const ethereumWalletCount = useMemo(
    () => wallets.filter((wallet) => wallet.type === "ethereum").length,
    [wallets]
  );
  const addressMatches = useMemo(() => externalWalletBindings.filter(
    ({ signer }) => Boolean(address) && signer.address.toLowerCase() === address!.toLowerCase()
  ), [address, externalWalletBindings]);
  const automaticEmbeddedWallet = useMemo(() => resolveAutomaticEmbeddedWalletCandidate(
    embeddedWallets.map((wallet) => ({
      address: wallet.address,
      connectorId: privyWagmiConnectorId(wallet) ?? "",
      key: walletGatewayKey(wallet),
      wallet
    })),
    {
      preferredWalletKey,
      hasCurrentExternalBinding: addressMatches.length > 0 || linkedExternalWalletAccounts.length > 0
    }
  )?.wallet, [addressMatches.length, embeddedWallets, linkedExternalWalletAccounts.length, preferredWalletKey]);
  useEffect(() => {
    if (!authenticated || !walletsReady || !walletPreferenceLoaded || !preferredWalletKey || !user?.id) return;
    const rawMatches = wallets.filter((wallet) => wallet.type === "ethereum" && walletGatewayKey(wallet) === preferredWalletKey);
    if (rawMatches.length === 1 || preferredWalletRemainsLinked(user.linkedAccounts, preferredWalletKey)) return;
    // A removed or ambiguous wallet must not strand the consumer in a loading
    // state. Forget only the stale preference; exact current connector proof
    // still decides whether embedded may default or an external choice appears.
    setPreferredWalletKey(null);
    try {
      const preferenceKey = rmtActiveWalletPreferenceKey(user.id);
      window.sessionStorage.removeItem(preferenceKey);
      window.localStorage.removeItem(preferenceKey);
      window.sessionStorage.removeItem(RMT_ACTIVE_WALLET_SESSION_KEY);
    } catch { /* storage unavailable; in-memory recovery still proceeds */ }
  }, [authenticated, preferredWalletKey, user?.id, user?.linkedAccounts, walletPreferenceLoaded, wallets, walletsReady]);
  const activeExternalBinding = useMemo(() => {
    if (preferredWalletKey) {
      const preferred = addressMatches.find(({ key }) => key === preferredWalletKey);
      if (preferred) return preferred;
    }
    return addressMatches.length === 1 ? addressMatches[0] : undefined;
  }, [addressMatches, preferredWalletKey]);
  const activeExternalWallet = activeExternalBinding?.wallet;
  const embeddedConnection = connector ? config.state.connections.get(connector.uid) : undefined;
  const embeddedSnapshot = {
    accounts: embeddedConnection?.accounts ?? [],
    chainId: embeddedConnection?.chainId,
    connectorId: embeddedConnection?.connector.id,
    connectorUid: embeddedConnection?.connector.uid,
    currentConnectorUid: config.state.current ?? undefined
  };
  const confirmedEmbeddedWalletCandidate = authenticated ? resolveConfirmedEmbeddedWalletKey(
    embeddedWalletBindings.map(({ connector: walletConnector, key, signer }) => ({
      address: signer.address,
      connectorId: signer.meta?.id ?? "",
      connectorUid: walletConnector.uid,
      key
    })), embeddedSnapshot, 4_663
  ) : null;
  const confirmedEmbeddedWalletKey = canPublishEmbeddedWalletAuthority({
    confirmedWalletKey: confirmedEmbeddedWalletCandidate,
    confirmedWalletLinkedToCurrentUser: preferredWalletRemainsLinked(
      user?.linkedAccounts ?? [], confirmedEmbeddedWalletCandidate
    ),
    embeddedWalletCandidateCount: embeddedWalletBindings.length,
    hasLinkedExternalWallet: linkedExternalWalletAccounts.length > 0,
    preferredWalletKey,
    walletPreferenceLoaded
  }) ? confirmedEmbeddedWalletCandidate : null;
  const confirmedEmbeddedBinding = confirmedEmbeddedWalletKey
    ? embeddedWalletBindings.find(({ key }) => key === confirmedEmbeddedWalletKey)
    : undefined;
  const embeddedConnectorConfirmed = Boolean(confirmedEmbeddedBinding);
  const embeddedSignerWallet = confirmedEmbeddedBinding?.signer;
  const activeExternalLinkedToCurrentUser = Boolean(activeExternalBinding
    && preferredWalletRemainsLinked(user?.linkedAccounts ?? [], activeExternalBinding.key));
  const activeConnectorConfirmed = walletPreferenceLoaded
    && activeExternalLinkedToCurrentUser
    && walletConnection.state === "CONNECTED"
    && walletConnection.connectorUid === connector?.uid
    && walletConnection.walletKey === appliedWalletKey
    && walletConnection.walletKey === (activeExternalBinding?.key ?? null)
    && isConnectorSelectionConfirmed({
    appliedWalletKey,
    authenticated,
    matchingWalletCount: addressMatches.length,
    wallet: activeExternalBinding?.wallet
  });
  const activeWalletKind: RmtIdentityContextValue["activeWalletKind"] = activeConnectorConfirmed
    ? "external"
    : embeddedSignerWallet
      ? "embedded"
      : addressMatches.length > 0
        ? null
        : null;
  const linkedSignerAddress = authenticated && activeExternalWallet?.linked && activeExternalLinkedToCurrentUser
    ? activeExternalWallet.address : undefined;
  const signerWalletKey = activeConnectorConfirmed && activeExternalWallet
    ? activeExternalBinding!.key
    : embeddedSignerWallet ? confirmedEmbeddedBinding!.key : null;
  const activeSignerAuthority = activeConnectorConfirmed && activeExternalBinding
    ? activeExternalBinding.authority
    : embeddedSignerWallet ? confirmedEmbeddedBinding!.authority : null;

  const observeEmbeddedWalletProvisioning = useCallback(async () => {
    if (!authenticated || !walletsReady || currentIdentity.current.wallets.some((wallet) => (
      wallet.type === "ethereum" && isEmbeddedWalletClientType(wallet.walletClientType)
    ))) return;
    const startingUser = currentIdentity.current.userId;
    setEmbeddedProvisioningAttempt(currentIdentity.current.hasLinkedEmbeddedWallet ? "connecting" : "creating");
    setEmbeddedProvisioningError("");
    const walletRecordAvailable = await waitForEmbeddedWalletRecord(
      () => currentIdentity.current.wallets.some((wallet) => (
        wallet.type === "ethereum" && isEmbeddedWalletClientType(wallet.walletClientType)
      )),
      { isCurrent: () => currentIdentity.current.userId === startingUser }
    );
    if (currentIdentity.current.userId !== startingUser) return;
    if (walletRecordAvailable) {
      setEmbeddedProvisioningAttempt("connecting");
      return;
    }
    setEmbeddedProvisioningAttempt("failed");
    setEmbeddedProvisioningError(currentIdentity.current.hasLinkedEmbeddedWallet
      ? "Your existing RMT wallet is linked, but Privy did not restore its local signing connection. Reload this wallet session or sign in again; RMT will not create a second wallet."
      : "Privy did not finish creating the RMT wallet for this sign-in. Sign in again to retry; RMT will not start a competing wallet-creation request.");
  }, [authenticated, walletsReady]);

  const activateEmbeddedWallet = useCallback(async (wallet: (typeof embeddedWallets)[number]) => {
    const expectedConnectorId = privyWagmiConnectorId(wallet);
    const walletKey = walletGatewayKey(wallet);
    const attempt = ++embeddedActivationGeneration.current;
    setEmbeddedProvisioningAttempt("connecting");
    setEmbeddedProvisioningError("");
    if (!expectedConnectorId) {
      setEmbeddedProvisioningAttempt("failed");
      setEmbeddedProvisioningError("RMT could not establish the embedded wallet connector identity. Retry wallet setup.");
      return false;
    }
    try {
      const selected = await waitForExactWalletConnector(
        () => config.connectors,
        expectedConnectorId,
        {
          isCurrent: () => embeddedActivationGeneration.current === attempt
            && currentIdentity.current.userId === user?.id
            && currentIdentity.current.wallets.filter((candidate) => walletGatewayKey(candidate) === walletKey).length === 1
        }
      );
      if (!selected) throw new Error("The embedded wallet connector did not become uniquely available.");
      await config.storage?.removeItem(`${selected.id}.disconnected`);
      const existingConnection = config.state.connections.get(selected.uid);
      if (existingConnection) {
        if (!existingConnection.accounts.some((account) => account.toLowerCase() === wallet.address.toLowerCase())) {
          throw new Error("The embedded wallet connector does not contain the expected account.");
        }
        if (existingConnection.chainId !== 4_663) {
          await switchChainAsync({ connector: selected, chainId: 4_663 });
        }
        const correctedConnection = config.state.connections.get(selected.uid);
        if (correctedConnection?.chainId !== 4_663
          || !correctedConnection.accounts.some((account) => account.toLowerCase() === wallet.address.toLowerCase())) {
          throw new Error("The embedded wallet connector did not reach Robinhood Chain.");
        }
        await switchAccountAsync({ connector: selected });
      } else {
        await connectAsync({ connector: selected, chainId: 4_663 });
      }
      const confirmed = await waitForEmbeddedWalletActivation(() => {
        const currentConnectorUid = config.state.current ?? undefined;
        const connection = currentConnectorUid ? config.state.connections.get(currentConnectorUid) : undefined;
        return {
          accounts: connection?.accounts ?? [],
          chainId: connection?.chainId,
          connectorId: connection?.connector.id,
          connectorUid: connection?.connector.uid,
          currentConnectorUid
        };
      }, {
        address: wallet.address,
        chainId: 4_663,
        connectorId: expectedConnectorId,
        connectorUid: selected.uid
      }, {
        isCurrent: () => embeddedActivationGeneration.current === attempt
          && currentIdentity.current.userId === user?.id
          && currentIdentity.current.wallets.filter((candidate) => walletGatewayKey(candidate) === walletKey).length === 1
      });
      if (embeddedActivationGeneration.current !== attempt) return false;
      if (!confirmed) throw new Error("Embedded wallet activation did not reach its exact signer postcondition.");
      setEmbeddedProvisioningAttempt("idle");
      setEmbeddedProvisioningError("");
      return true;
    } catch {
      if (embeddedActivationGeneration.current !== attempt) return false;
      setEmbeddedProvisioningAttempt("failed");
      setEmbeddedProvisioningError("Your RMT wallet exists, but its exact Robinhood Chain signing connection did not activate. Retry the connection here.");
      return false;
    }
  }, [config, connectAsync, switchAccountAsync, switchChainAsync, user?.id]);

  useEffect(() => {
    if (!authenticated || !walletsReady || !user?.id) {
      if (!authenticated) {
        embeddedActivationGeneration.current += 1;
        automaticProvisioningUser.current = undefined;
        automaticEmbeddedActivation.current = undefined;
        setEmbeddedProvisioningAttempt("idle");
        setEmbeddedProvisioningError("");
      }
      return;
    }
    const privyCreationPending = shouldAutomaticallyProvisionEmbeddedWallet({
      authenticated,
      connectedEthereumWalletCount: ethereumWalletCount,
      linkedEthereumWalletCount: linkedEmbeddedWalletCount + linkedExternalWalletAccounts.length,
      walletsReady
    });
    const linkedEmbeddedRecordPending = linkedEmbeddedWalletCount > 0 && embeddedWallets.length === 0;
    if ((!privyCreationPending && !linkedEmbeddedRecordPending)
      || automaticProvisioningUser.current === user.id) return;
    automaticProvisioningUser.current = user.id;
    void observeEmbeddedWalletProvisioning();
  }, [authenticated, embeddedWallets.length, ethereumWalletCount, linkedEmbeddedWalletCount, linkedExternalWalletAccounts.length, observeEmbeddedWalletProvisioning, user?.id, walletsReady]);

  useEffect(() => {
    if (!authenticated || !walletsReady || !walletPreferenceLoaded) return;
    if (embeddedConnectorConfirmed) {
      if (!preferredWalletKey && confirmedEmbeddedWalletKey) rememberTradingWallet(confirmedEmbeddedWalletKey);
      automaticEmbeddedActivation.current = undefined;
      setEmbeddedProvisioningAttempt("idle");
      setEmbeddedProvisioningError("");
      return;
    }
    // A durable explicit preference wins. Without one, a currently reconnected
    // external signer must remain a visible choice instead of being silently
    // replaced by the embedded default.
    if (!automaticEmbeddedWallet) return;
    const activationKey = `${user?.id ?? ""}:${walletGatewayKey(automaticEmbeddedWallet)}`;
    if (automaticEmbeddedActivation.current === activationKey) return;
    automaticEmbeddedActivation.current = activationKey;
    setEmbeddedProvisioningAttempt("connecting");
    const walletKey = walletGatewayKey(automaticEmbeddedWallet);
    void activateEmbeddedWallet(automaticEmbeddedWallet).then((activated) => {
      if (activated && currentIdentity.current.userId === user?.id && !currentIdentity.current.preferredWalletKey) {
        rememberTradingWallet(walletKey);
      }
    });
  }, [activateEmbeddedWallet, authenticated, automaticEmbeddedWallet, confirmedEmbeddedWalletKey, embeddedConnectorConfirmed, preferredWalletKey, rememberTradingWallet, user?.id, walletPreferenceLoaded, walletsReady]);
  useLayoutEffect(() => {
    injectedSignerSelection.setIdentity({ authenticated, userId: user?.id ?? "", linkedAddress: linkedSignerAddress,
      activeWalletKey: signerWalletKey, address, chainId });
  }, [authenticated, user?.id, linkedSignerAddress, signerWalletKey, address, chainId]);
  useEffect(() => {
    startInjectedSignerDiscovery();
    return () => injectedSignerSelection.setIdentity({ authenticated: false, userId: "", activeWalletKey: null });
  }, []);
  const resetTradingWalletRuntime = useCallback(() => {
    connectionController.cancel();
    injectedSignerSelection.invalidate();
    restored.current = true;
    setAppliedWalletKey(null);
    setPreferredWalletKey(null);
    try {
      window.sessionStorage.removeItem(RMT_ACTIVE_WALLET_SESSION_KEY);
    } catch { /* runtime authority was still cleared */ }
  }, [connectionController]);
  const clearTradingWalletPreference = useCallback(() => {
    resetTradingWalletRuntime();
    if (user?.id) {
      try {
        const preferenceKey = rmtActiveWalletPreferenceKey(user.id);
        window.sessionStorage.removeItem(preferenceKey);
        window.localStorage.removeItem(preferenceKey);
      } catch { /* storage unavailable */ }
    }
  }, [resetTradingWalletRuntime, user?.id]);
  const logoutFromRmt = useCallback(async () => {
    resetTradingWalletRuntime();
    await Promise.allSettled(externalWallets.map((wallet) => Promise.resolve(wallet.disconnect())));
    await logout();
  }, [externalWallets, logout, resetTradingWalletRuntime]);
  const restartEmbeddedWalletSession = useCallback(() => {
    void logoutFromRmt().then(() => openPrivyLogin({
      loginMethods: supportsOAuth ? ["email", "google", "passkey", "wallet"] : ["email", "passkey", "wallet"],
      walletChainType: "ethereum-only"
    })).catch(() => {
      setEmbeddedProvisioningAttempt("failed");
      setEmbeddedProvisioningError("RMT could not restart the secure wallet session. Reload this page, then sign in again.");
    });
  }, [logoutFromRmt, openPrivyLogin, supportsOAuth]);
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
    const matches = externalWalletBindings.filter((binding) => binding.key === walletKey);
    if (matches.length !== 1) { connectionController.begin(walletKey); connectionController.fail("Wallet binding is ambiguous or unavailable. Choose another wallet."); return; }
    const binding = matches[0]!;
    const { connector: selected, rawKey, wallet } = binding;
    const startingUser = currentIdentity.current.userId;
    let activatedUid: string | null = null;
    await connectionController.select(walletKey, scope => activateSelectedWallet(scope, wallet, {
      stillSelected: () => {
        const current = currentIdentity.current;
        return (!startingUser || current.userId === startingUser)
          && (!activatedUid || config.state.current === activatedUid)
          && current.wallets.filter((candidate) => walletGatewayKey(candidate) === rawKey).length === 1
          && config.connectors.filter((candidate) => candidate.id === selected.id && candidate.uid === selected.uid).length === 1;
      },
      currentProvider: () => {
        const currentMatches = currentIdentity.current.wallets.filter((candidate) => walletGatewayKey(candidate) === rawKey);
        if (currentMatches.length !== 1) throw new Error("Wallet binding changed.");
        return currentMatches[0].getEthereumProvider();
      },
      needsLogin: () => !currentIdentity.current.authenticated || !wallet.linked,
      activate: async (provider, check) => {
        // @privy-io/wagmi 4.0.15 setActiveWallet dispatches void mutations.
        // Await the real Wagmi mutation instead, with independently checked provider identity.
        const candidates = config.connectors.filter((candidate) => candidate.id === selected.id && candidate.uid === selected.uid);
        if (candidates.length !== 1) throw new Error("Connector binding is ambiguous.");
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
  }, [connectionController, config, connectAsync, externalWalletBindings, switchAccountAsync, rememberTradingWallet]);

  const selectTradingWallet = useCallback(async (walletKey: string) => {
    const embeddedWallet = resolveExactEmbeddedWalletCandidate(embeddedWallets.map((wallet) => ({
      address: wallet.address,
      connectorId: privyWagmiConnectorId(wallet) ?? "",
      key: walletGatewayKey(wallet),
      wallet
    })), walletKey)?.wallet;
    if (embeddedWallet) {
      connectionController.cancel();
      injectedSignerSelection.invalidate();
      setAppliedWalletKey(null);
      setWalletConnectionError("");
      automaticEmbeddedActivation.current = `${user?.id ?? ""}:${walletGatewayKey(embeddedWallet)}`;
      if (!await activateEmbeddedWallet(embeddedWallet)) throw new Error("The exact embedded signing wallet did not activate.");
      rememberTradingWallet(walletKey);
      return;
    }
    await activateTradingWallet(walletKey);
  }, [activateEmbeddedWallet, activateTradingWallet, embeddedWallets, connectionController, rememberTradingWallet, user?.id]);

  useEffect(() => {
    if (restored.current || !preferredWalletKey || connectionController.getSnapshot().state !== "IDLE") return;
    if (!externalWalletBindings.some(({ key }) => key === preferredWalletKey)) return;
    // Restore uses the same bounded, independently validated path as an explicit choice.
    void activateTradingWallet(preferredWalletKey);
  }, [activateTradingWallet, connectionController, externalWalletBindings, preferredWalletKey]);
  const previousUser = useRef(user?.id);
  useLayoutEffect(() => {
    if (previousUser.current !== user?.id) {
      if (previousUser.current) resetTradingWalletRuntime();
      restored.current = false;
    }
    previousUser.current = user?.id;
  }, [user?.id, resetTradingWalletRuntime]);
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
  const linkedEmbeddedWalletConnectionMissing = authenticated && walletsReady
    && linkedEmbeddedWalletCount > 0 && embeddedWallets.length === 0;
  const embeddedWalletProvisioning: RmtIdentityContextValue["embeddedWalletProvisioning"] = !authenticated
    ? "signed-out"
    : !walletsReady
      ? "checking"
    : activeWalletKind === "embedded"
        ? "ready"
        : activeWalletKind === "external"
          ? "not-required"
          : linkedExternalWalletAccounts.length > 0 && ethereumWalletCount === 0
            ? "not-required"
          : embeddedProvisioningAttempt === "failed"
          ? "failed"
          : embeddedProvisioningAttempt === "creating" || (ethereumWalletCount === 0 && !linkedEmbeddedWalletConnectionMissing)
            ? "creating"
            : (linkedEmbeddedWalletConnectionMissing || embeddedProvisioningAttempt === "connecting" || (automaticEmbeddedWallet && !embeddedConnectorConfirmed))
              ? "connecting"
              : "not-required";
  const value = useMemo<RmtIdentityContextValue>(() => ({
    authenticated,
    activeWalletKey: signerWalletKey,
    activeWalletKind,
    activeSignerAuthority,
    activeWalletName: activeConnectorConfirmed && activeExternalWallet
      ? walletGatewayDisplayName(activeExternalWallet)
      : embeddedSignerWallet ? walletGatewayDisplayName(embeddedSignerWallet) : null,
    clearTradingWalletPreference,
    clearWalletConnectionError: () => setWalletConnectionError(""),
    connectTradingWallet,
    enabled: true,
    embeddedWalletProvisioning,
    embeddedWalletProvisioningError: embeddedProvisioningError,
    embeddedWalletRecovery: linkedEmbeddedWalletConnectionMissing
      ? "reload-session"
      : embeddedProvisioningAttempt === "failed" ? "reauthenticate" : "retry",
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
      loginMethods: supportsOAuth ? ["email", "google", "passkey", "wallet"] : ["email", "passkey", "wallet"],
      walletChainType: "ethereum-only"
    }),
    logout: logoutFromRmt,
    phoneLast4: user?.linkedAccounts.find((account) => account.type === "phone")?.number.slice(-4) ?? "",
    ready,
    selectTradingWallet,
    supportsOAuth,
    tradingWallets,
    userId: user?.id ?? "",
    walletConnection,
    retryWalletConnection: () => {
      if (walletConnection.walletKey) void activateTradingWallet(walletConnection.walletKey);
      else connectTradingWallet();
    },
    retryEmbeddedWalletProvisioning: () => {
      automaticProvisioningUser.current = undefined;
      automaticEmbeddedActivation.current = undefined;
      const recoveryAction = embeddedWalletRecordRecovery({
        connectedEmbeddedWalletCount: embeddedWallets.length,
        linkedEmbeddedWalletCount
      });
      if (recoveryAction === "reload-session") {
        window.location.reload();
      } else if (recoveryAction === "activate" && embeddedWallets.length === 1) {
        const embeddedWallet = embeddedWallets[0];
        automaticEmbeddedActivation.current = `${user?.id ?? ""}:${walletGatewayKey(embeddedWallet)}`;
        void activateEmbeddedWallet(embeddedWallet);
      } else {
        restartEmbeddedWalletSession();
      }
    },
    restartEmbeddedWalletSession,
    walletConnectionError: walletConnection.error || walletConnectionError,
    walletSelectionRequired: requiresExplicitWalletSelection({
      activeEmbeddedWallet: activeWalletKind === "embedded",
      activeExternalWalletConfirmed: activeConnectorConfirmed,
      externalWalletCount: externalWallets.length,
      hasActiveAddress: Boolean(address),
      matchingExternalWalletCount: addressMatches.length
    }) || (embeddedWalletBindings.length > 1 && !embeddedConnectorConfirmed)
      || (linkedExternalWalletAccounts.length > 0 && activeWalletKind !== "embedded" && !activeConnectorConfirmed)
  }), [
    authenticated,
    activeExternalWallet,
    activeConnectorConfirmed,
    activeSignerAuthority,
    activeWalletKind,
    activateTradingWallet,
    activateEmbeddedWallet,
    selectTradingWallet,
    address,
    addressMatches.length,
    clearTradingWalletPreference,
    environment,
    embeddedWallets,
    embeddedWalletBindings,
    embeddedWalletProvisioning,
    embeddedProvisioningError,
    externalWallets,
    embeddedSignerWallet,
    identityToken,
    linkEmail,
    linkGoogle,
    linkPasskey,
    linkPhone,
    linkWallet,
    linked,
    linkedExternalWalletAccounts.length,
    linkedEmbeddedWalletCount,
    linkedEmbeddedWalletConnectionMissing,
    openPrivyLogin,
    connectTradingWallet,
    walletConnection,
    logoutFromRmt,
    ready,
    restartEmbeddedWalletSession,
    supportsOAuth,
    tradingWallets,
    user?.id,
    walletConnectionError
  ]);

  return <RmtIdentityContext.Provider value={value}>{children}</RmtIdentityContext.Provider>;
}

export function useRmtIdentity() {
  return useContext(RmtIdentityContext);
}
