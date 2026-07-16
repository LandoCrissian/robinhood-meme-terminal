"use client";

import { useCallback, useEffect, useState } from "react";

type ExternalMarket = {
  address: string;
  name: string;
  symbol: string;
  pairAddress: string;
  url: string;
  dexId: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  pairCreatedAt: number | null;
};

type ExternalMarketResponse = {
  markets?: ExternalMarket[];
  source?: string;
  updatedAt?: string;
  error?: string;
};

function money(value: number, price = false) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (price && value < 0.0001) {
    return "$" + value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  return "$" + value.toLocaleString(undefined, {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: price ? 6 : 0
  });
}

function cleanSymbol(symbol: string) {
  return symbol.split("$").join("");
}

function initials(symbol: string) {
  return cleanSymbol(symbol).slice(0, 2).toUpperCase() || "↗";
}

export function ExternalMarketFeed() {
  const [markets, setMarkets] = useState<ExternalMarket[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/markets/external", { cache: "no-store" });
      const payload = (await response.json()) as ExternalMarketResponse;
      if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error || "Market data unavailable.");
      setMarkets(payload.markets);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return (
    <section className="panel externalMarkets" aria-labelledby="external-markets-title">
      <div className="feedHeading externalHeading">
        <div>
          <p className="eyebrow">ROBINHOOD CHAIN · EXTERNAL DISCOVERY</p>
          <h2 id="external-markets-title">Markets beyond RMT</h2>
          <p>Active WETH- and USDG-paired markets discovered onchain. Launchpad origin stays unverified until a factory adapter proves it.</p>
        </div>
        <span className="externalBadge">READ ONLY</span>
      </div>

      {status === "loading" ? (
        <div className="emptyFeed" role="status"><strong>Loading external markets…</strong><span>Checking active Robinhood Chain liquidity and trading activity.</span></div>
      ) : status === "error" ? (
        <div className="emptyFeed"><strong>External markets are temporarily unavailable.</strong><span>RMT launches and trading are unaffected.</span><button type="button" onClick={() => void refresh()}>Try again</button></div>
      ) : markets.length === 0 ? (
        <div className="emptyFeed"><strong>No external markets passed the filter.</strong><span>Only markets with at least $1,000 liquidity and 24-hour activity are shown.</span></div>
      ) : (
        <div className="externalMarketGrid">
          {markets.map((market) => {
            const changeClass = market.priceChange24h > 0 ? "positive" : market.priceChange24h < 0 ? "negative" : "flat";
            return (
              <article className="externalMarketCard" key={market.address}>
                <div className="externalIdentity">
                  <span className="coin externalArtwork" aria-hidden="true">{initials(market.symbol)}</span>
                  <span><strong>{market.name}</strong><small>{"$" + cleanSymbol(market.symbol)} · {market.dexId}</small></span>
                  <em>Origin unverified</em>
                </div>
                <div className="externalPrice">
                  <span><small>Price</small><strong>{money(market.priceUsd, true)}</strong></span>
                  <span className={"externalChange " + changeClass}><small>24h</small><strong>{market.priceChange24h > 0 ? "+" : ""}{market.priceChange24h.toFixed(2)}%</strong></span>
                </div>
                <div className="externalStats">
                  <span><small>Liquidity</small><strong>{money(market.liquidityUsd)}</strong></span>
                  <span><small>24h volume</small><strong>{money(market.volume24h)}</strong></span>
                  <span><small>Activity</small><strong>{market.buys24h} buys · {market.sells24h} sells</strong></span>
                </div>
                <a className="externalChartLink" href={market.url} target="_blank" rel="noreferrer" aria-label={"View " + market.name + " chart on DEX Screener"}>View market ↗</a>
              </article>
            );
          })}
        </div>
      )}

      <p className="externalDisclosure">Market data: DEX Screener. These tokens were not launched, scored, or verified by RMT. External origin, contracts, economics, and liquidity rules may differ.</p>
    </section>
  );
}
