"use client";

import { useEffect, useState } from "react";
import { formatEther, formatUnits, parseUnits } from "viem";
import {
  estimatedNetworkFeeUsd,
  fractionalTradeAmount,
  priceImpactTone,
  quoteSecondsRemaining
} from "../lib/trade-ticket";
import type { TradeFeeEstimateState } from "../lib/use-trade-fee-estimate";
import { normalizeTradePreferences } from "../lib/trade-preferences";
import { useTradePreferences } from "../lib/use-trade-preferences";

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
      const normalized = normalizeTradePreferences({ buyAmounts: drafts });
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

export function TradeCostSummary({
  side,
  amountIn,
  estimate,
  venueLabel
}: {
  side: "buy" | "sell";
  amountIn: bigint;
  estimate: TradeFeeEstimateState;
  venueLabel: string;
}) {
  const networkUsd = estimatedNetworkFeeUsd(estimate.feeWei, estimate.ethUsd);
  const total = side === "buy" && estimate.feeWei !== undefined && amountIn > 0n
    ? amountIn + estimate.feeWei
    : undefined;
  return (
    <section className={`tradeCostSummary ${estimate.status}`} aria-label="Pre-sign cost estimate">
      <header><span>PRE-SIGN COST CHECK</span><strong>{estimate.status === "ready" ? "Estimated" : estimate.status === "loading" ? "Calculating…" : "Wallet confirms final fee"}</strong></header>
      <div>
        <span><small>RMT PLATFORM FEE</small><strong>$0</strong></span>
        <span><small>NETWORK FEE</small><strong>{estimate.status === "ready" ? `${feeEth(estimate.feeWei)} ETH` : estimate.status === "loading" ? "Checking…" : "Unavailable"}</strong><em>{feeUsd(networkUsd)}</em></span>
        <span><small>{side === "buy" ? "ORDER + NETWORK" : "VENUE COSTS"}</small><strong>{total !== undefined ? `${feeEth(total)} ETH` : venueLabel}</strong></span>
      </div>
      <p>Gas and venue conditions can change before confirmation. Your wallet shows the final network fee before you sign.</p>
    </section>
  );
}

export function TradeExecutionPath({
  connected,
  quoteReady,
  evidenceReady,
  busy,
  success,
  needsApproval
}: {
  connected: boolean;
  quoteReady: boolean;
  evidenceReady: boolean;
  busy: boolean;
  success: boolean;
  needsApproval: boolean;
}) {
  const quoteState = quoteReady ? "done" : connected ? "current" : "pending";
  const evidenceState = evidenceReady ? "done" : quoteReady ? "current" : "pending";
  const walletState = success ? "done" : busy || (quoteReady && evidenceReady) ? "current" : "pending";
  return (
    <ol className="tradeExecutionPath" aria-label="Trade execution path">
      <li className={quoteState}><i>1</i><span><small>QUOTE</small><strong>{quoteReady ? "Route ready" : connected ? "Calculating" : "Connect"}</strong></span></li>
      <li className={evidenceState}><i>2</i><span><small>EVIDENCE</small><strong>{evidenceReady ? "Reviewed" : "Checking"}</strong></span></li>
      <li className={walletState}><i>3</i><span><small>WALLET</small><strong>{success ? "Confirmed" : busy ? needsApproval ? "Approving" : "Submitting" : needsApproval ? "Approval next" : "You sign"}</strong></span></li>
    </ol>
  );
}
