"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExternalMarket } from "./external-market";
import type { TokenRiskEvidence, TokenRiskEvidenceState } from "./token-risk-evidence";

export function useTokenRiskEvidence(market: ExternalMarket): TokenRiskEvidenceState {
  const [state, setState] = useState<TokenRiskEvidenceState>({ status: "loading" });
  const venue = market.dexId.toLowerCase().includes("sushi")
    ? "sushi"
    : market.dexId.toLowerCase().startsWith("uniswap")
      ? "uniswap"
      : null;
  const url = useMemo(() => {
    if (!venue) return null;
    const params = new URLSearchParams({
      token: market.address,
      pair: market.pairAddress,
      venue
    });
    if (market.project?.creator) params.set("creator", market.project.creator);
    return `/api/markets/token-risk?${params}`;
  }, [market.address, market.pairAddress, market.project?.creator, venue]);

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
          || evidence.token.toLowerCase() !== market.address.toLowerCase()
          || evidence.pair.toLowerCase() !== market.pairAddress.toLowerCase()
        ) {
          throw new Error("Risk evidence does not match this market.");
        }
        setState({ status: "ready", evidence });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [market.address, market.pairAddress, url]);

  return state;
}
