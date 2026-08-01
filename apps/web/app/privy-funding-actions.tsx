"use client";

import { useAddFunds, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useState } from "react";
import { useAccount } from "wagmi";
import { parsePrivyFundingConfig } from "../lib/privy-funding";

const funding = parsePrivyFundingConfig({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  enabled: process.env.NEXT_PUBLIC_PRIVY_FUNDING_ENABLED,
  chainId: process.env.NEXT_PUBLIC_PRIVY_FUNDING_CHAIN_ID,
  asset: process.env.NEXT_PUBLIC_PRIVY_FUNDING_ASSET,
  defaultAmount: process.env.NEXT_PUBLIC_PRIVY_FUNDING_DEFAULT_AMOUNT,
  environment: process.env.NEXT_PUBLIC_PRIVY_FUNDING_ENVIRONMENT
});

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
export function PrivyFundingActions({ onComplete }: { onComplete?: () => void }) {
  const { ready, authenticated, login } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address: activeAddress } = useAccount();
  const { addFunds } = useAddFunds();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy" && wallet.type === "ethereum");
  const activeWallet = wallets.find((wallet) => wallet.address.toLowerCase() === activeAddress?.toLowerCase());
  const destination = activeWallet ?? embeddedWallet;

  if (!funding.enabled) {
    return (
      <div className="privyFundingUnavailable">
        <strong>Robinhood Chain funding is supported</strong>
        <span>RMT is keeping live deposits off until the Privy dashboard funding methods and production environment are explicitly activated.</span>
      </div>
    );
  }

  if (!ready || (authenticated && !walletsReady)) {
    return <button className="fundWalletPrimary" type="button" disabled>Checking funding options…</button>;
  }

  if (!authenticated) {
    return (
      <>
        <button className="fundWalletPrimary" type="button" onClick={login}>Sign in to fund an RMT wallet</button>
        <small className="fundWalletDisclosure">Email, Google, passkey, and external-wallet sign-in are supported. A wallet is created only for this user.</small>
      </>
    );
  }

  if (!destination) {
    return (
      <div className="privyFundingUnavailable">
        <strong>Wallet setup is still completing</strong>
        <span>Close this panel and reopen it after Privy finishes creating your user-owned wallet.</span>
      </div>
    );
  }

  const beginFunding = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (activeAddress?.toLowerCase() !== destination.address.toLowerCase()) {
        await setActiveWallet(destination);
      }
      const result = await addFunds({
        destination: {
          address: destination.address,
          chain: funding.chain,
          asset: funding.asset
        },
        fiat: {
          source: { defaultAsset: "usd" },
          environment: funding.environment,
          defaultAmount: funding.defaultAmount
        },
        crypto: {
          refundAddress: destination.address,
          slippageBps: 100
        }
      });
      setMessage(result.method === "fiat"
        ? result.status === "confirmed" ? "Funding confirmed by the provider." : "Funding submitted to the provider."
        : "Crypto funding completed.");
      onComplete?.();
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : "No compatible funding route was returned. No funds were moved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fundWalletDestination">
        <span>Exact destination</span>
        <strong>{shortAddress(destination.address)} · {funding.asset.toUpperCase()} · Robinhood Chain</strong>
      </div>
      <button className="fundWalletPrimary" type="button" disabled={busy} onClick={() => void beginFunding()}>
        {busy ? "Opening secure funding…" : "Deposit with crypto or available fiat methods"}
      </button>
      <small className="fundWalletDisclosure">
        Privy shows only methods and quotes available for your device, region, and destination. Apple Pay, card, bank, and other options are never promised because eligibility is provider-controlled. Fees and identity checks appear before confirmation.
        {funding.environment === "sandbox" ? " This preview uses the provider sandbox; no live purchase is enabled." : ""}
      </small>
      {message && <p className="fundWalletMessage" role="status">{message}</p>}
    </>
  );
}
