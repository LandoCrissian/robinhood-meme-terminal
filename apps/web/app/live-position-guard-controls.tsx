"use client";

import { useIdentityToken, usePrivy, useSigners, useWallets } from "@privy-io/react-auth";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Address,
  type Hex
} from "viem";
import { useEffect, useMemo, useState } from "react";
import {
  livePositionGuardPublicConfiguration,
  normalizeLivePositionGuardOnchainOrder,
  normalizeLivePositionGuardPreparedPlan,
  rmtPositionGuardExecutorAbi,
  type LivePositionGuardPreparedPlan,
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
const ORDER_ID = /^0x[0-9a-fA-F]{64}$/;

type LiveGuardStatus = {
  available?: boolean;
  systemStatus?: string;
  status?: string;
  orderId?: Hex | null;
  armedAt?: number | null;
  expiresAt?: number | null;
  lastEvaluatedAt?: number | null;
  revocationPending?: boolean;
  revocationRequestedAt?: number | null;
  transactionHash?: string | null;
  walletCleanupReported?: boolean | null;
  onchainOrderClosed?: boolean | null;
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

async function responsePayload(response: Response) {
  return await response.json() as Record<string, unknown>;
}

async function parseStatusResponse(response: Response) {
  const payload = await responsePayload(response) as LiveGuardStatus;
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
  const embeddedWallet = wallets.find((candidate) => (
    candidate.walletClientType === "privy"
    && candidate.address.toLowerCase() === wallet.toLowerCase()
  ));
  const walletMatches = Boolean(embeddedWallet);
  const active = ["active", "confirming", "executing", "submitted"].includes(status.status ?? "");
  const revocationPending = status.revocationPending === true;
  const walletCleanupRequired = status.revocationRequestedAt !== null
    && status.revocationRequestedAt !== undefined
    && status.walletCleanupReported === false;
  const onchainCleanupRequired = status.revocationRequestedAt !== null
    && status.revocationRequestedAt !== undefined
    && status.onchainOrderClosed === false;
  const cleanupRequired = ["executed", "expired", "review_required", "approval_required", "no_position"].includes(status.status ?? "")
    || walletCleanupRequired || onchainCleanupRequired;
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
        const next = await parseStatusResponse(await fetch(`/api/position-guards/live?${query}`, {
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

  async function sendWalletTransaction(to: Address, data: Hex) {
    if (!embeddedWallet) throw new Error("The matching RMT wallet is not ready.");
    const provider = await embeddedWallet.getEthereumProvider();
    const transactionHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ data, from: wallet, to, value: "0x0" }]
    });
    if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      throw new Error("The wallet did not return a valid transaction hash.");
    }
    const hash = transactionHash as Hex;
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error("The wallet transaction reverted.");
    return hash;
  }

  async function approveExact(amount: bigint) {
    const current = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet, liveConfiguration.executor]
    });
    if (current === amount) return;
    if (current !== 0n && amount !== 0n) {
      await sendWalletTransaction(token, encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [liveConfiguration.executor, 0n]
      }));
    }
    await sendWalletTransaction(token, encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [liveConfiguration.executor, amount]
    }));
    const verified = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet, liveConfiguration.executor]
    });
    if (verified !== amount) throw new Error("The exact executor allowance was not confirmed onchain.");
  }

  async function registerOrder(plan: LivePositionGuardPreparedPlan) {
    await sendWalletTransaction(liveConfiguration.executor, encodeFunctionData({
      abi: rmtPositionGuardExecutorAbi,
      functionName: "registerV3Order",
      args: [{
        token: plan.token,
        fee: plan.fee,
        amountIn: plan.amountIn,
        stopLossBps: plan.stopLossBps,
        trailingStopBps: plan.trailingStopBps,
        breakEvenActivationBps: plan.breakEvenActivationBps,
        maxSlippageBps: plan.maxSlippageBps,
        twapSeconds: plan.twapSeconds,
        expiresAt: BigInt(plan.expiresAt),
        orderId: plan.orderId
      }]
    }));
  }

  async function onchainOrderClosed(orderId: Hex | null | undefined) {
    if (!orderId || !ORDER_ID.test(orderId)) return false;
    const readOrder = async () => normalizeLivePositionGuardOnchainOrder(await client.readContract({
      address: liveConfiguration.executor,
      abi: rmtPositionGuardExecutorAbi,
      functionName: "getV3Order",
      args: [wallet, orderId]
    }));
    try {
      let order = await readOrder();
      if (!order || order.status === 0) return false;
      if (order.status !== 1) return true;
      await sendWalletTransaction(liveConfiguration.executor, encodeFunctionData({
        abi: rmtPositionGuardExecutorAbi,
        functionName: "cancelV3Order",
        args: [orderId]
      }));
      order = await readOrder();
      return Boolean(order && order.status !== 1 && order.status !== 0);
    } catch {
      return false;
    }
  }

  async function preparePlan() {
    if (!headers) throw new Error("Sign in before preparing automatic protection.");
    const response = await fetch("/api/position-guards/live", {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "prepare",
        amountIn: rawBalance.toString(),
        pair,
        settings: { ...settings, expiresAfterHours },
        token,
        wallet
      })
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "RMT could not prepare the onchain order.");
    }
    const plan = normalizeLivePositionGuardPreparedPlan(payload.plan);
    if (
      !plan || plan.amountIn !== rawBalance
      || plan.token.toLowerCase() !== token.toLowerCase()
      || plan.pair.toLowerCase() !== pair.toLowerCase()
      || plan.stopLossBps !== settings.stopLossBps
      || plan.trailingStopBps !== settings.trailingStopBps
      || plan.breakEvenActivationBps !== settings.breakEvenActivationBps
    ) throw new Error("RMT rejected a prepared order that did not match this reviewed position plan.");
    return plan;
  }

  async function arm() {
    if (
      !armingEnabled || !headers || !embeddedWallet || !walletMatches
      || rawBalance <= 0n || !authorityReviewed || walletCleanupRequired || onchainCleanupRequired
      || status.systemStatus !== "ready" || status.available === false
    ) return;
    setBusy(true);
    setMessage("Preparing the exact onchain token, pool, amount, TWAP, floor rules and expiry.");
    let plan: LivePositionGuardPreparedPlan | null = null;
    let allowanceApproved = false;
    let orderRegistered = false;
    let signerAdded = false;
    try {
      plan = await preparePlan();
      setMessage("Step 1 of 3 · confirm the exact token allowance in your RMT wallet.");
      await approveExact(plan.amountIn);
      allowanceApproved = true;
      setMessage("Step 2 of 3 · register the contract-enforced TWAP order in your wallet.");
      await registerOrder(plan);
      orderRegistered = true;
      setMessage("Step 3 of 3 · authorize only checkpoint and confirmed-exit submissions.");
      await addSigners({
        address: wallet,
        signers: [{ signerId: liveConfiguration.signerId, policyIds: [liveConfiguration.policyId] }]
      });
      signerAdded = true;
      const next = await parseStatusResponse(await fetch("/api/position-guards/live", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "arm",
          amountIn: plan.amountIn.toString(),
          orderId: plan.orderId,
          pair: plan.pair,
          settings: { ...settings, expiresAfterHours },
          token: plan.token,
          wallet
        })
      }));
      setStatus(next);
      setAuthorityReviewed(false);
      setMessage("Automatic exit is live. The contract—not the signer—enforces the token, pool, amount, 5-minute TWAP floor, confirmation window, WETH recipient and expiry.");
    } catch (cause) {
      const orderClosed = !orderRegistered || await onchainOrderClosed(plan?.orderId);
      const signersCleared = !signerAdded
        || await removeSigners({ address: wallet }).then(() => true).catch(() => false);
      const allowanceCleared = !allowanceApproved
        || await approveExact(0n).then(() => true).catch(() => false);
      if (headers) {
        await fetch("/api/position-guards/live", {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "cancel",
            token,
            wallet,
            walletAuthorityRemoved: allowanceCleared && signersCleared
          })
        }).catch(() => undefined);
      }
      const detail = cause instanceof Error ? cause.message : "Automatic exit could not be armed.";
      const residue = [
        ...(!orderClosed ? ["the onchain order may remain active"] : []),
        ...(!allowanceCleared ? ["the executor token allowance may remain"] : []),
        ...(!signersCleared ? ["one or more delegated signers may remain"] : [])
      ];
      setMessage(residue.length === 0
        ? `${detail} The incomplete onchain order and wallet authority were removed.`
        : `${detail} The order is not safely active, but ${residue.join(" and ")}. Use emergency revocation before continuing.`);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!headers || !embeddedWallet || !walletMatches) return;
    setBusy(true);
    setMessage("Cancelling the onchain order, clearing its exact allowance, removing every delegated signer, and reconciling the server record.");
    const failures: string[] = [];
    const orderClosed = await onchainOrderClosed(status.orderId);
    if (!orderClosed && status.orderId) failures.push("Onchain order: not confirmed closed");

    const allowanceCleared = await approveExact(0n).then(() => true).catch((cause) => {
      failures.push(`Token allowance: ${cause instanceof Error ? cause.message : "not cleared"}`);
      return false;
    });
    const signersCleared = await removeSigners({ address: wallet }).then(() => true).catch((cause) => {
      failures.push(`Delegated signers: ${cause instanceof Error ? cause.message : "not removed"}`);
      return false;
    });

    let serverUpdated = false;
    let next: LiveGuardStatus | null = null;
    try {
      next = await parseStatusResponse(await fetch("/api/position-guards/live", {
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
        onchainOrderClosed: orderClosed,
        systemStatus: "unverified",
        walletCleanupReported: allowanceCleared && signersCleared
      }));
    }

    if (orderClosed && allowanceCleared && signersCleared && serverUpdated) {
      setMessage(next?.revocationPending
        ? "Future wallet authority is removed. An exit was already in flight and may still settle; RMT will keep reconciling its chain result."
        : "Automatic execution is revoked: the order is closed onchain, the allowance is zero, and Privy removed all delegated signers from this RMT wallet.");
    } else {
      const completed = [
        ...(orderClosed ? ["onchain order closed"] : []),
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
  if (status.error && status.status === "error") {
    return (
      <div className="livePositionGuardControl compactState unavailable">
        <strong>Automatic-exit status could not be verified</strong>
        <p>{status.error} RMT will not request new delegated authority while the order state is unknown.</p>
        {walletMatches && (
          <button className="livePositionGuardEmergencyRevoke" type="button" disabled={busy} onClick={() => void revoke()}>
            {busy ? "Removing authority…" : "Emergency revoke wallet authority"}
          </button>
        )}
      </div>
    );
  }
  if (!armingEnabled && !hasOrderToClear) return null;
  if (!embeddedWallet || !walletMatches) {
    return (
      <div className="livePositionGuardControl compactState">
        <strong>Open the matching RMT embedded wallet</strong>
        <p>This automatic order belongs to {shortAddress(wallet)}. Switch to that embedded wallet before changing its onchain order, allowance or delegated signers.</p>
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
        <p>New authority is blocked. Guided cancellation and wallet-authority cleanup remain available for an existing RMT order.</p>
        <button className="livePositionGuardEmergencyRevoke" type="button" disabled={busy} onClick={() => void revoke()}>
          {busy ? "Removing authority…" : "Review and revoke wallet authority"}
        </button>
      </div>
    );
  }

  const transactionHref = status.transactionHash && /^0x[0-9a-fA-F]{64}$/.test(status.transactionHash)
    ? `${EXPLORER}/tx/${status.transactionHash}`
    : null;
  const displayStatus = walletCleanupRequired || onchainCleanupRequired
    ? "CLEANUP REQUIRED"
    : revocationPending
      ? "RECONCILING"
      : statusLabel(status.status ?? "");
  const heading = onchainCleanupRequired
    ? "Onchain order cancellation is incomplete"
    : walletCleanupRequired
      ? "Wallet permission cleanup is incomplete"
      : revocationPending
        ? "Future authority removed · reconciling an in-flight exit"
        : systemUnavailable
          ? "Execution system unavailable · remove wallet authority"
          : active
            ? "Contract-enforced protection continues when RMT is closed"
            : cleanupRequired
              ? "Clear the completed or interrupted permission"
              : "Authorize this position plan";

  return (
    <section className={`livePositionGuardControl ${active ? "active" : ""} ${cleanupRequired ? "cleanup" : ""} ${systemUnavailable ? "systemUnavailable" : ""}`} aria-label="Automatic Position Guard execution">
      <header>
        <span>
          <small>AUTOMATIC EXIT · ONCHAIN-BOUND DELEGATION</small>
          <strong>{heading}</strong>
        </span>
        <em>{displayStatus}</em>
      </header>

      <div className="livePositionGuardBoundary" aria-label="Automatic exit authorization boundary">
        <span><small>ORDER</small><strong>Wallet-registered onchain</strong></span>
        <span><small>TRIGGER</small><strong>5-minute TWAP + confirmation</strong></span>
        <span><small>EXECUTION</small><strong>Exact V3 pool → WETH</strong></span>
        <span><small>RECIPIENT</small><strong>Same wallet only</strong></span>
      </div>

      {systemUnavailable && (
        <p className="livePositionGuardSystemWarning" role="alert">
          {status.systemStatus === "worker_offline"
            ? "The evaluator heartbeat is stale. New orders are blocked, but onchain cancellation and emergency authority cleanup remain available."
            : status.systemStatus === "unverified"
              ? "RMT could not refresh the order state. New authority is blocked; remove wallet authority if you cannot independently verify the order."
              : "Server execution is release-locked. Remove any active onchain order, allowance and delegated signer authority before relying on local monitoring only."}
        </p>
      )}

      {active || cleanupRequired || revocationPending ? (
        <>
          <div className="livePositionGuardRuntime" aria-label="Live automatic exit status">
            <span><small>ARMED</small><strong>{timeLabel(status.armedAt)}</strong></span>
            <span><small>LAST CHECK</small><strong>{timeLabel(status.lastEvaluatedAt)}</strong></span>
            <span><small>{revocationPending || walletCleanupRequired || onchainCleanupRequired ? "REVOKE REQUESTED" : "EXPIRES"}</small><strong>{timeLabel(revocationPending || walletCleanupRequired || onchainCleanupRequired ? status.revocationRequestedAt : status.expiresAt)}</strong></span>
          </div>
          {transactionHref && <a className="livePositionGuardTransaction" href={transactionHref} target="_blank" rel="noopener noreferrer">View execution transaction ↗</a>}
          {revocationPending && !walletCleanupRequired && !onchainCleanupRequired ? (
            <p className="livePositionGuardSystemWarning" role="status">An already-authorized transaction may still confirm. RMT keeps the order in reconciliation instead of falsely marking it cancelled.</p>
          ) : (
            <button className="livePositionGuardRevoke" type="button" disabled={busy} onClick={() => void revoke()}>
              {busy
                ? "Revoking safely…"
                : onchainCleanupRequired
                  ? "Retry onchain order cancellation"
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
            <small>The onchain order stops after {durationLabel(expiresAfterHours)} even if no exit occurs.</small>
          </label>
          <label className="livePositionGuardReview">
            <input type="checkbox" checked={authorityReviewed} onChange={(event) => setAuthorityReviewed(event.target.checked)} />
            <span>I reviewed the exact token amount, V3 pool, 5-minute TWAP trigger, stop and trailing rules, WETH-only same-wallet recipient, expiry, onchain cancellation, exact allowance and delegated signer cleanup. The policy signer may only checkpoint this order or submit it after the contract confirms the floor.</span>
          </label>
          <button type="button" disabled={busy || rawBalance <= 0n || !authorityReviewed || walletCleanupRequired || onchainCleanupRequired || status.systemStatus !== "ready" || status.available === false} onClick={() => void arm()}>
            {busy ? "Securing onchain order…" : "Register and authorize automatic exit"}
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
        <p>The contract fixes the token, factory-recognized pool, amount, protection settings, 5-minute TWAP window, expiry and WETH recipient. The policy signer cannot redirect proceeds, increase the amount, choose another pool or execute before the onchain confirmation. The evaluator still controls checkpoint availability and submission timing after eligibility; those calls use the embedded wallet&apos;s native gas. Privy&apos;s revoke operation removes all additional signers on this embedded wallet.</p>
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
