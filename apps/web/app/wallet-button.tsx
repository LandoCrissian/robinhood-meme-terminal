"use client";

import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, error, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (!isConnected) {
    return (
      <div className="wallet-options">
        {connectors.map((connector) => (
          <button className="wallet live" key={connector.uid} disabled={isPending} onClick={() => connect({ connector })}>
            {isPending ? "Connecting…" : connector.name === "WalletConnect" ? "Robinhood Wallet" : "Browser wallet"}
          </button>
        ))}
        {error ? (
          <p className="wallet-help" role="alert">
            Wallet not detected. Open this page inside Robinhood Wallet using Web3 (the globe icon), then try again.
          </p>
        ) : (
          <p className="wallet-help">
            On mobile, open this page from Robinhood Wallet → Web3 (globe icon).
          </p>
        )}
      </div>
    );
  }

  if (chainId !== robinhoodChainTestnet.id) {
    return (
      <button className="wallet network" disabled={isSwitching} onClick={() => switchChain({ chainId: robinhoodChainTestnet.id })}>
        {isSwitching ? "Switching…" : "Switch to Robinhood Testnet"}
      </button>
    );
  }

  return (
    <button className="wallet live" title="Disconnect wallet" onClick={() => disconnect()}>
      {address ? shortAddress(address) : "Connected"}
    </button>
  );
}
