"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { recordExperienceStage } from "../lib/experience-funnel";
import { metaMaskDappLink, walletBrowserEnvironment } from "../lib/mobile-wallet-link";
import {
  externalEthereumWallets,
  walletGatewayDisplayName,
  walletGatewayKey
} from "../lib/wallet-gateway";
import { FundWalletButton } from "./fund-wallet-button";
import { WalletReceiveDialog } from "./wallet-receive-dialog";
import { WalletTransferDialog } from "./wallet-transfer-dialog";
import { OverlayPortal } from "./overlay-portal";
import { useRmtIdentity } from "./rmt-identity";

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
  const [fundingOpen, setFundingOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [message, setMessage] = useState("");
  const pathname = usePathname();
  const walletFirstTerminal = pathname === "/" || pathname === "/vnext" || pathname.startsWith("/vnext/");
  const identity = useRmtIdentity();
  const { ready, authenticated } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { address, chainId, isConnected } = useAccount();
  const { disconnect: disconnectWagmi } = useDisconnect();
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const { switchChain, isPending: isSwitching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const [walletEnvironment] = useState(() => {
    if (typeof window === "undefined") return "desktop" as const;
    return walletBrowserEnvironment(window.navigator.userAgent, Boolean((window as Window & { ethereum?: unknown }).ethereum));
  });
  const mobileMetaMaskUrl = walletEnvironment === "mobile-browser" && typeof window !== "undefined"
    ? metaMaskDappLink(window.location.href)
    : "";
  const externalWallets = useMemo(() => externalEthereumWallets(wallets), [wallets]);
  const activeExternalWallet = identity.activeWalletKey
    ? externalWallets.find((wallet) => walletGatewayKey(wallet) === identity.activeWalletKey)
    : undefined;
  const activeWallet = walletFirstTerminal
    ? activeExternalWallet
    : wallets.find((wallet) => wallet.address.toLowerCase() === address?.toLowerCase());
  const displayedWallets = walletFirstTerminal ? externalWallets : wallets;
  const connectedTradingWallet = Boolean(
    authenticated
    && isConnected
    && address
    && (!walletFirstTerminal || identity.activeWalletKind === "external")
  );
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, open]);

  if (!ready || (authenticated && !walletsReady)) {
    return <button className="wallet live connectTrigger" type="button" disabled>{compact ? "Loading…" : "Wallet loading…"}</button>;
  }

  const chooseWallet = async (walletKey: string) => {
    setMessage("");
    identity.clearWalletConnectionError();
    try {
      await identity.selectTradingWallet(walletKey);
      close();
    } catch (error) {
      setMessage(safeWalletMessage(error instanceof Error ? error.message : ""));
    }
  };

  if (!connectedTradingWallet || !address) {
    if (walletFirstTerminal && identity.walletSelectionRequired) {
      return (
        <div className="walletMenu">
          <button
            className="wallet live connectTrigger"
            type="button"
            aria-expanded={open}
            aria-controls="trading-wallet-choice-dialog"
            onClick={() => setOpen((value) => !value)}
          >
            {compact ? "Choose wallet" : "Choose trading wallet"}
          </button>
          {open && <OverlayPortal>
            <button className="walletBackdrop" type="button" aria-label="Close wallet menu" onClick={close} />
            <div className="walletPopover walletOverlayPopover privyWalletPopover" id="trading-wallet-choice-dialog" role="dialog" aria-modal="true" aria-label="Choose the active trading wallet">
              <div className="walletPopoverHeader">
                <div><strong>Choose the signing wallet</strong><span>More than one wallet exposes this address. RMT will not guess.</span></div>
                <button type="button" aria-label="Close wallet menu" onClick={close}>×</button>
              </div>
              <div className="privyWalletList" role="list">
                {externalWallets.map((wallet) => {
                  const walletKey = walletGatewayKey(wallet);
                  return <button
                    type="button"
                    role="listitem"
                    key={walletKey}
                    onClick={() => void chooseWallet(walletKey)}
                  >
                    <span><strong>{walletGatewayDisplayName(wallet)}</strong><small>{shortAddress(wallet.address)}</small></span>
                    <em>USE</em>
                  </button>;
                })}
              </div>
              {(message || identity.walletConnectionError) && <p className="walletError" role="status">{message || identity.walletConnectionError}</p>}
            </div>
          </OverlayPortal>}
        </div>
      );
    }
    if (walletEnvironment === "mobile-wallet-browser") {
      return (
        <div className="walletMenu">
          <button
            className="wallet live connectTrigger"
            type="button"
            onClick={() => {
              setMessage("");
              identity.clearWalletConnectionError();
              recordExperienceStage("wallet_connect_started");
              walletFirstTerminal ? identity.connectTradingWallet() : identity.login();
            }}
          >
            {compact ? "Connect" : "Connect this wallet"}
          </button>
          {(message || identity.walletConnectionError) && <span className="networkSwitchError" role="alert">{message || identity.walletConnectionError}</span>}
        </div>
      );
    }
    if (mobileMetaMaskUrl) {
      return (
        <div className="walletMenu mobileWalletEntry">
          <button
            className="wallet live connectTrigger"
            type="button"
            aria-expanded={open}
            aria-controls="mobile-wallet-entry-dialog"
            onClick={() => setOpen((value) => !value)}
          >
            {compact ? "Connect" : "Connect wallet"}
          </button>
          {open && <OverlayPortal>
            <button className="walletBackdrop" type="button" aria-label="Close wallet menu" onClick={close} />
            <div className="walletPopover walletOverlayPopover mobileWalletChoice" id="mobile-wallet-entry-dialog" role="dialog" aria-modal="true" aria-label="Choose a mobile wallet">
              <div className="walletPopoverHeader">
                <div><strong>Choose your wallet</strong><span>RMT connects to an external wallet you control.</span></div>
                <button type="button" aria-label="Close wallet menu" onClick={close}>×</button>
              </div>
              <div className="connectorList">
                <a
                  className="connectorOption"
                  href={mobileMetaMaskUrl}
                  onClick={() => {
                    recordExperienceStage("wallet_connect_started");
                    close();
                  }}
                >
                  <span>MetaMask</span>
                  <small>Open this exact RMT page in the MetaMask mobile app</small>
                </a>
                <button
                  className="connectorOption"
                  type="button"
                  onClick={() => {
                    close();
                    setMessage("");
                    identity.clearWalletConnectionError();
                    recordExperienceStage("wallet_connect_started");
                    walletFirstTerminal ? identity.connectTradingWallet() : identity.login();
                  }}
                >
                  <span>Installed or mobile wallet</span>
                  <small>Use an EIP-6963 wallet such as Rabby, or WalletConnect</small>
                </button>
              </div>
            </div>
          </OverlayPortal>}
          {(message || identity.walletConnectionError) && <span className="networkSwitchError" role="alert">{message || identity.walletConnectionError}</span>}
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
            walletFirstTerminal ? identity.connectTradingWallet() : identity.login();
          }}
        >
          {compact ? "Connect" : walletFirstTerminal ? "Connect trading wallet" : "Sign in or create wallet"}
        </button>
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
      await Promise.allSettled(
        externalWallets.map((wallet) => Promise.resolve(wallet.disconnect()))
      );
      disconnectWagmi();
      identity.clearTradingWalletPreference();
      if (authenticated) await identity.logout();
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
          <button className="wallet live" type="button" aria-expanded={open} aria-controls="privy-wallet-dialog" onClick={() => setOpen((value) => !value)}>
            {shortAddress(address)}
          </button>
          {open && <OverlayPortal>
            <button className="walletBackdrop" type="button" aria-label="Close wallet menu" onClick={close} />
            <div className="walletPopover walletOverlayPopover privyWalletPopover" id="privy-wallet-dialog" role="dialog" aria-modal="true" aria-label="Manage wallets">
              <div className="walletPopoverHeader">
                <div><strong>Your trading wallets</strong><span>Choose which wallet RMT uses. You remain in control.</span></div>
                <button type="button" aria-label="Close wallet menu" onClick={close}>×</button>
              </div>
              <div className="privyActiveWalletSummary">
                <span><small>ACTIVE WALLET</small><strong>{activeWallet ? walletGatewayDisplayName(activeWallet) : "External wallet"} · {targetChain.name}</strong></span>
                <code title={address}>{address}</code>
              </div>
              <div className="privyAssetActions" aria-label="Wallet actions">
                {showFunding && pathname !== "/deploy-consent-testnet" && <button type="button" onClick={() => { close(); setFundingOpen(true); }}><strong>Deposit</strong><span>Privy funding</span></button>}
                <button type="button" onClick={() => { close(); setReceiveOpen(true); }}><strong>Receive</strong><span>Full address</span></button>
                <button type="button" onClick={() => { close(); setTransferOpen(true); }}><strong>Send</strong><span>Review transfer</span></button>
                <a href="/" onClick={close}><strong>Trade</strong><span>RMT route checks</span></a>
              </div>
              <div className="privyWalletList" role="list">
                {displayedWallets.map((wallet) => {
                  const walletKey = walletGatewayKey(wallet);
                  const active = walletFirstTerminal
                    ? walletKey === identity.activeWalletKey
                    : wallet.address.toLowerCase() === address.toLowerCase();
                  return <button
                    type="button"
                    role="listitem"
                    className={active ? "active" : ""}
                    key={walletKey}
                    disabled={active}
                    onClick={() => void chooseWallet(walletKey)}
                  >
                    <span><strong>{walletGatewayDisplayName(wallet)}</strong><small>{shortAddress(wallet.address)}</small></span>
                    <em>{active ? "ACTIVE" : "USE"}</em>
                  </button>;
                })}
              </div>
              <div className="privyWalletActions">
                <button type="button" onClick={() => {
                  identity.clearWalletConnectionError();
                  identity.connectTradingWallet();
                }}>Add another wallet</button>
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
      <WalletReceiveDialog address={address as Address} open={receiveOpen} target={target} onClose={() => setReceiveOpen(false)} />
      <WalletTransferDialog address={address as Address} open={transferOpen} target={target} onClose={() => setTransferOpen(false)} />
    </>
  );
}
