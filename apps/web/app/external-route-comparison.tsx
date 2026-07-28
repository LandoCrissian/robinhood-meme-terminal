"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  type Address,
  type Hex
} from "viem";
import { useAccount, useReadContract } from "wagmi";
import type { ExternalMarket } from "../lib/external-market";
import type { TradeVenueHealth, TradeVenueId } from "../lib/trade-route-selection";
import { estimatedNetworkFeeUsd } from "../lib/trade-ticket";
import { SUSHI_RED_SNWAPPER } from "../lib/sushi";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../lib/uniswap-v4";
import { useTradeFeeEstimate } from "../lib/use-trade-fee-estimate";

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
  deadline: string;
  executable: boolean;
  router?: Address;
  calldata?: Hex;
  value?: string;
  approvalRequired: boolean;
  approvalSpender: Address;
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

function feeEth(value: bigint | undefined) {
  if (value === undefined || value <= 0n) return "Unavailable";
  return `${Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 8,
    minimumSignificantDigits: 2
  })} ETH`;
}

function RouteNextCost({
  quote,
  token,
  side,
  amountIn,
  account
}: {
  quote: QuoteSummary;
  token: Address;
  side: "buy" | "sell";
  amountIn: bigint;
  account: Address;
}) {
  const allowance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, quote.approvalSpender],
    chainId: ROBINHOOD_CHAIN_ID,
    query: { enabled: side === "sell", retry: false }
  });
  const needsApproval = side === "sell" && (
    quote.approvalRequired
    || (allowance.data !== undefined && allowance.data < amountIn)
  );
  const approvalData = needsApproval
    ? encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [quote.approvalSpender, amountIn]
      })
    : undefined;
  const fee = useTradeFeeEstimate({
    account,
    to: needsApproval ? token : quote.router,
    data: needsApproval ? approvalData : quote.calldata,
    value: needsApproval ? 0n : quote.value ? BigInt(quote.value) : 0n,
    enabled: amountIn > 0n && (
      needsApproval
      || (quote.executable && Boolean(quote.router && quote.calldata))
    )
  });
  const usd = estimatedNetworkFeeUsd(fee.feeWei, fee.ethUsd);
  return (
    <span className="universalVenueFee">
      {fee.status === "loading"
        ? "Next network fee: checking…"
        : fee.status === "ready"
          ? `Next ${needsApproval ? "approval" : "swap"}: ${feeEth(fee.feeWei)}${usd !== undefined ? ` · ${usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`}` : ""}`
          : needsApproval || quote.executable ? "Next network fee: wallet confirms" : "Approve first to price swap gas"}
    </span>
  );
}

export function ExternalRouteComparison({
  market,
  venues,
  side,
  amount,
  selectedVenue,
  onSelectVenue,
  onHealthChange
}: {
  market: ExternalMarket;
  venues: TradeVenue[];
  side: "buy" | "sell";
  amount: string;
  selectedVenue: "sushi" | "uniswap" | null;
  onSelectVenue: (venue: "sushi" | "uniswap") => void;
  onHealthChange?: (health: Partial<Record<TradeVenueId, TradeVenueHealth>>) => void;
}) {
  const { address } = useAccount();
  const [states, setStates] = useState<Partial<Record<TradeVenue["venue"], VenueState>>>({});
  const [refresh, setRefresh] = useState(0);
  const requestKey = useRef("");
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
      requestKey.current = "";
      setStates({});
      return;
    }
    const nextRequestKey = `${address}:${amountIn}:${side}:${token}:${venues.map((venue) => `${venue.venue}:${venue.pair}`).join("|")}`;
    const requestChanged = requestKey.current !== nextRequestKey;
    requestKey.current = nextRequestKey;
    const controller = new AbortController();
    if (requestChanged) {
      setStates(Object.fromEntries(venues.map((venue) => [venue.venue, { status: "loading" }])));
    } else {
      setStates((current) => {
        const next = { ...current };
        venues.forEach((venue) => {
          if (!next[venue.venue]) next[venue.venue] = { status: "loading" };
        });
        return next;
      });
    }
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
          const executable = payload.executable === true;
          const deadline = candidate.venue === "sushi" ? payload.quoteExpiresAt : payload.deadline;
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
            || typeof deadline !== "string"
            || !/^\d+$/.test(deadline)
            || BigInt(deadline) <= BigInt(Math.floor(Date.now() / 1000) + 15)
            || (candidate.venue === "uniswap" && !executable)
            || (executable && (
              typeof payload.router !== "string"
              || typeof payload.calldata !== "string"
              || !payload.calldata.startsWith("0x")
              || typeof payload.value !== "string"
            ))
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
            deadline,
            executable,
            router: executable ? payload.router as Address : undefined,
            calldata: executable ? payload.calldata as Hex : undefined,
            value: executable ? payload.value as string : undefined,
            approvalRequired: payload.approvalRequired === true,
            approvalSpender: candidate.venue === "sushi"
              ? SUSHI_RED_SNWAPPER
              : ROBINHOOD_SWAP_ROUTER_02,
            outputToken: {
              address: output.address as Address,
              symbol: output.symbol.slice(0, 20),
              decimals: output.decimals
            }
          };
          setStates((current) => ({ ...current, [candidate.venue]: { status: "ready", quote } }));
        } catch (cause) {
          if (controller.signal.aborted) return;
          setStates((current) => {
            const existing = current[candidate.venue];
            const existingStillFresh = existing?.quote
              && BigInt(existing.quote.deadline) > BigInt(Math.floor(Date.now() / 1000) + 15);
            if (existingStillFresh) return current;
            return {
              ...current,
              [candidate.venue]: {
                status: "unavailable",
                error: cause instanceof Error ? cause.message : "Quote unavailable."
              }
            };
          });
        }
      }));
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address, amountIn, refresh, side, token, venues]);

  useEffect(() => {
    onHealthChange?.(Object.fromEntries(venues.map((venue) => [
      venue.venue,
      states[venue.venue]?.status ?? "loading"
    ])));
  }, [onHealthChange, states, venues]);

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
              {quote && address && (
                <RouteNextCost
                  quote={quote}
                  token={token}
                  side={side}
                  amountIn={amountIn}
                  account={address}
                />
              )}
            </button>
          );
        })}
      </div>
      <p>
        Recommendation compares protected minimum output for the same amount—not guaranteed net value.
        Each fee is the next wallet action only; the selected ticket rebuilds and rechecks the final transaction before signing.
      </p>
    </section>
  );
}
