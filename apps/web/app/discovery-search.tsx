"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LaunchFeedItem, LaunchFeedResponse } from "../lib/launch-feed";
import { ipfsToHttp } from "../lib/token-metadata";

function matches(value: string, query: string) {
  return value.toLowerCase().includes(query);
}

function cleanSymbol(symbol: string) {
  return symbol.replace(/^\$+/, "");
}

export function DiscoverySearch() {
  const [query, setQuery] = useState("");
  const [rmtResults, setRmtResults] = useState<LaunchFeedItem[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle");
  const normalized = useMemo(() => query.trim().toLowerCase(), [query]);

  useEffect(() => {
    if (normalized.length < 2) {
      setRmtResults([]);
      setState("idle");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setState("loading");

      const rmtResponse = await fetch("/api/launches", { cache: "no-store", signal: controller.signal }).catch(() => null);

      let launches: LaunchFeedItem[] = [];

      if (rmtResponse?.ok) {
        const payload = (await rmtResponse.json()) as LaunchFeedResponse;
        launches = Array.isArray(payload.launches) ? payload.launches : [];
      }

      if (!controller.signal.aborted) {
        setRmtResults(launches.filter((launch) =>
          matches(launch.name, normalized)
          || matches(cleanSymbol(launch.symbol), normalized)
          || matches(launch.token, normalized)
        ).slice(0, 6));
        setState("ready");
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [normalized]);

  const resultCount = rmtResults.length;
  const showResults = normalized.length >= 2;

  return (
    <section className="discoverySearch panel" aria-labelledby="discovery-search-title">
      <div className="searchLead">
        <p className="eyebrow">FIND A TOKEN</p>
        <h2 id="discovery-search-title">Search tokens</h2>
        <p>Search origin-verified RMT V6 launches by name, ticker, or contract address.</p>
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
          aria-label="Search origin-verified RMT V6 launches"
        />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">Clear</button>}
      </div>

      {showResults && (
        <div className="searchResults" aria-live="polite">
          {state === "loading" ? (
            <p className="searchMessage">Searching active RMT V6 launches…</p>
          ) : resultCount === 0 ? (
            <p className="searchMessage">No matching active RMT V6 launches.</p>
          ) : (
            <div className="searchGroup">
              <div className="searchGroupTitle"><strong>Origin-verified RMT V6 launches</strong><span>{rmtResults.length}</span></div>
              <div className="searchResultGrid">{rmtResults.map((launch) => (
                <Link className="searchResult" href={`/token/${launch.token}`} key={launch.token}>
                  <span className="coin searchArtwork">{launch.image ? <img src={ipfsToHttp(launch.image)} alt="" loading="lazy" /> : cleanSymbol(launch.symbol).slice(0, 2)}</span>
                  <span><strong>{launch.name}</strong><small>${cleanSymbol(launch.symbol)} · RMT V6 · origin verified</small></span>
                  <em>Open →</em>
                </Link>
              ))}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
