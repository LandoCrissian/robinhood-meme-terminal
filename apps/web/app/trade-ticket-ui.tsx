"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { formatEther, formatUnits, parseUnits } from "viem";
import {
  estimatedNetworkFeeUsd,
  fractionalTradeAmount,
  PRICE_IMPACT_CAUTION,
  PRICE_IMPACT_CRITICAL,
  priceImpactTone,
  quoteSecondsRemaining
} from "../lib/trade-ticket";
import {
  tradeReadinessStatus,
  type TradeEvidenceState,
  type TradeQuoteState
} from "../lib/trade-readiness";
import { routeLiquidityDepthLabel } from "../lib/trade-route-selection";
import type { TradeFeeEstimateState } from "../lib/use-trade-fee-estimate";
import { isTradePreflightReady } from "../lib/trade-preflight";
import { normalizeTradePreferences } from "../lib/trade-preferences";
import { useTradePreferences } from "../lib/use-trade-preferences";
import { speedWalletEnabled } from "../lib/privy-config";

const SpeedWalletEntry = dynamic(
  () => import("./speed-wallet-entry").then((module) => module.SpeedWalletEntry),
  { ssr: false }
);

export function TradeExecutionControls() {
  const { preferences, save } = useTradePreferences();
  const [message, setMessage] = useState("");
  const store = (next: typeof preferences) => {
    setMessage(save(next) ? "Saved on this device." : "This browser could not save that preference.");
  };

  return (
    <details className="tradeExecutionControls">
      <summary>
        <span>
          <small>YOUR EXECUTION RULES</small>
          <strong id="trade-execution-controls-heading">Control how RMT prepares trades</strong>
        </span>
        <em>
          {preferences.routePreference === "automatic"
            ? "BEST OUTPUT"
            : preferences.routePreference.toUpperCase()}
          {" · "}
          {preferences.maxPriceImpactBps === 10_000
            ? "NO IMPACT ALERT"
            : `${preferences.maxPriceImpactBps / 100}% ALERT`} · {preferences.preparationMode === "speed" ? "SPEED" : "STANDARD"}
        </em>
      </summary>
      <div className="tradeExecutionControlGroup">
        <span>
          <strong>Route preference</strong>
          <small>Automatic compares protected output. A venue preference is never silently replaced.</small>
        </span>
        <div role="group" aria-label="Default execution route">
          {([
            ["automatic", "Best output"],
            ["sushi", "Sushi"],
            ["uniswap", "Uniswap"]
          ] as const).map(([value, label]) => (
            <button
              type="button"
              aria-pressed={preferences.routePreference === value}
              className={preferences.routePreference === value ? "active" : ""}
              onClick={() => store({ ...preferences, routePreference: value })}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="tradeExecutionControlGroup">
        <span>
          <strong>Quote preparation</strong>
          <small>Speed mode preloads and shares fresh venue quotes. It never bypasses your wallet signature or execution limits.</small>
        </span>
        <div role="group" aria-label="Quote preparation mode">
          {([[
            "speed",
            "Speed"
          ], [
            "standard",
            "Standard"
          ]] as const).map(([value, label]) => (
            <button
              type="button"
              aria-pressed={preferences.preparationMode === value}
              className={preferences.preparationMode === value ? "active" : ""}
              onClick={() => store({ ...preferences, preparationMode: value })}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="tradeExecutionControlGroup">
        <span>
          <strong>Price-impact alert</strong>
          <small>Maximum price impact is not enforced by this advisory control. RMT highlights quotes above this level. It does not veto a valid order. “No RMT cap” means no advisory threshold; the quoted minimum output and exact-transaction simulation remain authoritative.</small>
        </span>
        <div role="group" aria-label="Price-impact alert">
          {([100, 200, 500, 10_000] as const).map((value) => (
            <button
              type="button"
              aria-pressed={preferences.maxPriceImpactBps === value}
              className={preferences.maxPriceImpactBps === value ? "active" : ""}
              onClick={() => store({ ...preferences, maxPriceImpactBps: value })}
              key={value}
            >
              {value === 10_000 ? "No alert" : `${value / 100}%`}
            </button>
          ))}
        </div>
      </div>
      {speedWalletEnabled && <SpeedWalletEntry />}
      {message && <p role="status">{message}</p>}
    </details>
  );
}

export function TradeAmountPresets({
  side,
  balance,
  decimals,
  onAmount
}: {
  side: "buy" | "sell";
  balance: bigint | undefined;
  decimals: number | undefined;
  onAmount: (value: string) => void;
}) {
  const { preferences, save, reset } = useTradePreferences();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<string[]>(preferences.buyAmounts);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) setDrafts(preferences.buyAmounts);
  }, [editing, preferences.buyAmounts]);

  const setFraction = (basisPoints: bigint) => {
    if (balance === undefined || decimals === undefined) return;
    onAmount(formatUnits(fractionalTradeAmount(balance, basisPoints), decimals));
  };
  const unavailable = balance === undefined || balance <= 0n || decimals === undefined;

  if (side === "buy") {
    const fitsBalance = (value: string) => {
      if (unavailable || balance === undefined || decimals === undefined) return false;
      try {
        return parseUnits(value, decimals) <= balance;
      } catch {
        return false;
      }
    };
    const storeDrafts = () => {
      const normalized = normalizeTradePreferences({ ...preferences, buyAmounts: drafts });
      if (normalized.buyAmounts.some((amount, index) => amount !== drafts[index]?.replace(/0+$/, "").replace(/\.$/, ""))) {
        setError("Enter three different positive ETH amounts, each below 1,000.");
        return;
      }
      if (!save(normalized)) {
        setError("This browser could not save the presets.");
        return;
      }
      setError("");
      setEditing(false);
    };
    return (
      <div className="tradePresetControl">
        <div className="tradePresetHeader">
          <span>QUICK BUY · SAVED ON THIS DEVICE</span>
          <button type="button" onClick={() => { setEditing((value) => !value); setError(""); }}>{editing ? "Cancel" : "Customize"}</button>
        </div>
        <div className="externalSushiPresets" aria-label="Saved quick buy amounts">
          {preferences.buyAmounts.map((value) => (
            <button type="button" disabled={!fitsBalance(value)} onClick={() => onAmount(value)} key={value}>{value} ETH</button>
          ))}
        </div>
        {editing && (
          <div className="tradePresetEditor">
            <div>
              {drafts.map((value, index) => (
                <label key={index}>
                  <span>Preset {index + 1}</span>
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`Quick buy preset ${index + 1}`}
                    value={value}
                    onChange={(event) => {
                      setDrafts((current) => current.map((amount, amountIndex) => amountIndex === index ? event.target.value.replace(/[^\d.]/g, "") : amount));
                      setError("");
                    }}
                  />
                </label>
              ))}
            </div>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button type="button" onClick={() => { reset(); setDrafts(normalizeTradePreferences(null).buyAmounts); setError(""); }}>Reset</button>
              <button type="button" onClick={storeDrafts}>Save presets</button>
            </footer>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tradePresetControl">
      <div className="tradePresetHeader"><span>SELL FROM WALLET BALANCE</span></div>
      <div className="externalSushiPresets" aria-label="Wallet balance shortcuts">
        <button type="button" disabled={unavailable} onClick={() => setFraction(2_500n)}>25%</button>
        <button type="button" disabled={unavailable} onClick={() => setFraction(5_000n)}>50%</button>
        <button type="button" disabled={unavailable} onClick={() => setFraction(10_000n)}>Max</button>
      </div>
    </div>
  );
}

export function QuoteProtection({
  deadline,
  priceImpact,
  slippageLabel
}: {
  deadline: string | undefined;
  priceImpact: number | undefined;
  slippageLabel: string;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const remaining = quoteSecondsRemaining(deadline, now);
  const tone = priceImpactTone(priceImpact);
  return (
    <div className={`tradeQuoteProtection ${tone}`} aria-label="Quote protection">
      <span><small>SLIPPAGE LIMIT</small><strong>{slippageLabel}</strong></span>
      <span><small>QUOTE FRESHNESS</small><strong>{deadline ? remaining > 0 ? `${remaining}s` : "Refreshing…" : "Waiting"}</strong></span>
      <span><small>PRICE IMPACT</small><strong>{priceImpact === undefined ? "Waiting" : `${(priceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}</strong></span>
    </div>
  );
}

export function SmartOrderGuard({
  priceImpact,
  maxPriceImpact = PRICE_IMPACT_CAUTION,
  disabled = false,
  onReduce
}: {
  priceImpact: number | undefined;
  maxPriceImpact?: number;
  disabled?: boolean;
  onReduce: () => void;
}) {
  if (priceImpact === undefined || !Number.isFinite(priceImpact) || priceImpact < 0) return null;
  const alertEnabled = maxPriceImpact < 1;
  const aboveSavedAlert = alertEnabled && priceImpact > maxPriceImpact;
  const criticalImpact = priceImpact > PRICE_IMPACT_CRITICAL;
  const elevatedImpact = priceImpact > PRICE_IMPACT_CAUTION;
  if (!aboveSavedAlert && !elevatedImpact) return null;

  const tone = criticalImpact ? "danger" : "caution";
  const actualImpactLabel = `${(priceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  const alertLabel = alertEnabled
    ? `${(maxPriceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
    : null;
  const heading = criticalImpact
    ? `Very high price impact · ${actualImpactLabel}`
    : aboveSavedAlert && alertLabel
      ? `Above your ${alertLabel} alert`
      : `Elevated price impact · ${actualImpactLabel}`;
  const explanation = criticalImpact
    ? "This order may move the market materially. RMT preserves the quoted minimum and simulates the exact transaction, but the market-risk decision remains yours."
    : aboveSavedAlert
      ? "This quote crossed your saved alert. RMT is not blocking it; reduce the amount or continue when the separate integrity checks are ready."
      : "Review the protected minimum and verified liquidity before continuing. This warning does not replace your own trading decision.";

  return (
    <div className={`smartOrderGuard ${tone}`} role={criticalImpact ? "alert" : "status"}>
      <div>
        <strong>{heading}</strong>
        <small>{explanation}</small>
      </div>
      <button type="button" disabled={disabled} onClick={onReduce}>Use safer size</button>
    </div>
  );
}

export function TradeOrderDetails({
  priceImpact,
  routeLabel,
  children
}: {
  priceImpact: number | undefined;
  routeLabel: string;
  children: ReactNode;
}) {
  const impactLabel = priceImpact === undefined
    ? "Impact pending"
    : `${(priceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% impact`;
  return (
    <details className="tradeOrderDetails">
      <summary>
        <span>
          <small>ORDER DETAILS</small>
          <strong>Protection, costs &amp; route</strong>
        </span>
        <em>{impactLabel} · {routeLabel}</em>
      </summary>
      <div>{children}</div>
    </details>
  );
}

export function FinalOrderReview({
  originalAmount,
  saferAmount,
  inputDecimals,
  inputSymbol,
  expectedReceive,
  minimumReceive,
  priceImpact,
  estimate,
  venueFee,
  routeLabel,
  rmtFeeLabel = "$0"
}: {
  originalAmount: bigint | undefined;
  saferAmount: bigint;
  inputDecimals: number | undefined;
  inputSymbol: string;
  expectedReceive: string | undefined;
  minimumReceive: string | undefined;
  priceImpact: number | undefined;
  estimate: TradeFeeEstimateState;
  venueFee: string;
  routeLabel: string;
  rmtFeeLabel?: string;
}) {
  if (
    originalAmount === undefined
    || originalAmount <= 0n
    || saferAmount <= 0n
    || saferAmount >= originalAmount
    || inputDecimals === undefined
    || expectedReceive === undefined
    || minimumReceive === undefined
  ) return null;
  const displayInput = (value: bigint) => {
    const formatted = formatUnits(value, inputDecimals);
    const numeric = Number(formatted);
    return Number.isFinite(numeric)
      ? numeric.toLocaleString(undefined, { maximumFractionDigits: 8 })
      : formatted;
  };
  return (
    <section className="tradeFinalReview" aria-label="Final safer order review">
      <header>
        <span>FINAL PRE-SIGN REVIEW</span>
        <strong>SAFER SIZE APPLIED</strong>
      </header>
      <div>
        <span><small>ORIGINAL</small><strong>{displayInput(originalAmount)} {inputSymbol}</strong></span>
        <span><small>SAFER ORDER</small><strong>{displayInput(saferAmount)} {inputSymbol}</strong></span>
        <span><small>ESTIMATED RECEIVE</small><strong>{expectedReceive}</strong></span>
        <span><small>PROTECTED MINIMUM</small><strong>{minimumReceive}</strong></span>
        <span><small>REFRESHED IMPACT</small><strong>{priceImpact === undefined ? "Checking…" : `${(priceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}</strong></span>
        <span><small>EXECUTION ROUTE</small><strong>{routeLabel}</strong></span>
      </div>
      <footer>
        <span>RMT fee <strong>{rmtFeeLabel}</strong></span>
        <span>Network <strong>{estimate.status === "ready" ? `${feeEth(estimate.feeWei)} ETH` : estimate.status === "loading" ? "Calculating…" : "Wallet confirms"}</strong></span>
        <span>Venue <strong>{venueFee}</strong></span>
      </footer>
      <p>The safer amount has a fresh quote. Your wallet still shows the final network fee before you sign.</p>
    </section>
  );
}

function feeEth(value: bigint | undefined) {
  if (value === undefined || value <= 0n) return "—";
  return Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 8,
    minimumSignificantDigits: 2
  });
}

function feeUsd(value: number | undefined) {
  if (value === undefined) return "";
  if (value < 0.01) return "<$0.01";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

export type { TradeQuoteState } from "../lib/trade-readiness";

export function TradePreSignReadiness({
  quoteState,
  estimate,
  needsApproval,
  routeLabel,
  minimumReceive,
  priceImpact,
  liquidityUsd,
  slippageLabel,
  evidenceState
}: {
  quoteState: TradeQuoteState;
  estimate: TradeFeeEstimateState;
  needsApproval: boolean;
  routeLabel: string;
  minimumReceive: string | undefined;
  priceImpact: number | undefined;
  liquidityUsd: number;
  slippageLabel: string;
  evidenceState: TradeEvidenceState;
}) {
  const quoteLabel = quoteState === "ready"
    ? `Fresh · ${slippageLabel}`
    : quoteState === "refreshing"
      ? "Refreshing"
      : quoteState === "checking"
        ? "Verifying"
        : quoteState === "error"
          ? "Unavailable"
          : "Enter amount";
  const readiness = tradeReadinessStatus(quoteState, evidenceState);
  const preflightReady = isTradePreflightReady(estimate);
  const readinessHeadline = quoteState === "ready" && evidenceState === "clear"
    ? preflightReady
      ? readiness.headline
      : estimate.status === "unavailable"
        ? "Transaction simulation failed · blocked"
        : "Simulating exact transaction"
    : readiness.headline;
  const networkFee = estimate.status === "ready"
    ? `${feeEth(estimate.feeWei)} ETH`
    : estimate.status === "loading"
      ? "Calculating"
      : estimate.status === "unavailable"
        ? "Blocked"
        : "Simulating";
  const evidenceLabel = evidenceState === "blocked"
    ? "Blocked"
    : evidenceState === "review"
      ? "Review advised"
      : evidenceState === "checking"
        ? "Checking"
        : "Reviewed";
  return (
    <section className={`tradePreSignReadiness ${readiness.tone}`} aria-live="polite">
      <header>
        <small>EXECUTION CHECK · {routeLabel}</small>
        <strong>{readinessHeadline}</strong>
      </header>
      <div>
        <span><small>QUOTE / SLIPPAGE</small><strong>{quoteLabel}</strong></span>
        <span title={minimumReceive}><small>PROTECTED MINIMUM</small><strong>{minimumReceive ?? "Waiting"}</strong></span>
        <span><small>PRICE IMPACT</small><strong>{priceImpact === undefined ? "Waiting" : `${(priceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}</strong></span>
        <span><small>LIQUIDITY DEPTH</small><strong>{routeLiquidityDepthLabel(liquidityUsd)}</strong></span>
        <span><small>NETWORK FEE</small><strong>{networkFee}</strong></span>
        <span><small>EVIDENCE / CONTROL</small><strong>{evidenceLabel} · {needsApproval ? "Exact approval" : "You sign"}</strong></span>
      </div>
    </section>
  );
}

export function TradeCostSummary({
  side,
  amountIn,
  estimate,
  venueLabel,
  rmtFeeLabel = "$0"
}: {
  side: "buy" | "sell";
  amountIn: bigint;
  estimate: TradeFeeEstimateState;
  venueLabel: string;
  rmtFeeLabel?: string;
}) {
  const networkUsd = estimatedNetworkFeeUsd(estimate.feeWei, estimate.ethUsd);
  const total = side === "buy" && estimate.feeWei !== undefined && amountIn > 0n
    ? amountIn + estimate.feeWei
    : undefined;
  return (
    <section className={`tradeCostSummary ${estimate.status}`} aria-label="Pre-sign cost estimate">
      <header><span>PRE-SIGN COST CHECK</span><strong>{estimate.status === "ready" ? "Estimated" : estimate.status === "loading" ? "Calculating…" : "Wallet confirms final fee"}</strong></header>
      <div>
        <span><small>RMT PLATFORM FEE</small><strong>{rmtFeeLabel}</strong></span>
        <span><small>NETWORK FEE</small><strong>{estimate.status === "ready" ? `${feeEth(estimate.feeWei)} ETH` : estimate.status === "loading" ? "Checking…" : "Unavailable"}</strong><em>{feeUsd(networkUsd)}</em></span>
        <span><small>{side === "buy" ? "ORDER + NETWORK" : "VENUE COSTS"}</small><strong>{total !== undefined ? `${feeEth(total)} ETH` : venueLabel}</strong></span>
      </div>
      <p>Gas and venue conditions can change before confirmation. Your wallet shows the final network fee before you sign.</p>
    </section>
  );
}

export function TradeExecutionPath({
  authenticated,
  connected,
  quoteReady,
  evidenceReady,
  busy,
  success,
  needsApproval
}: {
  authenticated: boolean;
  connected: boolean;
  quoteReady: boolean;
  evidenceReady: boolean;
  busy: boolean;
  success: boolean;
  needsApproval: boolean;
}) {
  const accountState = authenticated ? "done" : "current";
  const quoteState = quoteReady ? "done" : authenticated && connected ? "current" : "pending";
  const evidenceState = evidenceReady ? "done" : quoteReady ? "current" : "pending";
  const walletState = success ? "done" : busy || (quoteReady && evidenceReady) ? "current" : "pending";
  return (
    <ol className="tradeExecutionPath" aria-label="Trade execution path">
      <li className={accountState}><i>1</i><span><small>ACCOUNT</small><strong>{authenticated ? "Protected" : "Sign in"}</strong></span></li>
      <li className={quoteState}><i>2</i><span><small>QUOTE</small><strong>{quoteReady ? "Route ready" : connected && authenticated ? "Calculating" : "Waiting"}</strong></span></li>
      <li className={evidenceState}><i>3</i><span><small>EVIDENCE</small><strong>{evidenceReady ? "Reviewed" : "Checking"}</strong></span></li>
      <li className={walletState}><i>4</i><span><small>WALLET</small><strong>{success ? "Confirmed" : busy ? needsApproval ? "Approving" : "Submitting" : needsApproval ? "Approval next" : "You sign"}</strong></span></li>
    </ol>
  );
}
