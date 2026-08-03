"use client";

import { useIdentityToken, usePrivy, useSigners, useWallets } from "@privy-io/react-auth";
import { robinhoodChain } from "@rmt/shared/chains";
import { createPublicClient, encodeFunctionData, erc20Abi, http, type Address, type Hex } from "viem";
import { useEffect, useMemo, useState } from "react";
import {
  livePositionGuardPublicConfiguration,
  type LivePositionGuardSettings
} from "../lib/live-position-guard";

const configuration = livePositionGuardPublicConfiguration({
  NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED:
    process.env.NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED,
  NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR:
    process.env.NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR,
  NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID:
    process.env.NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID,
  NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID:
    process.env.NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID
});
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 3, timeout: 12_000 }
  )
});

type LiveGuardStatus = {
  available?: boolean;
  status?: string;
  armedAt?: number | null;
  expiresAt?: number | null;
  lastEvaluatedAt?: number | null;
  transactionHash?: string | null;
  error?: string;
};

function statusLabel(status: string) {
  if (status === "active") return "LIVE";
  if (status === "submitted") return "EXIT SENT";
  if (status === "executed") return "EXIT CONFIRMED";
  if (status === "confirming") return "VERIFYING TRIGGER";
  if (status === "approval_required") return "APPROVAL ENDED";
  if (status === "review_required") return "REVIEW REQUIRED";
  if (status === "expired") return "EXPIRED";
  if (status === "cancelled") return "OFF";
  return "READY";
}

async function parseResponse(response: Response) {
  const payload = await response.json() as LiveGuardStatus;
  if (!response.ok) throw new Error(payload.error ?? "Live Position Guard did not complete.");
  return payload;
}

function ConfiguredLivePositionGuardControls({
  pair,
  rawBalance,
  settings,
  token,
  wallet
}: {
  pair: Address;
  rawBalance: bigint;
  settings: Omit<LivePositionGuardSettings, "expiresAfterHours">;
  token: Address;
  wallet: Address;
}) {
  const { authenticated, ready } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets, ready: walletsReady } = useWallets();
  const { addSigners, removeSigners } = useSigners();
  const [expiresAfterHours, setExpiresAfterHours] = useState(24);
  const [status, setStatus] = useState<LiveGuardStatus>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const embeddedWallet = wallets.find((candidate) => candidate.walletClientType === "privy");
  const walletMatches = embeddedWallet?.address.toLowerCase() === wallet.toLowerCase();
  const active = ["active", "confirming", "executing", "submitted"].includes(status.status ?? "");
  const cleanupRequired = ["executed", "expired", "review_required", "approval_required"].includes(status.status ?? "");
  const headers = useMemo(() => identityToken ? {
    Authorization: `Bearer ${identityToken}`,
    "Content-Type": "application/json"
  } : null, [identityToken]);

  useEffect(() => {
    if (!headers || !authenticated) {
      setStatus({ status: "inactive" });
      return;
    }
    let cancelled = false;
    const query = new URLSearchParams({ token, wallet });
    void fetch(`/api/position-guards/live?${query}`, { cache: "no-store", headers })
      .then(parseResponse)
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch((cause) => {
        if (!cancelled) setStatus({ status: "error", error: cause instanceof Error ? cause.message : "Status unavailable." });
      });
    return () => { cancelled = true; };
  }, [authenticated, headers, token, wallet]);

  async function approveExact(amount: bigint) {
    if (!embeddedWallet || !configuration) throw new Error("The RMT wallet is not ready.");
    const provider = await embeddedWallet.getEthereumProvider();
    const transactionHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [configuration.executor, amount]
        }),
        from: wallet,
        to: token,
        value: "0x0"
      }]
    });
    if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      throw new Error("The wallet did not return a valid approval transaction.");
    }
    const receipt = await client.waitForTransactionReceipt({ hash: transactionHash as Hex, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error("The exact token approval reverted.");
  }

  async function arm() {
    if (!configuration || !headers || !embeddedWallet || !walletMatches || rawBalance <= 0n) return;
    setBusy(true);
    setMessage("Confirm the exact token allowance in your RMT wallet.");
    let allowanceApproved = false;
    let signerAdded = false;
    try {
      await approveExact(rawBalance);
      allowanceApproved = true;
      setMessage("Review the bounded automatic-exit permission. It can be revoked at any time.");
      await addSigners({
        address: wallet,
        signers: [{ signerId: configuration.signerId, policyIds: [configuration.policyId] }]
      });
      signerAdded = true;
      const response = await fetch("/api/position-guards/live", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "arm",
          amountIn: rawBalance.toString(),
          pair,
          settings: { ...settings, expiresAfterHours },
          token,
          wallet
        })
      });
      const next = await parseResponse(response);
      setStatus(next);
      setMessage("Live Position Guard is active. RMT can execute only the bounded exit you approved.");
    } catch (cause) {
      if (signerAdded) await removeSigners({ address: wallet }).catch(() => undefined);
      let allowanceCleared = !allowanceApproved;
      if (allowanceApproved) {
        allowanceCleared = await approveExact(0n).then(() => true).catch(() => false);
      }
      const detail = cause instanceof Error ? cause.message : "Live Position Guard could not be armed.";
      setMessage(allowanceCleared
        ? `${detail} The incomplete permission was removed.`
        : `${detail} The guard is not active. Revoke its token approval in your wallet before continuing.`);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!headers || !embeddedWallet || !walletMatches) return;
    setBusy(true);
    setMessage("Confirm removal of the executor allowance, then RMT will revoke its signer and cancel the order.");
    try {
      await approveExact(0n);
      await removeSigners({ address: wallet });
      const next = await parseResponse(await fetch("/api/position-guards/live", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "cancel", token, wallet })
      }));
      setStatus(next);
      setMessage("Automatic execution is revoked. Your manual Position Guard remains available.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Revocation did not complete. Review the wallet permission.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !walletsReady) {
    return <div className="livePositionGuardControl"><p>Checking automatic-exit eligibility…</p></div>;
  }
  if (!authenticated || !identityToken) {
    return <div className="livePositionGuardControl"><strong>Automatic exits require RMT sign-in</strong><p>The manual guard remains active on this device.</p></div>;
  }
  if (!embeddedWallet || !walletMatches) {
    return <div className="livePositionGuardControl"><strong>Use your RMT wallet for automatic exits</strong><p>MetaMask and other linked wallets keep full manual execution with their own confirmation.</p></div>;
  }
  if (status.status === "worker_offline" || status.status === "release_locked") {
    return <div className="livePositionGuardControl unavailable"><strong>Automatic exits are release-locked</strong><p>Your manual Position Guard remains active and still requires your wallet.</p></div>;
  }

  return (
    <section className={`livePositionGuardControl ${active ? "active" : ""}`} aria-label="Live Position Guard execution">
      <header>
        <span><small>AUTOMATIC EXECUTION</small><strong>{active
          ? "Protection continues when RMT is closed"
          : cleanupRequired
            ? "Clear the completed or interrupted permission"
            : "Turn this guard into a live order"}</strong></span>
        <em>{statusLabel(status.status ?? "")}</em>
      </header>
      <p>Exact token allowance · exact executor · WETH returns only to this wallet · no RMT custody.</p>
      {active || cleanupRequired ? (
        <button type="button" disabled={busy} onClick={() => void revoke()}>{busy ? "Revoking safely…" : cleanupRequired ? "Clear automatic permission" : "Revoke automatic exit"}</button>
      ) : (
        <div className="livePositionGuardArm">
          <label><span>Permission expires</span><select value={expiresAfterHours} onChange={(event) => setExpiresAfterHours(Number(event.target.value))}>
            <option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option>
          </select></label>
          <button type="button" disabled={busy || rawBalance <= 0n} onClick={() => void arm()}>{busy ? "Securing permission…" : "Enable automatic exit"}</button>
        </div>
      )}
      {status.expiresAt && active && <small>Permission expires {new Date(status.expiresAt).toLocaleString()}.</small>}
      {(message || status.error) && <p className="livePositionGuardMessage" role="status">{message || status.error}</p>}
    </section>
  );
}

export function LivePositionGuardControls(props: {
  pair: Address;
  rawBalance: bigint;
  settings: Omit<LivePositionGuardSettings, "expiresAfterHours">;
  token: Address;
  wallet: Address;
}) {
  if (!configuration) return null;
  return <ConfiguredLivePositionGuardControls {...props} />;
}
