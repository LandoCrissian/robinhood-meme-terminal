"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { useAccount, useReadContract } from "wagmi";
import type { ExternalMarket } from "../lib/external-market";
import {
  universalRouteRecommendation,
  tradeVenueLabel,
  type TradeVenueHealth,
  type TradeVenueId,
  type TradeVenueSelectionMode
} from "../lib/trade-route-selection";
import { estimatedNetworkFeeUsd } from "../lib/trade-ticket";
import { requestTradeQuote } from "../lib/trade-quote-client";
import { quoteDebounceMs, quoteRefreshMs } from "../lib/trade-speed";
import { SUSHI_RED_SNWAPPER } from "../lib/sushi";
import {
  PERMIT2_ADDRESS,
  ROBINHOOD_SWAP_ROUTER_02,
  ROBINHOOD_UNIVERSAL_ROUTER
} from "../lib/uniswap-v4";
import { useTradeFeeEstimate } from "../lib/use-trade-fee-estimate";
import { useTradePreferences } from "../lib/use-trade-preferences";
import { useRmtIdentity } from "./rmt-identity";

type TradeVenue = {
  venue: TradeVenueId;
  pair: string;
  dexId: string;
  liquidityUsd: number;
};

type QuoteSummary = {
  venue: TradeVenueId;
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
  passportEligible?: true;
  executionFee?: { bps: number } | null;
  quotedAtMs: number;
  preparedPayload: Record<string, unknown>;
};

export type UniversalPreparedRoute = {
  venue: TradeVenueId;
  pair: string;
  quotedAtMs: number;
  payload: Record<string, unknown>;
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
  account,
  onEstimate
}: {
  quote: QuoteSummary;
  token: Address;
  side: "buy" | "sell";
  amountIn: bigint;
  account: Address;
  onEstimate?: (feeWei: bigint | undefined) => void;
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
  useEffect(() => {
    onEstimate?.(fee.feeWei);
  }, [fee.feeWei, onEstimate]);
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
  selectionMode,
  maxPriceImpact,
  onSelectVenue,
  onRecommendedVenue,
  onHealthChange,
  onPreparedRoutes
}: {
  market: ExternalMarket;
  venues: TradeVenue[];
  side: "buy" | "sell";
  amount: string;
  selectedVenue: TradeVenueId | null;
  selectionMode: TradeVenueSelectionMode;
  maxPriceImpact: number;
  onSelectVenue: (venue: TradeVenueId) => void;
  onRecommendedVenue?: (recommendation: {
    venue: TradeVenueId;
    improvementBps: number;
    backups: TradeVenueId[];
    reason: "protected-output" | "lower-network-fee" | "lower-price-impact" | "deeper-liquidity" | "fresher-quote";
  }) => void;
  onHealthChange?: (health: Partial<Record<TradeVenueId, TradeVenueHealth>>) => void;
  onPreparedRoutes?: (routes: UniversalPreparedRoute[]) => void;
}) {
  const { address } = useAccount();
  const identity = useRmtIdentity();
  const { preferences } = useTradePreferences();
  const [states, setStates] = useState<Partial<Record<TradeVenue["venue"], VenueState>>>({});
  const [refresh, setRefresh] = useState(0);
  const [networkFees, setNetworkFees] = useState<Partial<Record<TradeVenueId, string>>>({});
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
    const interval = window.setInterval(
      () => setRefresh((value) => value + 1),
      quoteRefreshMs(preferences.preparationMode)
    );
    return () => window.clearInterval(interval);
  }, [preferences.preparationMode]);

  useEffect(() => {
    if (!identity.ready || !identity.authenticated || !identity.identityToken || !identity.userId || !address || amountIn <= 0n || venues.length < 2) {
      requestKey.current = "";
      setStates({});
      return;
    }
    const nextRequestKey = `${identity.userId}:${address}:${amountIn}:${side}:${token}:${venues.map((venue) => `${venue.venue}:${venue.pair}`).join("|")}`;
    const requestChanged = requestKey.current !== nextRequestKey;
    requestKey.current = nextRequestKey;
    let cancelled = false;
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
          : candidate.venue === "uniswap-v4"
            ? "/api/trade/external-uniswap-v4"
            : "/api/trade/external-uniswap";
        try {
          const response = await requestTradeQuote(endpoint, {
            token,
            pair: candidate.pair,
            recipient: address,
            side,
            amountIn: amountIn.toString(),
            // The preference is a visible decision aid, not a quote blocker.
            // Request the complete executable set so manual routing remains possible.
            maxPriceImpactBps: 10_000
          }, {
            identityScope: identity.userId,
            identityToken: identity.identityToken
          });
          const payload = response.payload;
          if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Quote unavailable.");
          const expectedVenue = candidate.venue === "sushi"
            ? "sushi-aggregator"
            : candidate.venue;
          const output = payload.outputToken as Record<string, unknown> | undefined;
          const passport = payload.passport as Record<string, unknown> | undefined;
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
            || typeof payload.authorization !== "object"
            || payload.authorization === null
            || (payload.authorization as Record<string, unknown>).status !== "identity-wallet-bound"
            || typeof (payload.authorization as Record<string, unknown>).wallet !== "string"
            || ((payload.authorization as Record<string, unknown>).wallet as string).toLowerCase() !== address.toLowerCase()
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
            || (candidate.venue !== "sushi" && !executable)
            || (candidate.venue === "uniswap-v4" && (
              passport?.state !== "eligible"
              || typeof passport.sellTestedAtBlock !== "string"
              || !/^\d+$/.test(passport.sellTestedAtBlock)
              || typeof passport.exactTradeTestedAtBlock !== "string"
              || !/^\d+$/.test(passport.exactTradeTestedAtBlock)
              || typeof payload.router !== "string"
              || payload.router.toLowerCase() !== ROBINHOOD_UNIVERSAL_ROUTER.toLowerCase()
              || typeof payload.approvalSpender !== "string"
              || payload.approvalSpender.toLowerCase() !== PERMIT2_ADDRESS.toLowerCase()
            ))
            || (candidate.venue === "uniswap-v3" && (
              typeof payload.router !== "string"
              || payload.router.toLowerCase() !== ROBINHOOD_SWAP_ROUTER_02.toLowerCase()
            ))
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
              : candidate.venue === "uniswap-v4"
                ? PERMIT2_ADDRESS
                : ROBINHOOD_SWAP_ROUTER_02,
            outputToken: {
              // Sushi, v3 and v4 use different sentinel addresses for native ETH.
              // Normalize only the comparison identity; transaction calldata remains untouched.
              address: side === "sell" ? zeroAddress : output.address as Address,
              symbol: output.symbol.slice(0, 20),
              decimals: output.decimals
            },
            passportEligible: candidate.venue === "uniswap-v4" ? true : undefined,
            executionFee: payload.executionFee
              && typeof payload.executionFee === "object"
              && typeof (payload.executionFee as Record<string, unknown>).bps === "number"
              ? { bps: (payload.executionFee as { bps: number }).bps }
              : null,
            quotedAtMs: Date.now(),
            preparedPayload: payload
          };
          if (!cancelled) setStates((current) => ({ ...current, [candidate.venue]: { status: "ready", quote } }));
        } catch (cause) {
          if (cancelled) return;
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
    }, quoteDebounceMs(preferences.preparationMode));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [address, amountIn, identity.authenticated, identity.identityToken, identity.ready, identity.userId, preferences.preparationMode, refresh, side, token, venues]);

  useEffect(() => {
    onHealthChange?.(Object.fromEntries(venues.map((venue) => [
      venue.venue,
      states[venue.venue]?.status ?? "loading"
    ])));
  }, [onHealthChange, states, venues]);

  useEffect(() => {
    onPreparedRoutes?.(venues.flatMap((venue) => {
      const quote = states[venue.venue]?.quote;
      return quote ? [{
        venue: venue.venue,
        pair: venue.pair,
        quotedAtMs: quote.quotedAtMs,
        payload: quote.preparedPayload
      }] : [];
    }));
  }, [onPreparedRoutes, states, venues]);

  const ready = useMemo(() => venues.flatMap((venue) => {
    const quote = states[venue.venue]?.quote;
    return quote ? [{
      ...quote,
      estimatedNetworkFeeWei: networkFees[venue.venue],
      liquidityUsd: venue.liquidityUsd
    }] : [];
  }), [networkFees, states, venues]);
  const recommendation = useMemo(() => universalRouteRecommendation({
    selected: selectedVenue,
    quotes: ready,
    nowMs: Date.now(),
    maxPriceImpact
  }), [maxPriceImpact, ready, selectedVenue]);
  const higherProtectedOutput = recommendation
    ? ready.find((quote) => quote.venue === recommendation.protectedOutputLeader)
    : undefined;
  const recordNetworkFee = useCallback((venue: TradeVenueId, feeWei: bigint | undefined) => {
    const next = feeWei?.toString();
    setNetworkFees((current) => current[venue] === next ? current : { ...current, [venue]: next });
  }, []);

  useEffect(() => {
    if (
      selectionMode !== "automatic"
      || !recommendation
      || recommendation.selected === selectedVenue
    ) return;
    onRecommendedVenue?.({
      venue: recommendation.selected,
      improvementBps: recommendation.selectedOutputAdvantageBps,
      backups: recommendation.backups,
      reason: recommendation.reason
    });
  }, [
    onRecommendedVenue,
    recommendation,
    selectedVenue,
    selectionMode
  ]);

  return (
    <section className="universalVenueSelector" aria-labelledby="route-comparison-heading">
      <header>
        <div><small>UNIVERSAL EXECUTION ROUTER</small><strong id="route-comparison-heading">One order · every verified route</strong></div>
        <span>{!address ? "Connect to compare" : !identity.authenticated ? "Sign in to compare" : amountIn > 0n ? `${ready.length} ready${recommendation?.backups.length ? ` · ${recommendation.backups.length} backup${recommendation.backups.length === 1 ? "" : "s"}` : ""}` : "Enter amount below"}</span>
      </header>
      <div>
        {venues.map((candidate) => {
          const state = states[candidate.venue];
          const quote = state?.quote;
          const leads = higherProtectedOutput?.venue === candidate.venue;
          const isAutomaticChoice = recommendation?.selected === candidate.venue;
          const outsideImpactLimit = Boolean(quote && quote.priceImpact > maxPriceImpact);
          return (
            <button
              type="button"
              className={`${selectedVenue === candidate.venue ? "active" : ""} ${leads ? "leading" : ""} ${outsideImpactLimit ? "outsideLimit" : ""}`}
              aria-pressed={selectedVenue === candidate.venue}
              onClick={() => onSelectVenue(candidate.venue)}
              key={candidate.venue}
            >
              <span className="universalVenueName">
                <strong>{tradeVenueLabel(candidate.venue)}</strong>
                {(leads || isAutomaticChoice) && <em>
                  {isAutomaticChoice ? "Automatic choice" : "Best protected output"}
                </em>}
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
              {outsideImpactLimit && <span className="universalVenueLimit">Warning · above your {(maxPriceImpact * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% preference</span>}
              {quote && address && (
                <RouteNextCost
                  quote={quote}
                  token={token}
                  side={side}
                  amountIn={amountIn}
                  account={address}
                  onEstimate={(feeWei) => recordNetworkFee(candidate.venue, feeWei)}
                />
              )}
              {quote?.passportEligible && (
                <span className="universalVenueFee">Passport eligible · exact route simulated</span>
              )}
              {quote?.executionFee && (
                <span className="universalVenueFee">Includes {(quote.executionFee.bps / 100).toLocaleString()}% RMT fee · protected output is net</span>
              )}
            </button>
          );
        })}
      </div>
      <p>
        Automatic mode compares protected output, the next network fee, price impact, verified liquidity and quote freshness. Your price-impact setting remains visible as a warning; manual venue selection stays available. The final transaction is still rebuilt and rechecked before your wallet signs.
      </p>
    </section>
  );
}
