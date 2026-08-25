"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExternalMarket } from "./external-market";
import type { VNextUniversalMarketSearchPool } from "./vnext/universal-market-search-contract";
import type { WalletConstellationGraph } from "./wallet-constellation";

export type WalletConstellationState =
  | { status: "loading"; graph?: undefined }
  | { status: "ready"; graph: WalletConstellationGraph }
  | { status: "unavailable"; graph?: undefined };

export function useWalletConstellation(
  market?: ExternalMarket,
  canonicalMarket?: VNextUniversalMarketSearchPool
): WalletConstellationState {
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
    const query = new URLSearchParams({
      token,
      pair,
      venue
    });
    if (creator) query.set("creator", creator);
    if (
      sourceId === "pons"
      || sourceId === "noxa"
    ) {
      query.set("sourceId", sourceId);
    }
    return `/api/markets/wallet-constellation?${query}`;
  }, [creator, pair, sourceId, token, venue]);
  const [state, setState] = useState<WalletConstellationState>({
    status: "loading"
  });

  useEffect(() => {
    if (!url) {
      setState({ status: "unavailable" });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setState({ status: "loading" });
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Wallet evidence unavailable.");
        const graph = await response.json() as WalletConstellationGraph;
        if (
          graph.schemaVersion !== 1
          || !token
          || !pair
          || graph.token.toLowerCase() !== token.toLowerCase()
          || graph.pair.toLowerCase() !== pair.toLowerCase()
          || !Array.isArray(graph.nodes)
          || !Array.isArray(graph.edges)
        ) {
          throw new Error("Wallet evidence does not match this market.");
        }
        setState({ status: "ready", graph });
      })
      .catch(() => {
        if (active) {
          setState({ status: "unavailable" });
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [pair, token, url]);

  return state;
}
