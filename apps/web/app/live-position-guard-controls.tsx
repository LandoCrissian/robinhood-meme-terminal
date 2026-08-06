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
const STATUS_REFRESH_MS = 10_000;

type LiveGuardStatus = {
  available?: boolean;
  systemStatus?: string;
  status?: string;
  armedAt?: number | null;
  expiresAt?: number | null;
  lastEvaluatedAt?: number | null;
  revocationPending?: boolean;
  revocationRequestedAt?: number | null;
  transactionHash?: string | null;
  walletCleanupReported?: boolean | null;
  error?: string;
};

type LivePositionGuardControlProps = {
  armingEnabled?: boolean;
  pair: Address;
  rawBalance: bigint;
  settings: Omit<LivePositionGuardSettings, "expiresAfterHours">;
  token: Address;
  wallet: Address;
};

function statusLabel(status: string) {
  if (status === "active") return "LIVE";
  if (status === "executing") return "EXECUTING";
  if (status === "submitted") return "EXIT SENT";
  if (status === "executed") return "EXIT CONFIRMED";
  if (status === "confirming") return "VERIFYING TRIGGER";
  if (status === "approval_required") return "APPROVAL ENDED";
  if (status === "review_required") return "REVIEW REQUIRED";
  if (status === "no_position") return "NO POSITION";
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
  armingEnabled,
  pair,
  rawBalance,
  settings,
  token,
  wallet
}: Required<LivePositionGuardControlProps>) {
  const liveConfiguration = configuration!;
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
  const revocationPending = status.revocationPending === true;
  const walletCleanupRequired = status.revocationRequestedAt !== null
    && status.revocationRequestedAt !== undefined
    && status.walletCleanupReported === false;
  const cleanupRequired = ["executed", "expired", "review_required", "approval_required", "no_position"].includes(status.status ?? "")
    || walletCleanupRequired;
  const systemUnavailable = status.systemStatus === "worker_offline"
    || status.systemStatus === "release_locked"
    || status.systemStatus === "unverified";
  const hasOrderToClear = active || cleanupRequired || revocationPending;
  const headers = useMemo(() => identityToken ? {
    Authorization: `Bearer ${identityToken}`,
    "Content-Type": "application/json"
  } : null, [identityToken]);

  useEffect(() => {
    if (!headers || !authenticated) {
      setStatus({ status: "inactive" });
      return;
    }
    if (busy) return;
    let cancelled = false;
    let timeout: number | undefined;
    let inFlight = false;
    const controller = new AbortController();
    const query = new URLSearchParams({ token, wallet });
    setStatus({ status: "loading" });

    const load = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const next = await parseResponse(await fetch(`/api/position-guards/live?${query}`, {
          cache: "no-store",
          headers,
          signal: controller.signal
        }));
        if (!cancelled) setStatus(next);
      } catch (cause) {
        if (!cancelled && !controller.signal.aborted) {
          setStatus((current) => ({
            ...current,
            available: false,
            error: cause instanceof Error ? cause.message : "Status unavailable.",
            status: current.status && current.status !== "loading" ? current.status : "error",
            systemStatus: "unverified"
          }));
        }
      } finally {
        inFlight = false;
        if (!cancelled) timeout = window.setTimeout(() => void load(), STATUS_REFRESH_MS);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [authenticated, busy, headers, token, wallet]);

  async function approveExact(amount: bigint) {
    if (!embeddedWallet) throw new Error("The RMT wallet is not ready.");
    const provider = await embeddedWallet.getEthereumProvider();
    const transactionHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [liveConfiguration.executor, amount]
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
      !armingEnabled || !headers || !embeddedWallet || !walletMatches
      || rawBalance <= 0n || !authorityReviewed || walletCleanupRequired
      || status.systemStatus !== "ready" || status.available === false
    ) return;
    setBusy(true);
    setMessage("Step 1 of 2 · confirm the exact token allowance in your RMT wallet.");
    let allowanceApproved = false;
    let signerAdded = false;
    try {
      await approveExact(rawBalance);
      allowanceApproved = true;
      setMessage("Step 2 of 2 · review the bounded automatic-exit delegation.");
      await addSigners({
        address: wallet,
        signers: [{ signerId: liveConfiguration.signerId, policyIds: [liveConfiguration.policyId] }]
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
      setMessage("Automatic exit is live. RMT's evaluator may submit the bounded exit until it expires or you revoke it.");
    } catch (cause) {
      let signersCleared = !signerAdded;
      if (signerAdded) {
        signersCleared = await removeSigners({ address: wallet }).then(() => true).catch(() => false);
      }
      let allowanceCleared = !allowanceApproved;
      if (allowanceApproved) {
        allowanceCleared = await approveExact(0n).then(() => true).catch(() => false);
      }
      const detail = cause instanceof Error ? cause.message : "Automatic exit could not be armed.";
      const residue = [
        ...(!allowanceCleared ? ["the executor token allowance may remain"] : []),
        ...(!signersCleared ? ["one or more delegated signers may remain"] : [])
      ];
      setMessage(residue.length === 0
        ? `${detail} The incomplete permission was removed.`
        : `${detail} The order is not active, but ${residue.join(" and ")}. Use emergency revocation before continuing.`);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!headers || !embeddedWallet || !walletMatches) return;
    setBusy(true);
    setMessage("Removing the executor allowance, every delegated signer on this RMT wallet, and the live order.");
    let allowanceCleared = false;
    let signersCleared = false;
    let serverUpdated = false;
    let next: LiveGuardStatus | null = null;
    const failures: string[] = [];

    try {
      await approveExact(0n);
      allowanceCleared = true;
    } catch (cause) {
      failures.push(`Token allowance: ${cause instanceof Error ? cause.message : "not cleared"}`);
    }

    try {
      await removeSigners({ address: wallet });
      signersCleared = true;
    } catch (cause) {
      failures.push(`Delegated signers: ${cause instanceof Error ? cause.message : "not removed"}`);
    }

    try {
      next = await parseResponse(await fetch("/api/position-guards/live", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "cancel",
          token,
          wallet,
          walletAuthorityRemoved: allowanceCleared && signersCleared
        })
      }));
      serverUpdated = true;
      setStatus((current) => ({ ...current, ...next, error: undefined }));
    } catch (cause) {
      failures.push(`Order record: ${cause instanceof Error ? cause.message : "not updated"}`);
      setStatus((current) => ({
        ...current,
        available: false,
        systemStatus: "unverified",
        walletCleanupReported: allowanceCleared && signersCleared
      }));
    }

    if (allowanceCleared && signersCleared && serverUpdated) {
      setMessage(next?.revocationPending
        ? "Future wallet authority is removed. An exit was already in flight and may still settle; RMT will keep reconciling its chain result."
        : "Automatic execution is revoked. Privy removed all delegated signers from this RMT wallet; local monitoring remains available.");
    } else {
      const completed = [
        ...(allowanceCleared ? ["token allowance cleared"] : []),
        ...(signersCleared ? ["all additional signers removed"] : []),
        ...(serverUpdated ? ["order record updated"] : [])
      ];
      setMessage(`Revocation is incomplete. ${completed.length > 0 ? `Completed: ${completed.join(", ")}. ` : ""}${failures.join(" ")} Do not treat an already-submitted transaction as cancelled.`);
    }
    setBusy(false);
  }

  if (!ready || !walletsReady || status.status === "loading") {
    return <div className="livePositionGuardControl compactState"><p>Checking automatic-exit eligibility…</p></div>;
  }
  if (!authenticated || !identityToken) {
    return (
      <div className="livePositionGuardControl compactState">
        <strong>{armingEnabled ? "Automatic exits require RMT sign-in" : "Sign in to recover automatic-exit controls"}</strong>
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
  if (status.error && status.status === "error") {
    return (
      <div className="livePositionGuardControl compactState unavailable">
        <strong>Automatic-exit status could not be verified</strong>
        <p>{status.error} RMT will not request new delegated authority while the order state is unknown.</p>
        <button className="livePositionGuardEmergencyRevoke" type="button" disabled={busy} onClick={() => void revoke()}>
          {busy ? "Removing authority…" : "Emergency revoke wallet authority"}
        </button>
      </div>
    );
  }
  if (systemUnavailable && !hasOrderToClear) {
    const systemHeading = status.systemStatus === "worker_offline"
      ? "Automatic-exit evaluator is offline"
      : status.systemStatus === "unverified"
        ? "Automatic-exit status is unverified"
        : "Automatic exits are release-locked";
    return (
      <div className="livePositionGuardControl compactState unavailable">
        <strong>{systemHeading}</strong>
        <p>New authority is blocked. Guided emergency revocation remains available for this RMT wallet.</p>
        <button className="livePositionGuardEmergencyRevoke" type="button" disabled={busy} onClick={() => void revoke()}>
          {busy ? "Removing authority…" : "Review and revoke wallet authority"}
        </button>
      </div>
    );
  }
  if (!armingEnabled && !hasOrderToClear) return null;

  const transactionHref = status.transactionHash && /^0x[0-9a-fA-F]{64}$/.test(status.transactionHash)
    ? `${EXPLORER}/tx/${status.transactionHash}`
    : null;
  const displayStatus = walletCleanupRequired
    ? "CLEANUP REQUIRED"
    : revocationPending
      ? "RECONCILING"
      : statusLabel(status.status ?? "");
  const heading = walletCleanupRequired
    ? "Wallet permission cleanup is incomplete"
    : revocationPending
      ? "Future authority removed · reconciling an in-flight exit"
      : systemUnavailable
        ? "Execution system unavailable · remove wallet authority"
        : active
          ? "Protection continues when RMT is closed"
          : cleanupRequired
            ? "Clear the completed or interrupted permission"
            : "Authorize this position plan";

  return (
    <section className={`livePositionGuardControl ${active ? "active" : ""} ${cleanupRequired ? "cleanup" : ""} ${systemUnavailable ? "systemUnavailable" : ""}`} aria-label="Automatic Position Guard execution">
      <header>
        <span>
          <small>AUTOMATIC EXIT · BOUNDED DELEGATION</small>
          <strong>{heading}</strong>
        </span>
        <em>{displayStatus}</em>
      </header>

      <div className="livePositionGuardBoundary" aria-label="Automatic exit authorization boundary">
        <span><small>ASSET ACCESS</small><strong>Up to the approved token amount</strong></span>
        <span><small>TRIGGER AUTHORITY</small><strong>RMT evaluator + policy signer</strong></span>
        <span><small>EXECUTION PATH</small><strong>Verified V3 pool → WETH</strong></span>
        <span><small>RECIPIENT</small><strong>Same wallet only</strong></span>
      </div>

      {systemUnavailable && (
        <p className="livePositionGuardSystemWarning" role="alert">
          {status.systemStatus === "worker_offline"
            ? "The evaluator heartbeat is stale. New orders are blocked, but emergency revocation remains available."
            : status.systemStatus === "unverified"
              ? "RMT could not refresh the order state. New authority is blocked; remove wallet authority if you cannot independently verify the order."
              : "Server execution is release-locked. Remove any remaining allowance and delegated signer authority before relying on local monitoring only."}
        </p>
      )}

      {active || cleanupRequired || revocationPending ? (
        <>
          <div className="livePositionGuardRuntime" aria-label="Live automatic exit status">
            <span><small>ARMED</small><strong>{timeLabel(status.armedAt)}</strong></span>
            <span><small>LAST CHECK</small><strong>{timeLabel(status.lastEvaluatedAt)}</strong></span>
            <span><small>{revocationPending || walletCleanupRequired ? "REVOKE REQUESTED" : "EXPIRES"}</small><strong>{timeLabel(revocationPending || walletCleanupRequired ? status.revocationRequestedAt : status.expiresAt)}</strong></span>
          </div>
          {transactionHref && <a className="livePositionGuardTransaction" href={transactionHref} target="_blank" rel="noopener noreferrer">View execution transaction ↗</a>}
          {revocationPending && !walletCleanupRequired ? (
            <p className="livePositionGuardSystemWarning" role="status">An already-authorized transaction may still confirm. RMT keeps the order in reconciliation instead of falsely marking it cancelled.</p>
          ) : (
            <button className="livePositionGuardRevoke" type="button" disabled={busy} onClick={() => void revoke()}>
              {busy
                ? "Revoking safely…"
                : walletCleanupRequired
                  ? "Retry wallet permission cleanup"
                  : systemUnavailable
                    ? "Emergency revoke automatic authority"
                    : cleanupRequired
                      ? "Clear automatic permission"
                      : "Revoke automatic exit"}
            </button>
          )}
        </>
      ) : armingEnabled ? (
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
            <span>I reviewed the approved amount, RMT evaluator timing authority, fixed executor, same-wallet recipient, expiry, and revocation path. Revocation removes all additional signers from this embedded wallet.</span>
          </label>
          <button type="button" disabled={busy || rawBalance <= 0n || !authorityReviewed || walletCleanupRequired || status.systemStatus !== "ready" || status.available === false} onClick={() => void arm()}>
            {busy ? "Securing permission…" : "Authorize automatic exit"}
          </button>
        </div>
      ) : null}

      <details className="livePositionGuardDetails">
        <summary>View contract and trust boundary</summary>
        <dl>
          <div><dt>Executor</dt><dd title={liveConfiguration.executor}>{shortAddress(liveConfiguration.executor)}</dd></div>
          <div><dt>Wallet</dt><dd title={wallet}>{shortAddress(wallet)}</dd></div>
          <div><dt>Token</dt><dd title={token}>{shortAddress(token)}</dd></div>
          <div><dt>Price-impact cap</dt><dd>≤{(settings.maxPriceImpactBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</dd></div>
        </dl>
        <p>The evaluator and policy signer control submission timing. A compromised signer could submit early within the approved allowance, but cannot redirect proceeds or spend beyond that approval. The executor has no arbitrary recipient, generic call, custody account, or RMT fee path. Privy’s revoke operation removes all additional signers on this embedded wallet.</p>
      </details>

      {(message || status.error) && <p className="livePositionGuardMessage" role="status" aria-live="polite">{message || status.error}</p>}
    </section>
  );
}

export function LivePositionGuardControls({ armingEnabled = true, ...props }: LivePositionGuardControlProps) {
  if (!configuration) return null;
  return (
    <ConfiguredLivePositionGuardControls
      armingEnabled={armingEnabled && configuration.enabled}
      {...props}
    />
  );
}
