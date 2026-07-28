"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
  fractionalTradeAmount,
  priceImpactTone,
  quoteSecondsRemaining
} from "../lib/trade-ticket";

export function TradeAmountPresets({
  balance,
  decimals,
  onAmount
}: {
  balance: bigint | undefined;
  decimals: number | undefined;
  onAmount: (value: string) => void;
}) {
  const setFraction = (basisPoints: bigint) => {
    if (balance === undefined || decimals === undefined) return;
    onAmount(formatUnits(fractionalTradeAmount(balance, basisPoints), decimals));
  };
  const unavailable = balance === undefined || balance <= 0n || decimals === undefined;
  return (
    <div className="externalSushiPresets" aria-label="Wallet balance shortcuts">
      <button type="button" disabled={unavailable} onClick={() => setFraction(2_500n)}>25%</button>
      <button type="button" disabled={unavailable} onClick={() => setFraction(5_000n)}>50%</button>
      <button type="button" disabled={unavailable} onClick={() => setFraction(10_000n)}>Max</button>
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
