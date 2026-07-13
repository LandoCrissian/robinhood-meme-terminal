"use client";

import { useState } from "react";
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

export function WalletButton({ target = "testnet" }: { target?: "testnet" | "mainnet" }) {
  const [open, setOpen] = useState(false);
  const { address, chainId, isConnected } = useAccount();
  const targetChain = target === "mainnet" ? robinhoodChain : robinhoodChainTestnet;
  const { connectors, connect, error, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (!isConnected) {
    return (
      <div className="walletMenu">
        <button className="wallet live connectTrigger" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Connect wallet
        </button>
        {open && <div className="walletPopover" role="dialog" aria-label="Connect a wallet">
          <div className="walletPopoverHeader"><div><strong>Choose your wallet</strong><span>RMT never sees your recovery phrase.</span></div><button type="button" aria-label="Close wallet menu" onClick={() => setOpen(false)}>×</button></div>
          <div className="connectorList">{connectors.map((connector) => (
            <button className="connectorOption" key={connector.uid} disabled={isPending} onClick={() => connect({ connector })}>
              <span>{walletLabel(connector.name)}</span>
              <small>{connector.name === "WalletConnect" ? "Robinhood Wallet, MetaMask, Phantom and more" : "Use a wallet already installed on this device"}</small>
            </button>
          ))}</div>
          <div className="walletQuickGuide">
            <strong>New to wallets?</strong>
            <span><b>Robinhood Wallet:</b> open RMT from its Web3 globe.</span>
            <span><b>MetaMask or Phantom:</b> use Browser wallet, or choose Mobile wallet from Safari.</span>
          </div>
          {error && <p className="walletError" role="alert">{error.message}</p>}
        </div>}
      </div>
    );
  }

  if (chainId !== targetChain.id) {
    return (
      <button className="wallet network" disabled={isSwitching} onClick={() => switchChain({ chainId: targetChain.id })}>
        {isSwitching ? "Switching…" : `Switch to ${targetChain.name}`}
      </button>
    );
  }

  return (
    <button className="wallet live" title="Disconnect wallet" onClick={() => disconnect()}>
      {address ? shortAddress(address) : "Connected"}
    </button>
  );
}
