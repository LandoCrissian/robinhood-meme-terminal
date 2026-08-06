"use client";

import Link from "next/link";
import { useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { type Address } from "viem";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  livePositionGuardReviewMessage,
  type LivePositionGuardReviewReason
} from "../../lib/live-position-guard-review";
import { LivePositionGuardControls } from "../live-position-guard-controls";

type ProtectionOrder = {
  id: string;
  wallet: string;
  token: string;
  pair: string;
  executor: string;
  status: string;
  reviewReason: LivePositionGuardReviewReason | null;
  orderId: string | null;
  amountIn: string | null;
  armedAt: number | null;
  expiresAt: number | null;
  lastEvaluatedAt: number | null;
  revocationRequestedAt: number | null;
  revocationPending: boolean;
  walletCleanupReported: boolean | null;
  onchainOrderClosed: boolean | null;
  transactionHash: string | null;
  checkpointTransactionHash: string | null;
  fee: number | null;
  twapSeconds: number | null;
  maxSlippageBps: number | null;
  settings: {
    stopLossBps: number;
    trailingStopBps: number;
    breakEvenActivationBps: number;
    maxPriceImpactBps: number;
  } | null;
};

type ProtectionPayload = {
  available?: boolean;
  capped?: boolean;
  orders?: ProtectionOrder[];
  systemStatus?: string;
  updatedAt?: number;
  error?: string;
};

type View = "active" | "attention" | "history" | "all";

const ACTIVE = new Set(["active", "confirming", "executing", "submitted"]);
const ATTENTION = new Set(["review_required", "approval_required", "no_position"]);
const HISTORY = new Set(["executed", "expired", "cancelled"]);
const EXPLORER = "https://robinhoodchain.blockscout.com";
const RECOVERY_SETTINGS = {
  stopLossBps: 2_000,
  trailingStopBps: 2_000,
  breakEvenActivationBps: 5_000,
  maxPriceImpactBps: 400
} as const;

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function timeLabel(value: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function statusLabel(order: ProtectionOrder) {
  if (order.onchainOrderClosed === false && order.revocationRequestedAt) return "ONCHAIN CLEANUP";
  if (order.walletCleanupReported === false && order.revocationRequestedAt) return "WALLET CLEANUP";
  if (order.revocationPending) return "RECONCILING";
  if (order.status === "active") return "ACTIVE";
  if (order.status === "confirming") return "VERIFYING TRIGGER";
  if (order.status === "executing") return "EXECUTING";
  if (order.status === "submitted") return "EXIT SUBMITTED";
  if (order.status === "executed") return "EXECUTED";
  if (order.status === "expired") return "EXPIRED";
  if (order.status === "cancelled") return "CANCELLED";
  if (order.status === "approval_required") return "APPROVAL ENDED";
  if (order.status === "no_position") return "NO POSITION";
  return "REVIEW REQUIRED";
}

function statusClass(order: ProtectionOrder) {
  if (
    (order.onchainOrderClosed === false || order.walletCleanupReported === false)
    && order.revocationRequestedAt
  ) return "attention";
  if (order.revocationPending) return "pending";
  if (ACTIVE.has(order.status)) return "active";
  if (ATTENTION.has(order.status)) return "attention";
  if (order.status === "executed") return "complete";
  return "inactive";
}

function percentFromBps(value: number | undefined | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function matchesView(order: ProtectionOrder, view: View) {
  if (view === "all") return true;
  if (view === "active") return ACTIVE.has(order.status) || order.revocationPending;
  if (view === "attention") {
    return ATTENTION.has(order.status)
      || order.walletCleanupReported === false
      || order.onchainOrderClosed === false
      || (!ACTIVE.has(order.status) && !HISTORY.has(order.status));
  }
  return HISTORY.has(order.status);
}

function protectedAmount(value: string | null) {
  if (!value || !/^[0-9]+$/.test(value)) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function ProtectionCenter() {
  const { authenticated, login, ready } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets, ready: walletsReady } = useWallets();
  const [payload, setPayload] = useState<ProtectionPayload>({});
  const [view, setView] = useState<View>("active");
  const [managedOrderId, setManagedOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!identityToken || !authenticated) {
      setLoading(false);
      return;
    }
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/position-guards/live/list", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${identityToken}` },
        signal
      });
      const next = await response.json() as ProtectionPayload;
      if (!response.ok) throw new Error(next.error ?? "The protection inventory could not be loaded.");
      setPayload(next);
      setError("");
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "The protection inventory could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authenticated, identityToken]);

  useEffect(() => {
    if (!authenticated || !identityToken) {
      setLoading(false);
      setPayload({});
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(controller.signal, true);
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [authenticated, identityToken, load]);

  const orders = payload.orders ?? [];
  const counts = useMemo(() => ({
    active: orders.filter((order) => matchesView(order, "active")).length,
    attention: orders.filter((order) => matchesView(order, "attention")).length,
    history: orders.filter((order) => matchesView(order, "history")).length,
    all: orders.length
  }), [orders]);
  const visibleOrders = useMemo(
    () => orders.filter((order) => matchesView(order, view)),
    [orders, view]
  );
  const embeddedWallets = wallets.filter((wallet) => wallet.walletClientType === "privy");
  const systemLabel = loading && !payload.systemStatus
    ? "VERIFYING SYSTEM"
    : payload.systemStatus === "ready"
      ? "EVALUATOR ONLINE"
      : payload.systemStatus === "worker_offline"
        ? "EVALUATOR OFFLINE"
        : "NEW AUTHORITY LOCKED";

  if (!ready || !walletsReady) {
    return (
      <main className="protectionCenterPage">
        <section className="protectionCenterState"><span className="protectionSpinner" /><strong>Opening protection inventory…</strong></section>
      </main>
    );
  }

  if (!authenticated || !identityToken) {
    return (
      <main className="protectionCenterPage">
        <section className="protectionCenterIntro compact">
          <p className="eyebrow">RMT · CONTINUING WALLET AUTHORITY</p>
          <h1>Protection Center</h1>
          <p>Sign in to recover automatic Position Guard orders independently of browser storage, review continuing onchain and wallet authority, and revoke from the exact embedded wallet that authorized each order.</p>
          <div className="protectionCenterIntroActions">
            <button type="button" onClick={login}>Sign in to review orders</button>
            <Link href="/">Return to terminal</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="protectionCenterPage">
      <section className="protectionCenterIntro">
        <div>
          <p className="eyebrow">RMT · AUTOMATIC POSITION GUARD</p>
          <h1>Protection Center</h1>
          <p>Every server-backed automatic exit tied to your RMT identity, including registered onchain orders that this browser has never seen and positions whose remaining token balance is zero.</p>
        </div>
        <div className="protectionCenterIntroActions">
          <button type="button" disabled={refreshing} onClick={() => void load(undefined, true)}>{refreshing ? "Refreshing…" : "Refresh status"}</button>
          <Link href="/">Market terminal</Link>
        </div>
      </section>

      <section className="protectionSystemStrip" aria-label="Protection system status">
        <span className={payload.systemStatus === "ready" ? "online" : "offline"}><i />{systemLabel}</span>
        <span><b>RMT WALLETS</b>{embeddedWallets.length}</span>
        <span><b>ORDERS</b>{orders.length}</span>
        <span><b>LAST REFRESH</b>{payload.updatedAt ? timeLabel(payload.updatedAt) : "—"}</span>
      </section>

      {payload.systemStatus && payload.systemStatus !== "ready" && (
        <section className="protectionCenterWarning" role="alert">
          <strong>New automatic authority is blocked.</strong>
          <span>Existing registered orders and wallet permissions still require review. Open an order&apos;s authority controls below to cancel it onchain, clear token allowance, remove delegated signers, and reconcile the server record.</span>
        </section>
      )}

      {payload.capped && (
        <section className="protectionCenterWarning" role="status">
          <strong>Inventory limit reached.</strong>
          <span>Up to {orders.length} records are shown. Historical export is required before treating this as a complete lifetime inventory.</span>
        </section>
      )}

      <section className="protectionInventory">
        <header>
          <div>
            <p className="eyebrow">ONCHAIN ORDERS, WALLET PERMISSIONS AND EXECUTION STATE</p>
            <h2>Automatic orders</h2>
          </div>
          <nav className="protectionTabs" aria-label="Protection order filters">
            {(["active", "attention", "history", "all"] as const).map((item) => (
              <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => setView(item)}>
                {item === "active" ? "Live" : item === "attention" ? "Needs review" : item === "history" ? "History" : "All"}
                <span>{counts[item]}</span>
              </button>
            ))}
          </nav>
        </header>

        {error && <div className="protectionCenterError" role="alert"><strong>Status refresh failed</strong><span>{error}</span></div>}

        {loading ? (
          <div className="protectionCenterState"><span className="protectionSpinner" /><strong>Verifying server orders…</strong></div>
        ) : visibleOrders.length === 0 ? (
          <div className="protectionCenterState empty">
            <strong>{view === "active" ? "No live automatic exits" : "No orders in this view"}</strong>
            <span>Local Position Guard rules are stored separately in the browser and do not appear here unless automatic execution was authorized.</span>
            <Link href="/">Open the market terminal</Link>
          </div>
        ) : (
          <div className="protectionOrderList">
            {visibleOrders.map((order) => {
              const reviewMessage = livePositionGuardReviewMessage(order.reviewReason, order.status);
              const managing = managedOrderId === order.id;
              const settings = order.settings ?? RECOVERY_SETTINGS;
              return (
                <article className={`protectionOrder ${statusClass(order)}`} key={order.id}>
                  <header>
                    <div className="protectionOrderIdentity">
                      <span>{shortAddress(order.token)}</span>
                      <strong>{statusLabel(order)}</strong>
                    </div>
                    <span className="protectionOrderStatus"><i />{statusLabel(order)}</span>
                  </header>

                  <dl className="protectionOrderMetrics">
                    <div><dt>WALLET</dt><dd title={order.wallet}>{shortAddress(order.wallet)}</dd></div>
                    <div><dt>ARMED</dt><dd>{timeLabel(order.armedAt)}</dd></div>
                    <div><dt>LAST CHECK</dt><dd>{timeLabel(order.lastEvaluatedAt)}</dd></div>
                    <div><dt>{order.revocationPending ? "REVOKE REQUESTED" : "EXPIRES"}</dt><dd>{timeLabel(order.revocationPending ? order.revocationRequestedAt : order.expiresAt)}</dd></div>
                  </dl>

                  <div className="protectionOrderRules">
                    <span><small>STOP</small><strong>−{percentFromBps(order.settings?.stopLossBps)}</strong></span>
                    <span><small>TRAIL</small><strong>−{percentFromBps(order.settings?.trailingStopBps)}</strong></span>
                    <span><small>BREAK EVEN</small><strong>+{percentFromBps(order.settings?.breakEvenActivationBps)}</strong></span>
                    <span><small>TWAP / SLIPPAGE</small><strong>{order.twapSeconds ? `${Math.round(order.twapSeconds / 60)}m` : "—"} / {percentFromBps(order.maxSlippageBps)}</strong></span>
                  </div>

                  {order.orderId && (
                    <p className="protectionOrderNotice">Registered order {shortAddress(order.orderId)} · V3 fee {order.fee?.toLocaleString() ?? "—"} · same-wallet WETH recipient.</p>
                  )}
                  {order.revocationPending && (
                    <p className="protectionOrderNotice">Future authority may already be removed, but an exit was in flight. A submitted transaction can still settle and remains under reconciliation.</p>
                  )}
                  {order.onchainOrderClosed === false && order.revocationRequestedAt && (
                    <p className="protectionOrderNotice danger">The registered executor order is not proven cancelled, executed, or expired. Retry onchain order cancellation below.</p>
                  )}
                  {order.walletCleanupReported === false && order.revocationRequestedAt && (
                    <p className="protectionOrderNotice danger">The server received a revoke request without proof that both the token allowance and all additional signers were removed. Retry wallet cleanup below.</p>
                  )}
                  {reviewMessage
                    && !order.revocationPending
                    && !(order.walletCleanupReported === false && order.revocationRequestedAt)
                    && !(order.onchainOrderClosed === false && order.revocationRequestedAt)
                    && <p className="protectionOrderNotice danger">{reviewMessage}</p>}

                  <footer>
                    <button
                      className="protectionPrimaryAction"
                      type="button"
                      aria-expanded={managing}
                      aria-controls={`protection-order-controls-${order.id}`}
                      onClick={() => setManagedOrderId(managing ? null : order.id)}
                    >
                      {managing ? "Close authority controls" : "Review authority"}
                    </button>
                    <Link href={`/market/${order.token}`}>Market</Link>
                    <a href={`${EXPLORER}/address/${order.executor}`} target="_blank" rel="noopener noreferrer">Executor ↗</a>
                    {order.checkpointTransactionHash && <a href={`${EXPLORER}/tx/${order.checkpointTransactionHash}`} target="_blank" rel="noopener noreferrer">Checkpoint ↗</a>}
                    {order.transactionHash && <a href={`${EXPLORER}/tx/${order.transactionHash}`} target="_blank" rel="noopener noreferrer">Execution ↗</a>}
                  </footer>

                  {managing && (
                    <section className="protectionOrderManagement" id={`protection-order-controls-${order.id}`}>
                      <p>These controls target the exact embedded wallet shown above. Arming is disabled here; only status recovery, onchain cancellation, allowance cleanup, signer removal, and transaction reconciliation are available.</p>
                      <LivePositionGuardControls
                        armingEnabled={false}
                        pair={order.pair as Address}
                        rawBalance={protectedAmount(order.amountIn)}
                        settings={settings}
                        token={order.token as Address}
                        wallet={order.wallet as Address}
                      />
                    </section>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="protectionTrustBoundary">
        <h2>What this inventory proves</h2>
        <p>It proves which server records RMT can associate with the signed-in identity and exposes their registered order IDs and transaction evidence. It does not, by itself, prove that an onchain order is closed, that a token allowance is zero, that every additional signer is removed, or that an already-submitted transaction cannot settle. The order&apos;s authority controls perform onchain cancellation and wallet cleanup while preserving reconciliation state.</p>
      </section>
    </main>
  );
}
