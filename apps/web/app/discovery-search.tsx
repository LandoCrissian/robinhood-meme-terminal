"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LaunchFeedItem, LaunchFeedResponse } from "../lib/launch-feed";
import { ipfsToHttp } from "../lib/token-metadata";

type ExternalMarket = {
  address: string;
  name: string;
  symbol: string;
  url: string;
  dexId: string;
  liquidityUsd: number;
  volume24h: number;
};

type ExternalResponse = {
  markets?: ExternalMarket[];
};

function matches(value: string, query: string) {
  return value.toLowerCase().includes(query);
}

function compactMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return `$${value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 })}`;
}

function cleanSymbol(symbol: string) {
  return symbol.replace(/^\$+/, "");
}

export function DiscoverySearch() {
  const [query, setQuery] = useState("");
  const [rmtResults, setRmtResults] = useState<LaunchFeedItem[]>([]);
  const [externalResults, setExternalResults] = useState<ExternalMarket[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle");
  const normalized = useMemo(() => query.trim().toLowerCase(), [query]);

  useEffect(() => {
    if (normalized.length < 2) {
      setRmtResults([]);
      setExternalResults([]);
      setState("idle");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setState("loading");

      const [rmtResponse, externalResponse] = await Promise.allSettled([
        fetch("/api/launches", { cache: "no-store", signal: controller.signal }),
        fetch("/api/markets/external", { cache: "no-store", signal: controller.signal })
      ]);

      let launches: LaunchFeedItem[] = [];
      let markets: ExternalMarket[] = [];

      if (rmtResponse.status === "fulfilled" && rmtResponse.value.ok) {
        const payload = (await rmtResponse.value.json()) as LaunchFeedResponse;
        launches = Array.isArray(payload.launches) ? payload.launches : [];
      }
      if (externalResponse.status === "fulfilled" && externalResponse.value.ok) {
        const payload = (await externalResponse.value.json()) as ExternalResponse;
        markets = Array.isArray(payload.markets) ? payload.markets : [];
      }

      if (!controller.signal.aborted) {
        setRmtResults(launches.filter((launch) =>
          matches(launch.name, normalized)
          || matches(cleanSymbol(launch.symbol), normalized)
          || matches(launch.token, normalized)
        ).slice(0, 6));
        setExternalResults(markets.filter((market) =>
          matches(market.name, normalized)
          || matches(cleanSymbol(market.symbol), normalized)
          || matches(market.address, normalized)
        ).slice(0, 6));
        setState("ready");
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [normalized]);

  const resultCount = rmtResults.length + externalResults.length;
  const showResults = normalized.length >= 2;

  return (
    <section className="discoverySearch panel" aria-labelledby="discovery-search-title">
      <div className="searchLead">
        <p className="eyebrow">FIND A TOKEN</p>
        <h2 id="discovery-search-title">Search tokens</h2>
        <p>Search verified RMT launches and surfaced external markets by name, ticker, or contract address.</p>
      </div>
      <div className="searchControl">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, ticker, or 0x address"
          aria-label="Search RMT and external Robinhood Chain tokens"
        />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">Clear</button>}
      </div>

      {showResults && (
        <div className="searchResults" aria-live="polite">
          {state === "loading" ? (
            <p className="searchMessage">Searching available markets…</p>
          ) : resultCount === 0 ? (
            <p className="searchMessage">No matching RMT launches or filtered external markets.</p>
          ) : (
            <>
              {rmtResults.length > 0 && <div className="searchGroup">
                <div className="searchGroupTitle"><strong>Verified RMT launches</strong><span>{rmtResults.length}</span></div>
                <div className="searchResultGrid">{rmtResults.map((launch) => (
                  <Link className="searchResult" href={`/token/${launch.token}`} key={launch.token}>
                    <span className="coin searchArtwork">{launch.image ? <img src={ipfsToHttp(launch.image)} alt="" loading="lazy" /> : cleanSymbol(launch.symbol).slice(0, 2)}</span>
                    <span><strong>{launch.name}</strong><small>${cleanSymbol(launch.symbol)} · RMT verified</small></span>
                    <em>Open →</em>
                  </Link>
                ))}</div>
              </div>}
              {externalResults.length > 0 && <div className="searchGroup externalSearchGroup">
                <div className="searchGroupTitle"><strong>External DEX markets</strong><span>{externalResults.length}</span></div>
                <div className="searchResultGrid">{externalResults.map((market) => (
                  <a className="searchResult" href={market.url} target="_blank" rel="noreferrer" key={market.address}>
                    <span className="coin searchArtwork muted">{cleanSymbol(market.symbol).slice(0, 2)}</span>
                    <span><strong>{market.name}</strong><small>${cleanSymbol(market.symbol)} · {market.dexId} · {compactMoney(market.liquidityUsd)} liquidity</small></span>
                    <em>Chart ↗</em>
                  </a>
                ))}</div>
                <p className="searchDisclosure">External markets are not launched, scored, or verified by RMT.</p>
              </div>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
