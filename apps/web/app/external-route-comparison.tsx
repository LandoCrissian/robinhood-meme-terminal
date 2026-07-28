"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseEther, parseUnits, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { erc20Abi } from "viem";
import type { ExternalMarket } from "../lib/external-market";

type TradeVenue = {
  venue: "sushi" | "uniswap";
  pair: Address;
  dexId: string;
  liquidityUsd: number;
};

type QuoteSummary = {
  venue: "sushi" | "uniswap";
  amountIn: string;
  quoteOut: string;
  minimumOut: string;
  priceImpact: number;
  outputToken: {
    address: Address;
    symbol: string;
    decimals: number;
  };
};

type VenueState = {
  status: "loading" | "ready" | "unavailable";
  quote?: QuoteSummary;
  error?: string;
};

const ROBINHOOD_CHAIN_ID = 4663;

function displayUnits(value: string, decimals: number) {
  const formatted = formatUnits(BigInt(value), decimals);
  const numeric = Number(formatted);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : formatted;
}

function liquidity(value: number) {
  return "$" + value.toLocaleString(undefined, {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 0
  });
}

export function ExternalRouteComparison({
  market,
  venues,
  side,
  amount,
  selectedVenue,
  onSelectVenue
}: {
  market: ExternalMarket;
  venues: TradeVenue[];
  side: "buy" | "sell";
  amount: string;
  selectedVenue: "sushi" | "uniswap" | null;
  onSelectVenue: (venue: "sushi" | "uniswap") => void;
}) {
  const { address } = useAccount();
  const [states, setStates] = useState<Partial<Record<TradeVenue["venue"], VenueState>>>({});
  const [refresh, setRefresh] = useState(0);
  const token = market.address as Address;
  const decimalsRead = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: ROBINHOOD_CHAIN_ID,
    query: { enabled: side === "sell", retry: false }
  });
  const amountIn = useMemo(() => {
    if (!amount) return 0n;
    try {
      return side === "buy"
        ? parseEther(amount)
        : decimalsRead.data === undefined ? 0n : parseUnits(amount, decimalsRead.data);
    } catch {
      return 0n;
    }
  }, [amount, decimalsRead.data, side]);

  useEffect(() => {
    const interval = window.setInterval(() => setRefresh((value) => value + 1), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!address || amountIn <= 0n || venues.length < 2) {
      setStates({});
      return;
    }
    const controller = new AbortController();
    const initial = Object.fromEntries(venues.map((venue) => [venue.venue, { status: "loading" }]));
    setStates(initial);
    const timer = window.setTimeout(() => {
      void Promise.all(venues.map(async (candidate) => {
        const endpoint = candidate.venue === "sushi"
          ? "/api/trade/external-sushi-quote"
          : "/api/trade/external-uniswap";
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              pair: candidate.pair,
              recipient: address,
              side,
              amountIn: amountIn.toString()
            }),
            signal: controller.signal
          });
          const payload = await response.json() as Record<string, unknown>;
          if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Quote unavailable.");
          const expectedVenue = candidate.venue === "sushi" ? "sushi-aggregator" : "uniswap-v3";
          const output = payload.outputToken as Record<string, unknown> | undefined;
          if (
            payload.marketVerified !== true
            || payload.venue !== expectedVenue
            || typeof payload.marketPair !== "string"
            || payload.marketPair.toLowerCase() !== candidate.pair.toLowerCase()
            || typeof payload.token !== "string"
            || payload.token.toLowerCase() !== token.toLowerCase()
            || typeof payload.recipient !== "string"
            || payload.recipient.toLowerCase() !== address.toLowerCase()
            || payload.side !== side
            || payload.amountIn !== amountIn.toString()
            || typeof payload.quoteOut !== "string"
            || typeof payload.minimumOut !== "string"
            || typeof payload.priceImpact !== "number"
            || !Number.isFinite(payload.priceImpact)
            || payload.priceImpact < 0
            || payload.priceImpact > 1
            || !output
            || typeof output.address !== "string"
            || typeof output.symbol !== "string"
            || typeof output.decimals !== "number"
            || !Number.isInteger(output.decimals)
            || output.decimals < 0
            || output.decimals > 36
            || BigInt(payload.quoteOut) <= 0n
            || BigInt(payload.minimumOut) <= 0n
          ) throw new Error("RMT rejected an inconsistent comparison quote.");
          const quote: QuoteSummary = {
            venue: candidate.venue,
            amountIn: payload.amountIn,
            quoteOut: payload.quoteOut,
            minimumOut: payload.minimumOut,
            priceImpact: payload.priceImpact,
            outputToken: {
              address: output.address as Address,
              symbol: output.symbol.slice(0, 20),
              decimals: output.decimals
            }
          };
          setStates((current) => ({ ...current, [candidate.venue]: { status: "ready", quote } }));
        } catch (cause) {
          if (controller.signal.aborted) return;
          setStates((current) => ({
            ...current,
            [candidate.venue]: {
              status: "unavailable",
              error: cause instanceof Error ? cause.message : "Quote unavailable."
            }
          }));
        }
      }));
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address, amountIn, refresh, side, token, venues]);

  const ready = venues.flatMap((venue) => {
    const quote = states[venue.venue]?.quote;
    return quote ? [quote] : [];
  });
  const comparable = ready.length === venues.length
    && ready.every((quote) => (
      quote.outputToken.address.toLowerCase() === ready[0]?.outputToken.address.toLowerCase()
      && quote.outputToken.decimals === ready[0]?.outputToken.decimals
    ));
  const higherProtectedOutput = comparable
    ? ready.reduce((best, quote) => BigInt(quote.minimumOut) > BigInt(best.minimumOut) ? quote : best)
    : undefined;
  const tied = comparable && ready.every((quote) => quote.minimumOut === ready[0]?.minimumOut);

  return (
    <section className="universalVenueSelector" aria-labelledby="route-comparison-heading">
      <header>
        <div><small>VERIFIED ROUTE COMPARISON</small><strong id="route-comparison-heading">Choose execution</strong></div>
        <span>{address ? amountIn > 0n ? "Fresh · 15s" : "Enter amount below" : "Connect to compare"}</span>
      </header>
      <div>
        {venues.map((candidate) => {
          const state = states[candidate.venue];
          const quote = state?.quote;
          const leads = higherProtectedOutput?.venue === candidate.venue && !tied;
          return (
            <button
              type="button"
              className={`${selectedVenue === candidate.venue ? "active" : ""} ${leads ? "leading" : ""}`}
              aria-pressed={selectedVenue === candidate.venue}
              onClick={() => onSelectVenue(candidate.venue)}
              key={candidate.venue}
            >
              <span className="universalVenueName">
                <strong>{candidate.venue === "sushi" ? "Sushi" : "Uniswap"}</strong>
                {leads && <em>Higher protected output</em>}
              </span>
              <span>{liquidity(candidate.liquidityUsd)} verified liquidity</span>
              <span className="universalVenueQuote">
                {state?.status === "loading"
                  ? "Comparing…"
                  : quote
                    ? `${displayUnits(quote.minimumOut, quote.outputToken.decimals)} ${quote.outputToken.symbol} min`
                    : address && amountIn > 0n ? "Route unavailable" : "Select venue"}
              </span>
              {quote && <span>{(quote.priceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% impact</span>}
            </button>
          );
        })}
      </div>
      <p>
        Recommendation compares protected minimum output for the same amount—not guaranteed final value.
        The selected ticket separately estimates network cost and rebuilds the transaction before signing.
      </p>
    </section>
  );
}
