"use client";

import { robinhoodChainTestnet } from "@rmt/shared/chains";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (!isConnected) {
    const connector = connectors[0];
    return (
      <button className="wallet live" disabled={!connector || isPending} onClick={() => connector && connect({ connector })}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
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
