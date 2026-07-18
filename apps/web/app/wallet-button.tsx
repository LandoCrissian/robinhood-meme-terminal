"use client";

import { useCallback, useEffect, useState } from "react";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { FundWalletButton } from "./fund-wallet-button";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function walletLabel(name: string) {
  if (name === "WalletConnect") return "Robinhood Wallet / mobile";
  if (name === "Injected") return "Browser wallet";
  return name;
}

function walletDescription(name: string) {
  if (name === "WalletConnect") return "Choose Robinhood Wallet or another Robinhood Chain-compatible wallet";
  if (name === "MetaMask") return "Opens the browser extension or MetaMask mobile app";
  if (name === "Coinbase Wallet") return "Opens Coinbase Wallet on mobile or desktop";
  return "Use a wallet already installed in this browser";
}

function walletErrorMessage(message: string) {
  if (/rejected|denied|cancelled|canceled/i.test(message)) return "Connection was cancelled in the wallet. Try again when you are ready.";
  if (/provider not found|not installed|no provider/i.test(message)) return "No browser wallet was detected. Open RMT inside your wallet browser or use Robinhood Wallet / mobile.";
  if (/already pending|request.*pending/i.test(message)) return "A wallet request is already open. Return to your wallet to finish or cancel it.";
  if (/chain|network/i.test(message)) return "The wallet could not switch to Robinhood Chain. Open the setup guide, add the network, then try again.";
  return "The wallet did not connect. Close any stale wallet prompt and try again.";
}

export function WalletButton({
  target = "testnet",
  returnTo,
  showFunding = true
}: {
  target?: "testnet" | "mainnet";
  returnTo?: string;
  showFunding?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string>();
  const [currentUrl, setCurrentUrl] = useState("https://www.rmtlaunch.fun");
  const pathname = usePathname();
  const { address, chainId, isConnected } = useAccount();
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const { connectors, connect, error, isPending, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const hasWalletConnect = connectors.some((connector) => connector.name === "WalletConnect");
  const metaMaskUrl = `https://metamask.app.link/dapp/${currentUrl.replace(/^https?:\/\//, "")}`;

  const clearPendingConnection = useCallback(() => {
    reset();
    setPendingConnectorUid(undefined);
  }, [reset]);

  const closeMenu = useCallback(() => {
    clearPendingConnection();
    setOpen(false);
  }, [clearPendingConnection]);

  useEffect(() => {
    setCurrentUrl(returnTo ? new URL(returnTo, window.location.origin).toString() : window.location.href);
    if (isConnected) {
      setOpen(false);
      setPendingConnectorUid(undefined);
    }
  }, [isConnected, returnTo]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeMenu, open]);

  if (!isConnected) {
    return (
      <div className="walletMenu">
        <button className="wallet live connectTrigger" type="button" aria-expanded={open} aria-controls="wallet-connect-dialog" onClick={() => open ? closeMenu() : setOpen(true)}>
          Connect wallet
        </button>
        {open && <><button className="walletBackdrop" type="button" aria-label="Close wallet menu" onClick={closeMenu} /><div className="walletPopover" id="wallet-connect-dialog" role="dialog" aria-modal="true" aria-label="Connect a wallet">
          <div className="walletPopoverHeader"><div><strong>Choose your wallet</strong><span>RMT never sees your recovery phrase.</span></div><button type="button" aria-label="Close wallet menu" onClick={closeMenu}>×</button></div>
          <div className="connectorList">{connectors.map((connector) => (
            <button className="connectorOption" key={connector.uid} disabled={isPending} onClick={() => { reset(); setPendingConnectorUid(connector.uid); connect({ connector }); }}>
              <span>{isPending && pendingConnectorUid === connector.uid ? `Opening ${walletLabel(connector.name)}…` : walletLabel(connector.name)}</span>
              <small>{walletDescription(connector.name)}</small>
            </button>
          ))}</div>
          {isPending && <div className="walletPending" role="status"><span>Waiting for your wallet. On mobile, approve there and return to RMT.</span><button type="button" onClick={clearPendingConnection}>Try another wallet</button></div>}
          <div className="mobileWalletLinks">
            <strong>Using Safari or mobile Chrome?</strong>
            <span>Choose Robinhood Wallet / mobile above, or open RMT directly inside MetaMask.</span>
            <div><a href={metaMaskUrl}>Open in MetaMask ↗</a></div>
          </div>
          <div className="walletQuickGuide">
            <strong>Fastest supported paths</strong>
            <span><b>Robinhood Wallet:</b> {hasWalletConnect ? "choose Robinhood Wallet / mobile, then select Robinhood Wallet." : "open RMT from its Web3 globe."}</span>
            <span><b>Inside a wallet browser:</b> choose Browser wallet.</span>
            <span><b>Desktop:</b> use an installed extension{hasWalletConnect ? " or scan WalletConnect with Robinhood Wallet." : "."}</span>
            <a href="https://robinhood.com/us/en/support/articles/connect-to-dapps/" target="_blank" rel="noreferrer">Official wallet connection guide ↗</a>
          </div>
          {error && <p className="walletError" role="alert">{walletErrorMessage(error.message)}</p>}
        </div></>}
      </div>
    );
  }

  if (chainId !== targetChain.id) {
    return (
      <div className="networkSwitchGroup">
        <button className="wallet network" disabled={isSwitching} onClick={() => { resetSwitch(); switchChain({ chainId: targetChain.id }); }}>
          {isSwitching ? "Switching…" : `Switch to ${targetChain.name}`}
        </button>
        {switchError && <span className="networkSwitchError" role="alert">{walletErrorMessage(switchError.message)} <a href="https://docs.robinhood.com/chain/add-network-to-wallet/" target="_blank" rel="noreferrer">Open setup guide ↗</a></span>}
      </div>
    );
  }

  return (
    <div className="walletConnectedActions">
      {showFunding && pathname !== "/deploy-consent-testnet" && <FundWalletButton />}
      <button className="wallet live" title="Disconnect wallet" onClick={() => disconnect()}>
        {address ? shortAddress(address) : "Connected"}
      </button>
    </div>
  );
}
