"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExternalMarket } from "./external-market";
import type { TokenRiskEvidence, TokenRiskEvidenceState } from "./token-risk-evidence";
import type { VNextUniversalMarketSearchPool } from "./vnext/universal-market-search-contract";
import { rmtCuratedRiskSourceId } from "./vnext/curated-market-registry";
import { loadBoundedWorkspaceEvidence } from "./bounded-workspace-evidence";

export function tokenRiskEvidenceRequestUrl(
  token?: string,
  market?: ExternalMarket,
  canonicalMarket?: VNextUniversalMarketSearchPool
) {
  if (!token) return null;
  const venue = canonicalMarket?.protocol === "sushiswap"
    ? "sushi"
    : canonicalMarket?.protocol === "uniswap"
      ? "uniswap"
      : null;
  const pair = canonicalMarket && canonicalMarket.version !== 4
    ? canonicalMarket.poolKey
    : null;
  const params = new URLSearchParams({ token });
  if (venue && pair) {
    params.set("pair", pair);
    params.set("venue", venue);
  }
  const creator = market?.project?.creator;
  const sourceId = rmtCuratedRiskSourceId(token) ?? market?.project?.sourceId;
  if (creator) params.set("creator", creator);
  if (sourceId === "pons" || sourceId === "noxa") {
    params.set("sourceId", sourceId);
  }
  return `/api/markets/token-risk?${params}`;
}

export function useTokenRiskEvidence(
  token?: string,
  market?: ExternalMarket,
  canonicalMarket?: VNextUniversalMarketSearchPool
): TokenRiskEvidenceState {
  const [state, setState] = useState<TokenRiskEvidenceState>({ status: "loading" });
  const pair = canonicalMarket && canonicalMarket.version !== 4
    ? canonicalMarket.poolKey
    : null;
  const url = useMemo(
    () => tokenRiskEvidenceRequestUrl(token, market, canonicalMarket),
    [canonicalMarket, market, token]
  );

  useEffect(() => {
    if (!url) {
      setState({ status: "unavailable" });
      return;
    }
    setState({ status: "loading" });
    return loadBoundedWorkspaceEvidence({
      read: async (signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error("Risk evidence is unavailable.");
        const evidence = await response.json() as TokenRiskEvidence;
        if (
          !token
          || evidence.token.toLowerCase() !== token.toLowerCase()
          || (evidence.marketVerified && (
            !pair || evidence.pair?.toLowerCase() !== pair.toLowerCase()
          ))
          || (!evidence.marketVerified && evidence.pair !== null)
        ) {
          throw new Error("Risk evidence does not match this market.");
        }
        return evidence;
      },
      ready: (evidence) => setState({ status: "ready", evidence }),
      unavailable: () => setState({ status: "unavailable" })
    });
  }, [pair, token, url]);

  return state;
}
