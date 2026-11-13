"use client";

import { useEffect, useState } from "react";
import { displayAmount } from "../../../lib/launchpad/direct-v4";
import { useLaunchClient, useLaunchWallet, WalletConnection } from "./launch-wallet";
import { TransactionFeedback, useLaunchTransaction } from "./launch-transactions";

export function LaunchWalletPage() {
  const { config, wallet } = useLaunchWallet();
  const deployment = config?.status === "ready" ? config.deployment : undefined;
  const client = useLaunchClient(deployment);
  const [balance, setBalance] = useState<string>();
  const transaction = useLaunchTransaction();
  const address = wallet?.address;
  const chain = wallet?.chainId;
  useEffect(() => {
    let cancelled = false;
    if (address && client && chain === deployment?.chainId) {
      void client.getBalance({ address }).then((amount) => {
        if (!cancelled) setBalance(`${displayAmount(amount)} test ETH`);
      }).catch(() => { if (!cancelled) setBalance("Balance unavailable"); });
    }
    return () => { cancelled = true; };
  }, [address, client, chain, deployment?.chainId, transaction.result]);
  return <>
    <header className="lpPageHeading"><div><h1>Wallet</h1><p>Connect a wallet for launch, trading and transaction recovery.</p></div></header>
    <section className="lpPanel lpForm">
      <h2>Wallet connection</h2>
      <WalletConnection />
      {wallet && deployment && chain === deployment.chainId && <p>Network balance <strong>{balance ?? "Loading…"}</strong></p>}
      {config?.status === "disabled" && <p>Transactions are disabled in this preview.</p>}
      <TransactionFeedback transaction={transaction} />
    </section>
  </>;
}
