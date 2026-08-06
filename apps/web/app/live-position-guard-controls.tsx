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
const EXPLORER = "https://robinhoodchain.blockscout.com";

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
  if (status === "executing") return "EXECUTING";
  if (status === "submitted") return "EXIT SENT";
  if (status === "executed") return "EXIT CONFIRMED";
  if (status === "confirming") return "VERIFYING TRIGGER";
  if (status === "approval_required") return "APPROVAL ENDED";
  if (status === "review_required") return "REVIEW REQUIRED";
  if (status === "expired") return "EXPIRED";
  if (status === "cancelled") return "OFF";
  if (status === "loading") return "CHECKING";
  if (status === "error") return "UNAVAILABLE";
  return "READY";
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function durationLabel(hours: number) {
  if (hours === 24) return "24 hours";
  if (hours === 72) return "3 days";
  return "7 days";
}

function timeLabel(value?: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
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
  const [authorityReviewed, setAuthorityReviewed] = useState(false);
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
    if (
      !configuration || !headers || !embeddedWallet || !walletMatches
      || rawBalance <= 0n || !authorityReviewed
    ) return;
    setBusy(true);
    setMessage("Step 1 of 2 · confirm the exact token allowance in your RMT wallet.");
    let allowanceApproved = false;
    let signerAdded = false;
    try {
      await approveExact(rawBalance);
      allowanceApproved = true;
      setMessage("Step 2 of 2 · review the bounded automatic-exit permission.");
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
      setAuthorityReviewed(false);
      setMessage("Automatic exit is live. The permission is bounded to this token, this wallet, and this expiry.");
    } catch (cause) {
      if (signerAdded) await removeSigners({ address: wallet }).catch(() => undefined);
      let allowanceCleared = !allowanceApproved;
      if (allowanceApproved) {
        allowanceCleared = await approveExact(0n).then(() => true).catch(() => false);
      }
      const detail = cause instanceof Error ? cause.message : "Automatic exit could not be armed.";
      setMessage(allowanceCleared
        ? `${detail} The incomplete permission was removed.`
        : `${detail} The order is not active. Revoke the executor token approval in your wallet before continuing.`);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!headers || !embeddedWallet || !walletMatches) return;
    setBusy(true);
    setMessage("Removing the executor allowance, RMT signer permission, and live order.");
    try {
      await approveExact(0n);
      await removeSigners({ address: wallet });
      const next = await parseResponse(await fetch("/api/position-guards/live", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "cancel", token, wallet })
      }));
      setStatus(next);
      setMessage("Automatic execution is revoked. The local monitoring plan remains available.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Revocation did not complete. Review the wallet permission.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !walletsReady) {
    return <div className="livePositionGuardControl compactState"><p>Checking automatic-exit eligibility…</p></div>;
  }
  if (!authenticated || !identityToken) {
    return (
      <div className="livePositionGuardControl compactState">
        <strong>Automatic exits require RMT sign-in</strong>
        <p>The local Position Guard can still monitor and prepare a sell ticket on this device.</p>
      </div>
    );
  }
  if (!embeddedWallet || !walletMatches) {
    return (
      <div className="livePositionGuardControl compactState">
        <strong>Automatic exits use the RMT embedded wallet</strong>
        <p>Linked external wallets keep manual execution and their own confirmation flow.</p>
      </div>
    );
  }
  if (status.status === "worker_offline" || status.status === "release_locked") {
    return (
      <div className="livePositionGuardControl compactState unavailable">
        <strong>Automatic exits are release-locked</strong>
        <p>The contract and worker must both pass the production release gate before this control can authorize funds.</p>
      </div>
    );
  }

  const transactionHref = status.transactionHash && /^0x[0-9a-fA-F]{64}$/.test(status.transactionHash)
    ? `${EXPLORER}/tx/${status.transactionHash}`
    : null;

  return (
    <section className={`livePositionGuardControl ${active ? "active" : ""} ${cleanupRequired ? "cleanup" : ""}`} aria-label="Automatic Position Guard execution">
      <header>
        <span>
          <small>AUTOMATIC EXIT · BOUNDED AUTHORITY</small>
          <strong>{active
            ? "Protection continues when RMT is closed"
            : cleanupRequired
              ? "Clear the completed or interrupted permission"
              : "Authorize this position plan"}</strong>
        </span>
        <em>{statusLabel(status.status ?? "")}</em>
      </header>

      <div className="livePositionGuardBoundary" aria-label="Automatic exit authorization boundary">
        <span><small>ASSET ACCESS</small><strong>Exact current token balance</strong></span>
        <span><small>EXECUTION PATH</small><strong>Verified V3 pool → WETH</strong></span>
        <span><small>RECIPIENT</small><strong>Same wallet only</strong></span>
        <span><small>CONTROL</small><strong>Expiry + revoke</strong></span>
      </div>

      {active || cleanupRequired ? (
        <>
          <div className="livePositionGuardRuntime" aria-label="Live automatic exit status">
            <span><small>ARMED</small><strong>{timeLabel(status.armedAt)}</strong></span>
            <span><small>LAST CHECK</small><strong>{timeLabel(status.lastEvaluatedAt)}</strong></span>
            <span><small>EXPIRES</small><strong>{timeLabel(status.expiresAt)}</strong></span>
          </div>
          {transactionHref && <a className="livePositionGuardTransaction" href={transactionHref} target="_blank" rel="noopener noreferrer">View execution transaction ↗</a>}
          <button className="livePositionGuardRevoke" type="button" disabled={busy} onClick={() => void revoke()}>
            {busy ? "Revoking safely…" : cleanupRequired ? "Clear automatic permission" : "Revoke automatic exit"}
          </button>
        </>
      ) : (
        <div className="livePositionGuardArm">
          <label className="livePositionGuardExpiry">
            <span>Permission expires</span>
            <select value={expiresAfterHours} onChange={(event) => setExpiresAfterHours(Number(event.target.value))}>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </select>
            <small>The order stops after {durationLabel(expiresAfterHours)} even if no exit occurs.</small>
          </label>
          <label className="livePositionGuardReview">
            <input type="checkbox" checked={authorityReviewed} onChange={(event) => setAuthorityReviewed(event.target.checked)} />
            <span>I reviewed the exact-token approval, fixed executor, same-wallet recipient, and revocation path.</span>
          </label>
          <button type="button" disabled={busy || rawBalance <= 0n || !authorityReviewed} onClick={() => void arm()}>
            {busy ? "Securing permission…" : "Authorize automatic exit"}
          </button>
        </div>
      )}

      <details className="livePositionGuardDetails">
        <summary>View contract boundary</summary>
        <dl>
          <div><dt>Executor</dt><dd title={configuration.executor}>{shortAddress(configuration.executor)}</dd></div>
          <div><dt>Wallet</dt><dd title={wallet}>{shortAddress(wallet)}</dd></div>
          <div><dt>Token</dt><dd title={token}>{shortAddress(token)}</dd></div>
          <div><dt>Max price impact</dt><dd>{(settings.maxPriceImpactBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</dd></div>
        </dl>
        <p>No arbitrary recipient, arbitrary contract call, custody account, or RMT trading fee is included in this authorization.</p>
      </details>

      {(message || status.error) && <p className="livePositionGuardMessage" role="status" aria-live="polite">{message || status.error}</p>}
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
