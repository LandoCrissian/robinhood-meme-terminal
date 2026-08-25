"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExternalMarket } from "./external-market";
import type { TokenRiskEvidence, TokenRiskEvidenceState } from "./token-risk-evidence";
import type { VNextUniversalMarketSearchPool } from "./vnext/universal-market-search-contract";

export function useTokenRiskEvidence(
  market?: ExternalMarket,
  canonicalMarket?: VNextUniversalMarketSearchPool
): TokenRiskEvidenceState {
  const [state, setState] = useState<TokenRiskEvidenceState>({ status: "loading" });
  const venue = canonicalMarket?.protocol === "sushiswap"
    ? "sushi"
    : canonicalMarket?.protocol === "uniswap"
      ? "uniswap"
      : null;
  const pair = canonicalMarket && canonicalMarket.version !== 4
    ? canonicalMarket.poolKey
    : null;
  const token = market?.address;
  const creator = market?.project?.creator;
  const sourceId = market?.project?.sourceId;
  const url = useMemo(() => {
    if (!venue || !pair || !token) return null;
    const params = new URLSearchParams({
      token,
      pair,
      venue
    });
    if (creator) params.set("creator", creator);
    if (sourceId === "pons" || sourceId === "noxa") {
      params.set("sourceId", sourceId);
    }
    return `/api/markets/token-risk?${params}`;
  }, [creator, pair, sourceId, token, venue]);

  useEffect(() => {
    if (!url) {
      setState({ status: "unavailable" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Risk evidence is unavailable.");
        const evidence = await response.json() as TokenRiskEvidence;
        if (
          evidence.marketVerified !== true
          || !token
          || !pair
          || evidence.token.toLowerCase() !== token.toLowerCase()
          || evidence.pair.toLowerCase() !== pair.toLowerCase()
        ) {
          throw new Error("Risk evidence does not match this market.");
        }
        setState({ status: "ready", evidence });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [pair, token, url]);

  return state;
}
