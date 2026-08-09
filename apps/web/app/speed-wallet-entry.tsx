"use client";

import {
  useCreateWallet,
  useExportWallet,
  useMfaEnrollment,
  usePrivy,
  useSetWalletRecovery,
  useWallets
} from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useState } from "react";
import { useAccount } from "wagmi";
import { speedWalletEnabled } from "../lib/privy-config";
import { useRmtIdentity } from "./rmt-identity";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ConfiguredSpeedWalletEntry() {
  const { ready, authenticated, logout, user } = usePrivy();
  const identity = useRmtIdentity();
  const { wallets, ready: walletsReady } = useWallets();
  const { address: activeAddress } = useAccount();
  const { setActiveWallet } = useSetActiveWallet();
  const { createWallet } = useCreateWallet();
  const { exportWallet } = useExportWallet();
  const { setWalletRecovery } = useSetWalletRecovery();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const mfaEnabled = Boolean(user?.mfaMethods.length);
  const isActive = embeddedWallet?.address.toLowerCase() === activeAddress?.toLowerCase();

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
        <span><small>RMT WALLET CONTROL</small><strong>Trade, fund, recover and protect</strong></span>
        <em>{embeddedWallet ? isActive ? "ACTIVE" : "READY" : authenticated ? "SETUP" : "OFF"}</em>
      </header>
      <p>
        Privy gives you a user-owned, exportable Robinhood Chain wallet without a browser extension. RMT never asks
        you to paste a private key, and unattended execution stays off until bounded wallet policies are active.
      </p>
      {!ready || (authenticated && !walletsReady) ? (
        <button type="button" disabled>Checking Speed Wallet…</button>
      ) : !authenticated ? (
        <button type="button" onClick={identity.login}>Sign in or create RMT Wallet</button>
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
          <span><small>USER-OWNED ROBINHOOD CHAIN WALLET</small><strong>{shortAddress(embeddedWallet.address)} · {mfaEnabled ? "MFA ON" : "MFA AVAILABLE"}</strong></span>
          <div>
            {!isActive && <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => setActiveWallet(embeddedWallet), "RMT Wallet is now active for trades.")}
            >
              Use for trades
            </button>}
            <button type="button" disabled={busy} onClick={() => showMfaEnrollmentModal()}>
              {mfaEnabled ? "Manage MFA" : "Protect with MFA"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => setWalletRecovery(), "Wallet recovery settings updated.")}
            >
              Recovery
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => exportWallet({ address: embeddedWallet.address }), "Wallet export completed.")}
            >
              Export key
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
