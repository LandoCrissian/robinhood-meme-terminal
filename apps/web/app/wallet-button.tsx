"use client";

import { useEffect, useState } from "react";
import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function walletLabel(name: string) {
  if (name === "WalletConnect") return "Mobile wallet";
  if (name === "Injected") return "Browser wallet";
  return name;
}

function walletDescription(name: string) {
  if (name === "WalletConnect") return "Robinhood Wallet, MetaMask, Phantom and hundreds more";
  if (name === "MetaMask") return "Opens the browser extension or MetaMask mobile app";
  if (name === "Coinbase Wallet") return "Opens Coinbase Wallet on mobile or desktop";
  return "Use a wallet already installed in this browser";
}

function walletErrorMessage(message: string) {
  if (/rejected|denied|cancelled|canceled/i.test(message)) return "Connection was cancelled in the wallet. Try again when you are ready.";
  if (/provider not found|not installed|no provider/i.test(message)) return "No browser wallet was detected. Open RMT inside your wallet browser or use Mobile wallet.";
  if (/already pending|request.*pending/i.test(message)) return "A wallet request is already open. Return to your wallet to finish or cancel it.";
  if (/chain|network/i.test(message)) return "The wallet could not switch networks. Add Robinhood Chain in the wallet, then try again.";
  return "The wallet did not connect. Close any stale wallet prompt and try again.";
}

export function WalletButton({ target = "testnet" }: { target?: "testnet" | "mainnet" }) {
  const [open, setOpen] = useState(false);
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string>();
  const [currentUrl, setCurrentUrl] = useState("https://www.rmtlaunch.fun");
  const { address, chainId, isConnected } = useAccount();
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const { connectors, connect, error, isPending, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const hasWalletConnect = connectors.some((connector) => connector.name === "WalletConnect");
  const metaMaskUrl = `https://metamask.app.link/dapp/${currentUrl.replace(/^https?:\/\//, "")}`;
  const phantomUrl = `https://phantom.app/ul/browse/${encodeURIComponent(currentUrl)}?ref=${encodeURIComponent("https://www.rmtlaunch.fun")}`;

  useEffect(() => {
    setCurrentUrl(window.location.href);
    if (isConnected) {
      setOpen(false);
      setPendingConnectorUid(undefined);
    }
  }, [isConnected]);

  if (!isConnected) {
    return (
      <div className="walletMenu">
        <button className="wallet live connectTrigger" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Connect wallet
        </button>
        {open && <div className="walletPopover" role="dialog" aria-label="Connect a wallet">
          <div className="walletPopoverHeader"><div><strong>Choose your wallet</strong><span>RMT never sees your recovery phrase.</span></div><button type="button" aria-label="Close wallet menu" onClick={() => setOpen(false)}>×</button></div>
          <div className="connectorList">{connectors.map((connector) => (
            <button className="connectorOption" key={connector.uid} disabled={isPending} onClick={() => { reset(); setPendingConnectorUid(connector.uid); connect({ connector }); }}>
              <span>{isPending && pendingConnectorUid === connector.uid ? `Opening ${walletLabel(connector.name)}…` : walletLabel(connector.name)}</span>
              <small>{walletDescription(connector.name)}</small>
            </button>
          ))}</div>
          <div className="mobileWalletLinks">
            <strong>Using Safari or mobile Chrome?</strong>
            <span>Open this page inside a wallet so it can sign securely.</span>
            <div><a href={metaMaskUrl}>Open in MetaMask ↗</a><a href={phantomUrl}>Open in Phantom ↗</a></div>
          </div>
          <div className="walletQuickGuide">
            <strong>New to wallets?</strong>
            <span><b>Robinhood Wallet:</b> open RMT from its Web3 globe.</span>
            <span><b>Other wallets:</b> use an installed browser wallet{hasWalletConnect ? ", or choose Mobile wallet for WalletConnect." : " or one of the mobile shortcuts above."}</span>
            <a href="https://robinhood.com/us/en/support/articles/connect-to-dapps/" target="_blank" rel="noreferrer">Official wallet connection guide ↗</a>
          </div>
          {error && <p className="walletError" role="alert">{walletErrorMessage(error.message)}</p>}
        </div>}
      </div>
    );
  }

  if (chainId !== targetChain.id) {
    return (
      <div className="networkSwitchGroup">
        <button className="wallet network" disabled={isSwitching} onClick={() => { resetSwitch(); switchChain({ chainId: targetChain.id }); }}>
          {isSwitching ? "Switching…" : `Switch to ${targetChain.name}`}
        </button>
        {switchError && <span className="networkSwitchError" role="alert">{walletErrorMessage(switchError.message)}</span>}
      </div>
    );
  }

  return (
    <button className="wallet live" title="Disconnect wallet" onClick={() => disconnect()}>
      {address ? shortAddress(address) : "Connected"}
    </button>
  );
}
