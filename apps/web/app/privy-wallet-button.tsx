"use client";

import { useConnectOrCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { recordExperienceStage } from "../lib/experience-funnel";
import { FundWalletButton } from "./fund-wallet-button";
import { WalletReceiveDialog } from "./wallet-receive-dialog";
import { WalletTransferDialog } from "./wallet-transfer-dialog";

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
  const [requestedWalletAddress, setRequestedWalletAddress] = useState("");
  const pathname = usePathname();
  const { ready, authenticated, logout, connectWallet } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address, chainId, isConnected } = useAccount();
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const { switchChain, isPending: isSwitching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const { connectOrCreateWallet } = useConnectOrCreateWallet({
    onSuccess: async ({ wallet }) => {
      setRequestedWalletAddress(wallet.address.toLowerCase());
      setMessage("");
      recordExperienceStage("wallet_connect_started");
    },
    onError: async (errorCode) => setMessage(safeWalletMessage(String(errorCode)))
  });
  const activeWallet = wallets.find((wallet) => wallet.address.toLowerCase() === address?.toLowerCase());
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!requestedWalletAddress) return;
    const requestedWallet = wallets.find((wallet) => wallet.address.toLowerCase() === requestedWalletAddress);
    if (!requestedWallet) return;
    let cancelled = false;
    void setActiveWallet(requestedWallet).then(() => {
      if (!cancelled) setRequestedWalletAddress("");
    }).catch((error) => {
      if (!cancelled) {
        setMessage(safeWalletMessage(error instanceof Error ? error.message : ""));
        setRequestedWalletAddress("");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [requestedWalletAddress, setActiveWallet, wallets]);

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

  if (!isConnected || !address) {
    return (
      <div className="walletMenu">
        <button
          className="wallet live connectTrigger"
          type="button"
          onClick={() => {
            setMessage("");
            recordExperienceStage("wallet_connect_started");
            connectOrCreateWallet();
          }}
        >
          Connect or create wallet
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
      if (authenticated) await logout();
      else activeWallet?.disconnect();
      close();
    } catch (error) {
      setMessage(error instanceof Error ? safeWalletMessage(error.message) : "Wallet sign-out did not complete.");
    }
  };

  return (
    <>
      <div className="walletConnectedActions">
        {showFunding && pathname !== "/deploy-consent-testnet" && <FundWalletButton open={fundingOpen} onOpenChange={setFundingOpen} />}
        <div className="walletMenu">
          <button className="wallet live" type="button" aria-expanded={open} aria-controls="privy-wallet-dialog" onClick={() => setOpen((value) => !value)}>
            {shortAddress(address)}
          </button>
          {open && <>
            <button className="walletBackdrop" type="button" aria-label="Close wallet menu" onClick={close} />
            <div className="walletPopover privyWalletPopover" id="privy-wallet-dialog" role="dialog" aria-modal="true" aria-label="Manage wallets">
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
                {wallets.map((wallet) => {
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
                <button type="button" onClick={() => connectWallet()}>Add another wallet</button>
                <button type="button" onClick={() => void signOut()}>{authenticated ? "Sign out" : "Disconnect"}</button>
              </div>
              <p className="privyProfileBoundary">
                Wallets authorize trades. Your private RMT profile remains tied to its profile sign-in, so changing between MetaMask and an RMT Wallet cannot overwrite it. <a href="/profile" onClick={close}>Open Profile →</a>
              </p>
              {message && <p className="walletError" role="status">{message}</p>}
            </div>
          </>}
        </div>
      </div>
      <WalletReceiveDialog address={address as Address} open={receiveOpen} target={target} onClose={() => setReceiveOpen(false)} />
      <WalletTransferDialog address={address as Address} open={transferOpen} target={target} onClose={() => setTransferOpen(false)} />
    </>
  );
}
