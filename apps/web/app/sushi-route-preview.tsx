"use client";

import { useEffect, useState } from "react";
import { formatEther, formatUnits, type Address } from "viem";
import { activeChain } from "../lib/network";
import type { SushiIndicativeQuote } from "../lib/sushi";
import { useRmtIdentity } from "./rmt-identity";

const enabled = process.env.NEXT_PUBLIC_RMT_SUSHI_QUOTES_ENABLED === "true";

function displayAmount(value: bigint, side: "buy" | "sell", symbol: string) {
  const formatted = side === "buy" ? formatUnits(value, 18) : formatEther(value);
  const numeric = Number(formatted);
  const amount = Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits: side === "buy" ? 4 : 8 })
    : formatted;
  return `${amount} ${side === "buy" ? symbol : "ETH"}`;
}

export function SushiRoutePreview({
  launchId,
  token,
  recipient,
  side,
  amountIn,
  symbol
}: {
  launchId: bigint;
  token: Address;
  recipient?: Address;
  side: "buy" | "sell";
  amountIn: bigint;
  symbol: string;
}) {
  const identity = useRmtIdentity();
  const [quote, setQuote] = useState<SushiIndicativeQuote>();
  const [status, setStatus] = useState<"idle" | "loading" | "unavailable">("idle");

  useEffect(() => {
    setQuote(undefined);
    setStatus("idle");
    if (!enabled || !identity.ready || !identity.authenticated || !identity.identityToken || !identity.userId || !recipient || amountIn <= 0n) return;
    const identityToken = identity.identityToken;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void fetch("/api/trade/sushi-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", "privy-id-token": identityToken },
        body: JSON.stringify({ launchId: launchId.toString(), token, recipient, side, amountIn: amountIn.toString() }),
        signal: controller.signal
      }).then(async (response) => {
        const payload = await response.json() as (SushiIndicativeQuote & { authorization: { status: "identity-wallet-bound"; wallet: Address } }) | { error?: string };
        if (!response.ok
          || !("verifiedInput" in payload)
          || payload.verifiedInput !== true
          || payload.executable !== false
          || payload.venue !== "sushi-aggregator"
          || payload.chainId !== activeChain.id
          || payload.token.toLowerCase() !== token.toLowerCase()
          || payload.recipient.toLowerCase() !== recipient.toLowerCase()
          || payload.authorization?.status !== "identity-wallet-bound"
          || payload.authorization.wallet.toLowerCase() !== recipient.toLowerCase()
          || payload.side !== side
          || payload.amountIn !== amountIn.toString()) throw new Error("Sushi quote unavailable");
        setQuote(payload);
        setStatus("idle");
      }).catch(() => {
        if (!controller.signal.aborted) setStatus("unavailable");
      });
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [amountIn, identity.authenticated, identity.identityToken, identity.ready, identity.userId, launchId, recipient, side, token]);

  if (!enabled || !recipient || amountIn <= 0n) return null;
  return <div className="sushiRoutePreview" aria-live="polite">
    <div><span>Sushi route preview</span><strong>{status === "loading" ? "Checking…" : quote ? displayAmount(BigInt(quote.quoteOut), side, symbol) : "No complete route"}</strong></div>
    {quote ? <small>{(quote.priceImpact * 100).toFixed(2)}% price impact · indicative only</small> : status === "unavailable" ? <small>Canonical RMT execution remains available.</small> : null}
  </div>;
}
