"use client";

import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { recordExperienceStage } from "../lib/experience-funnel";
import { walletBrowserEnvironment } from "../lib/mobile-wallet-link";
import { FundWalletButton } from "./fund-wallet-button";
import { WalletReceiveDialog } from "./wallet-receive-dialog";
import { WalletTransferDialog } from "./wallet-transfer-dialog";
import { OverlayPortal } from "./overlay-portal";
import { useRmtIdentity } from "./rmt-identity";
import { WalletConnectionPanel } from "./wallet-connection-panel";
import { InjectedSignerSelection } from "./injected-signer-selection";
import { dialogFocusableElements } from "./dialog-focus";
import { bindRmtActiveSigner } from "../lib/wallet-gateway";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function safeWalletMessage(message: string) {
  if (/rejected|denied|cancelled|canceled|exited/i.test(message)) return "Wallet setup was cancelled. Nothing changed.";
  if (/chain|network/i.test(message)) return "The wallet could not switch to Robinhood Chain.";
  return "The wallet action did not complete. Try again or choose another wallet.";
}

export function PrivyWalletButton({
  target = "testnet",
  showFunding = true,
  compact = false
}: {
  target?: "testnet" | "mainnet";
  returnTo?: string;
  showFunding?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [message, setMessage] = useState("");
  const pathname = usePathname();
  const walletFirstTerminal = pathname === "/" || pathname === "/vnext" || pathname.startsWith("/vnext/");
  const identity = useRmtIdentity();
  const { address, chainId, connector, isConnected } = useAccount();
  const { disconnect: disconnectWagmi } = useDisconnect();
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const { switchChain, isPending: isSwitching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const [walletEnvironment] = useState(() => {
    if (typeof window === "undefined") return "desktop" as const;
    return walletBrowserEnvironment(window.navigator.userAgent, Boolean((window as Window & { ethereum?: unknown }).ethereum));
  });
  const tradingWallets = identity.tradingWallets;
  const externalWallets = tradingWallets.filter((wallet) => wallet.kind === "external");
  const activeTradingWallet = identity.activeWalletKey
    ? tradingWallets.find((wallet) => wallet.key === identity.activeWalletKey)
    : undefined;
  const activeWallet = activeTradingWallet;
  const displayedWallets = tradingWallets;
  const activeAccountAddress = useMemo(() => {
    try {
      return bindRmtActiveSigner({
        selectedWalletKey: identity.activeWalletKey,
        selectedWalletKind: identity.activeWalletKind,
        selectedSignerAuthority: identity.activeSignerAuthority,
        connectedAddress: address,
        connectorId: connector?.id,
        connectorType: connector?.type,
        connectorUid: connector?.uid
      }).address;
    } catch {
      return undefined;
    }
  }, [address, connector?.id, connector?.type, connector?.uid, identity.activeSignerAuthority, identity.activeWalletKey, identity.activeWalletKind]);
  const connectedTradingWallet = Boolean(
    identity.authenticated
    && isConnected
    && activeAccountAddress
  );
  const close = useCallback(() => setOpen(false), []);
  const connectionActive = ["CONNECTING", "SLOW", "FAILED"].includes(identity.walletConnection.state);
  const activeModal = connectionActive && connectionOpen ? "connection" : open ? "menu" : null;
  const closeActiveModal = useCallback(() => {
    if (activeModal === "connection") setConnectionOpen(false);
    else setOpen(false);
  }, [activeModal]);
  const closeReceive = useCallback(() => setReceiveOpen(false), []);
  const closeTransfer = useCallback(() => setTransferOpen(false), []);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuDialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (connectionActive) {
      setOpen(false);
      setConnectionOpen(true);
    } else {
      setConnectionOpen(false);
    }
  }, [connectionActive, identity.walletConnection.state]);

  useEffect(() => {
    if (!activeModal) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : menuTrigger.current;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeActiveModal();
        return;
      }
      if (event.key !== "Tab" || !menuDialog.current) return;
      const focusable = dialogFocusableElements(menuDialog.current);
      if (focusable.length === 0) {
        event.preventDefault();
        menuDialog.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => {
      if (menuDialog.current) dialogFocusableElements(menuDialog.current)[0]?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      const focusTarget = returnFocus.current?.isConnected ? returnFocus.current : menuTrigger.current;
      focusTarget?.focus({ preventScroll: true });
    };
  }, [activeModal, closeActiveModal]);

  const beginExternalConnection = () => {
    setMessage("");
    identity.clearWalletConnectionError();
    setOpen(false);
    setConnectionOpen(true);
    identity.connectTradingWallet();
  };

  const chooseWallet = async (walletKey: string) => {
    setMessage("");
    identity.clearWalletConnectionError();
    setOpen(false);
    setConnectionOpen(true);
    try {
      await identity.selectTradingWallet(walletKey);
      setConnectionOpen(false);
    } catch (error) {
      setMessage(safeWalletMessage(error instanceof Error ? error.message : ""));
      setConnectionOpen(true);
    }
  };

  if (connectionActive) {
    const connectionLabel = identity.walletConnection.state === "CONNECTING"
      ? "Connecting…"
      : identity.walletConnection.state === "SLOW" ? "Wallet delayed" : "Wallet help";
    return <div className="walletMenu">
      <button
        ref={menuTrigger}
        className="wallet live connectTrigger"
        type="button"
        aria-expanded={connectionOpen}
        aria-controls="wallet-connection-dialog"
        onClick={() => setConnectionOpen(true)}
      >{connectionLabel}</button>
      {connectionOpen ? <OverlayPortal>
        <button className="walletBackdrop" type="button" aria-label="Close wallet connection status" onClick={() => setConnectionOpen(false)} />
        <div ref={menuDialog} tabIndex={-1} className="walletPopover walletOverlayPopover privyWalletPopover" id="wallet-connection-dialog" role="dialog" aria-modal="true" aria-label="Wallet connection status" data-rmt-overlay-dialog="wallet-connection">
          <div className="walletPopoverHeader">
            <div><strong>Connect your trading wallet</strong><span>RMT will use only the exact wallet you choose.</span></div>
            <button type="button" aria-label="Close wallet connection status" onClick={() => setConnectionOpen(false)}>×</button>
          </div>
          <WalletConnectionPanel connection={identity.walletConnection}
            wallets={externalWallets.map((wallet) => ({ key: wallet.key, name: wallet.name, address: wallet.address }))}
            retry={() => { setConnectionOpen(true); identity.retryWalletConnection(); }} chooseAnother={beginExternalConnection}
            cancel={() => { identity.clearTradingWalletPreference(); setConnectionOpen(false); }} select={key => void chooseWallet(key)} />
          {message ? <p className="walletError" role="status">{message}</p> : null}
        </div>
      </OverlayPortal> : null}
    </div>;
  }

  if (!identity.ready) {
    return <button className="wallet live connectTrigger" type="button" disabled>{compact ? "Loading…" : "Wallet loading…"}</button>;
  }

  if (!connectedTradingWallet || !activeAccountAddress) {
    if (identity.authenticated && ["checking", "creating", "connecting", "failed"].includes(identity.embeddedWalletProvisioning)) {
      const failed = identity.embeddedWalletProvisioning === "failed";
      return <div className="walletProvisioning" role="status">
        <span><strong>{failed ? "RMT wallet setup paused" : "Preparing your RMT wallet"}</strong><small>{failed
          ? identity.embeddedWalletProvisioningError
          : identity.embeddedWalletProvisioning === "connecting"
            ? "Activating the exact Robinhood Chain signing account…"
            : "Creating or restoring your self-custodial wallet…"}</small></span>
        {failed || identity.embeddedWalletProvisioning === "connecting" ? <div className="walletProvisioningActions">
          {failed ? <>
            <button className="wallet live connectTrigger" type="button" onClick={identity.retryEmbeddedWalletProvisioning}>
              {identity.embeddedWalletRecovery === "reload-session"
                ? "Reload wallet connection"
                : identity.embeddedWalletRecovery === "reauthenticate" ? "Sign in again" : "Retry RMT wallet"}
            </button>
            {identity.embeddedWalletRecovery === "reload-session" ? <button className="wallet live connectTrigger" type="button" onClick={identity.restartEmbeddedWalletSession}>
              Sign out and sign in again
            </button> : null}
          </> : null}
          {externalWallets.map((wallet) => <button key={wallet.key} className="wallet live connectTrigger" type="button" onClick={() => void chooseWallet(wallet.key)}>
            Use {wallet.name}
          </button>)}
          <button className="wallet live connectTrigger" type="button" onClick={beginExternalConnection}>Connect existing wallet</button>
        </div> : null}
      </div>;
    }
    if (identity.authenticated && (identity.walletSelectionRequired || displayedWallets.length > 0)) {
      return (
        <div className="walletMenu">
          <button
            ref={menuTrigger}
            className="wallet live connectTrigger"
            type="button"
            aria-expanded={open}
            aria-controls="trading-wallet-choice-dialog"
            onClick={() => setOpen((value) => !value)}
          >
            {displayedWallets.length > 0
              ? compact ? "Choose wallet" : "Choose trading wallet"
              : compact ? "Reconnect" : "Reconnect trading wallet"}
          </button>
          {open && <OverlayPortal>
            <button className="walletBackdrop" type="button" aria-label="Close wallet menu" onClick={close} />
            <div ref={menuDialog} tabIndex={-1} className="walletPopover walletOverlayPopover privyWalletPopover" id="trading-wallet-choice-dialog" role="dialog" aria-modal="true" aria-label="Choose the active trading wallet">
              <div className="walletPopoverHeader">
                <div>
                  <strong>{displayedWallets.length > 0 ? "Choose the signing wallet" : "Reconnect your trading wallet"}</strong>
                  <span>{displayedWallets.length > 0
                    ? "RMT will use only the wallet you choose."
                    : "Your existing wallet is still linked. Reconnect it before RMT can quote or trade."}</span>
                </div>
                <button type="button" aria-label="Close wallet menu" onClick={close}>×</button>
              </div>
              <div className="privyWalletList">
                {displayedWallets.map((wallet) => {
                  return <button
                    type="button"
                    key={wallet.key}
                    onClick={() => void chooseWallet(wallet.key)}
                  >
                    <span><strong>{wallet.name}</strong><small>{shortAddress(wallet.address)}</small></span>
                    <em>USE</em>
                  </button>;
                })}
              </div>
              <div className="privyWalletActions">
                <button type="button" onClick={() => {
                  close();
                  beginExternalConnection();
                }}>{displayedWallets.length > 0 ? "Connect another wallet" : "Connect existing wallet"}</button>
              </div>
              {(message || identity.walletConnectionError) && <p className="walletError" role="status">{message || identity.walletConnectionError}</p>}
            </div>
          </OverlayPortal>}
        </div>
      );
    }
    return (
      <div className="walletMenu">
        <button
          className="wallet live connectTrigger"
          type="button"
          onClick={() => {
            setMessage("");
            identity.clearWalletConnectionError();
            recordExperienceStage("wallet_connect_started");
            identity.login();
          }}
        >
          Sign in
        </button>
        {walletEnvironment === "mobile-wallet-browser" && !compact ? <small className="walletBrowserLoginNote">Email, passkey, or this wallet are available here. Open RMT in Safari or Chrome to use Google sign-in.</small> : null}
        {(message || identity.walletConnectionError) && <span className="networkSwitchError" role="alert">{message || identity.walletConnectionError}</span>}
      </div>
    );
  }

  if (chainId !== targetChain.id) {
    return (
      <div className="networkSwitchGroup">
        <button className="wallet network" disabled={isSwitching} onClick={() => { resetSwitch(); switchChain({ chainId: targetChain.id }); }}>
          {isSwitching ? "Switching…" : compact ? "Switch network" : `Switch to ${targetChain.name}`}
        </button>
        {switchError && <span className="networkSwitchError" role="alert">{safeWalletMessage(switchError.message)}</span>}
      </div>
    );
  }

  const signOut = async () => {
    setMessage("");
    try {
      disconnectWagmi();
      if (identity.authenticated) await identity.logout();
      setFundingOpen(false);
      setReceiveOpen(false);
      setTransferOpen(false);
      close();
      setMessage("Wallet disconnected from RMT on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? safeWalletMessage(error.message) : "Wallet sign-out did not complete.");
    }
  };

  return (
    <>
      <div className="walletConnectedActions">
        {showFunding && pathname !== "/deploy-consent-testnet" && <FundWalletButton target={target} open={fundingOpen} onOpenChange={setFundingOpen} />}
        <div className="walletMenu">
          <button ref={menuTrigger} className="wallet live" type="button" aria-expanded={open} aria-controls="privy-wallet-dialog" onClick={() => setOpen((value) => !value)}>
            {shortAddress(activeAccountAddress)}
          </button>
          {open && <OverlayPortal>
            <button className="walletBackdrop" type="button" aria-label="Close wallet menu" onClick={close} />
            <div ref={menuDialog} tabIndex={-1} className="walletPopover walletOverlayPopover privyWalletPopover" id="privy-wallet-dialog" role="dialog" aria-modal="true" aria-label="Manage wallets">
              <div className="walletPopoverHeader">
                <div><strong>Your trading wallets</strong><span>Choose which wallet RMT uses. You remain in control.</span></div>
                <button type="button" aria-label="Close wallet menu" onClick={close}>×</button>
              </div>
              <div className="privyActiveWalletSummary">
                <span><small>ACTIVE WALLET</small><strong>{activeWallet?.name ?? "Trading wallet"} · {targetChain.name}</strong></span>
                <code title={activeAccountAddress}>{activeAccountAddress}</code>
              </div>
              <div className="privyAssetActions" aria-label="Wallet actions">
                {showFunding && pathname !== "/deploy-consent-testnet" && <button type="button" onClick={() => { close(); setFundingOpen(true); }}><strong>Deposit</strong><span>Robinhood Chain</span></button>}
                <button type="button" onClick={() => { close(); setReceiveOpen(true); }}><strong>Receive</strong><span>Full address</span></button>
                <button type="button" onClick={() => { close(); setTransferOpen(true); }}><strong>Send</strong><span>Review transfer</span></button>
                <a href="/" onClick={close}><strong>Trade</strong><span>RMT route checks</span></a>
              </div>
              <div className="privyWalletList">
                {displayedWallets.map((wallet) => {
                  const active = wallet.key === identity.activeWalletKey;
                  return <button
                    type="button"
                    className={active ? "active" : ""}
                    key={wallet.key}
                    disabled={active}
                    onClick={() => void chooseWallet(wallet.key)}
                  >
                    <span><strong>{wallet.name}</strong><small>{shortAddress(wallet.address)}</small></span>
                    <em>{active ? "ACTIVE" : "USE"}</em>
                  </button>;
                })}
              </div>
              {walletFirstTerminal
                && identity.activeWalletKind === "external"
                && identity.activeSignerAuthority?.adapter === "direct"
                && identity.activeSignerAuthority.originConnectorType === "injected"
                ? <InjectedSignerSelection /> : null}
              <div className="privyWalletActions">
                <button type="button" onClick={() => {
                  beginExternalConnection();
                }}>Connect existing wallet</button>
                <button type="button" onClick={() => void signOut()}>Disconnect from RMT</button>
              </div>
              {!walletFirstTerminal && <p className="privyProfileBoundary">
                Your authenticated wallet session protects exact recipient binding for RMT trading. No social profile is required, you choose the active wallet, and RMT never receives its private key.
              </p>}
              {(message || identity.walletConnectionError) && <p className="walletError" role="status">{message || identity.walletConnectionError}</p>}
            </div>
          </OverlayPortal>}
        </div>
      </div>
      <WalletReceiveDialog address={activeAccountAddress as Address} open={receiveOpen} target={target} onClose={closeReceive} />
      {identity.activeWalletKey && identity.activeWalletKind && identity.activeSignerAuthority
        ? <WalletTransferDialog
            address={activeAccountAddress as Address}
            open={transferOpen}
            target={target}
            selectedWalletKey={identity.activeWalletKey}
            selectedWalletKind={identity.activeWalletKind}
            selectedSignerAuthority={identity.activeSignerAuthority}
            onClose={closeTransfer}
          />
        : null}
    </>
  );
}
