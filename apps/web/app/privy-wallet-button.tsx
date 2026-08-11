"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { recordExperienceStage } from "../lib/experience-funnel";
import { metaMaskDappLink, walletBrowserEnvironment } from "../lib/mobile-wallet-link";
import { FundWalletButton } from "./fund-wallet-button";
import { WalletReceiveDialog } from "./wallet-receive-dialog";
import { WalletTransferDialog } from "./wallet-transfer-dialog";
import { OverlayPortal } from "./overlay-portal";
import { useRmtIdentity } from "./rmt-identity";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function walletName(walletClientType: string) {
  if (walletClientType === "privy") return "RMT Wallet";
  if (walletClientType === "wallet_connect") return "Mobile wallet";
  return walletClientType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeWalletMessage(message: string) {
  if (/rejected|denied|cancelled|canceled|exited/i.test(message)) return "Wallet setup was cancelled. Nothing changed.";
  if (/chain|network/i.test(message)) return "The wallet could not switch to Robinhood Chain.";
  return "The wallet action did not complete. Try again or choose another wallet.";
}

export function PrivyWalletButton({
  target = "testnet",
  showFunding = true
}: {
  target?: "testnet" | "mainnet";
  returnTo?: string;
  showFunding?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [message, setMessage] = useState("");
  const pathname = usePathname();
  const walletFirstTerminal = pathname === "/vnext" || pathname.startsWith("/vnext/");
  const identity = useRmtIdentity();
  const { ready, authenticated, logout, connectWallet } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
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
  const activeWallet = wallets.find((wallet) => wallet.address.toLowerCase() === address?.toLowerCase());
  const externalWallets = useMemo(
    () => wallets.filter((wallet) => wallet.walletClientType !== "privy"),
    [wallets]
  );
  const displayedWallets = walletFirstTerminal ? externalWallets : wallets;
  const connectedTradingWallet = Boolean(
    isConnected
    && address
    && (!walletFirstTerminal || activeWallet?.walletClientType !== "privy")
  );
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!walletFirstTerminal || !walletsReady || activeWallet?.walletClientType !== "privy") return;
    const preferredExternalWallet = externalWallets[0];
    if (!preferredExternalWallet) return;
    void setActiveWallet(preferredExternalWallet).catch((error) => {
      setMessage(safeWalletMessage(error instanceof Error ? error.message : ""));
    });
  }, [activeWallet?.walletClientType, externalWallets, setActiveWallet, walletFirstTerminal, walletsReady]);

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
    return <button className="wallet live connectTrigger" type="button" disabled>Wallet loading…</button>;
  }

  if (!connectedTradingWallet || !address) {
    if (walletEnvironment === "mobile-wallet-browser") {
      return (
        <div className="walletMenu">
          <button
            className="wallet live connectTrigger"
            type="button"
            onClick={() => {
              setMessage("");
              recordExperienceStage("wallet_connect_started");
              walletFirstTerminal ? identity.connectTradingWallet() : identity.login();
            }}
          >
            Connect this wallet
          </button>
          {message && <span className="networkSwitchError" role="alert">{message}</span>}
        </div>
      );
    }
    if (mobileMetaMaskUrl) {
      return (
        <div className="walletMenu mobileWalletEntry">
          <a
            className="wallet live connectTrigger mobileMetaMaskTrigger"
            href={mobileMetaMaskUrl}
            onClick={() => recordExperienceStage("wallet_connect_started")}
          >
            MetaMask
          </a>
          <button
            className="wallet mobileOtherWalletTrigger"
            type="button"
            aria-label="Use Rabby or another external wallet"
            onClick={() => {
              setMessage("");
              recordExperienceStage("wallet_connect_started");
              walletFirstTerminal ? identity.connectTradingWallet() : identity.login();
            }}
          >
            Rabby / other
          </button>
          {message && <span className="networkSwitchError" role="alert">{message}</span>}
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
            recordExperienceStage("wallet_connect_started");
            walletFirstTerminal ? identity.connectTradingWallet() : identity.login();
          }}
        >
          {walletFirstTerminal ? "Connect trading wallet" : "Sign in or create wallet"}
        </button>
        {message && <span className="networkSwitchError" role="alert">{message}</span>}
      </div>
    );
  }

  if (chainId !== targetChain.id) {
    return (
      <div className="networkSwitchGroup">
        <button className="wallet network" disabled={isSwitching} onClick={() => { resetSwitch(); switchChain({ chainId: targetChain.id }); }}>
          {isSwitching ? "Switching…" : `Switch to ${targetChain.name}`}
        </button>
        {switchError && <span className="networkSwitchError" role="alert">{safeWalletMessage(switchError.message)}</span>}
      </div>
    );
  }

  const signOut = async () => {
    setMessage("");
    try {
      await Promise.allSettled(
        wallets
          .filter((wallet) => wallet.walletClientType !== "privy")
          .map((wallet) => Promise.resolve(wallet.disconnect()))
      );
      disconnectWagmi();
      if (authenticated) await logout();
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
                <span><small>ACTIVE WALLET</small><strong>{walletName(activeWallet?.walletClientType ?? "wallet")} · {targetChain.name}</strong></span>
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
                  const active = wallet.address.toLowerCase() === address.toLowerCase();
                  return <button
                    type="button"
                    role="listitem"
                    className={active ? "active" : ""}
                    key={`${wallet.walletClientType}:${wallet.address}`}
                    disabled={active}
                    onClick={() => void setActiveWallet(wallet).then(close).catch((error) => setMessage(safeWalletMessage(error instanceof Error ? error.message : "")))}
                  >
                    <span><strong>{walletName(wallet.walletClientType)}</strong><small>{shortAddress(wallet.address)}</small></span>
                    <em>{active ? "ACTIVE" : "USE"}</em>
                  </button>;
                })}
              </div>
              <div className="privyWalletActions">
                <button type="button" onClick={() => connectWallet({
                  description: "Connect an external wallet for RMT trading.",
                  walletChainType: "ethereum-only",
                  walletList: ["metamask", "coinbase_wallet", "detected_ethereum_wallets", "wallet_connect"]
                })}>Add another wallet</button>
                <button type="button" onClick={() => void signOut()}>Disconnect from RMT</button>
              </div>
              {!walletFirstTerminal && <p className="privyProfileBoundary">
                One RMT account carries your private profile and wallet choices across the terminal. You still choose the active wallet, and RMT never receives its private key. <a href="/profile" onClick={close}>Open Profile →</a>
              </p>}
              {message && <p className="walletError" role="status">{message}</p>}
            </div>
          </OverlayPortal>}
        </div>
      </div>
      <WalletReceiveDialog address={address as Address} open={receiveOpen} target={target} onClose={() => setReceiveOpen(false)} />
      <WalletTransferDialog address={address as Address} open={transferOpen} target={target} onClose={() => setTransferOpen(false)} />
    </>
  );
}
