"use client";

import {
  useCreateWallet,
  useExportWallet,
  usePrivy,
  useWallets
} from "@privy-io/react-auth";
import { useState } from "react";

const speedWalletEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ConfiguredSpeedWalletEntry() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speed Wallet action did not complete.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="speedWalletEntry" aria-label="RMT Speed Wallet">
      <header>
        <span><small>OPTIONAL SPEED WALLET</small><strong>Prepare one-tap sessions</strong></span>
        <em>{embeddedWallet ? "WALLET READY" : authenticated ? "SETUP" : "OFF"}</em>
      </header>
      <p>
        A separate user-owned wallet enables bounded trading sessions. RMT never asks you to paste a private key,
        and session execution stays off until router, amount, expiry and revocation policies are active.
      </p>
      {!ready || (authenticated && !walletsReady) ? (
        <button type="button" disabled>Checking Speed Wallet…</button>
      ) : !authenticated ? (
        <button type="button" onClick={login}>Sign in to set up Speed Wallet</button>
      ) : !embeddedWallet ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => createWallet(), "Speed Wallet created. Session permissions remain off.")}
        >
          {busy ? "Creating user-owned wallet…" : "Create Speed Wallet"}
        </button>
      ) : (
        <div className="speedWalletReady">
          <span><small>ROBINHOOD CHAIN WALLET</small><strong>{shortAddress(embeddedWallet.address)}</strong></span>
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => exportWallet({ address: embeddedWallet.address }), "Wallet export completed.")}
            >
              Export / recover
            </button>
            <button type="button" disabled={busy} onClick={() => void logout()}>Sign out</button>
          </div>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

export function SpeedWalletEntry() {
  if (!speedWalletEnabled) return null;
  return <ConfiguredSpeedWalletEntry />;
}
