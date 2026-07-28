"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExternalMarket } from "./external-market";
import type { WalletConstellationGraph } from "./wallet-constellation";

export type WalletConstellationState =
  | { status: "loading"; graph?: undefined }
  | { status: "ready"; graph: WalletConstellationGraph }
  | { status: "unavailable"; graph?: undefined };

export function useWalletConstellation(
  market: ExternalMarket
): WalletConstellationState {
  const venue = market.dexId.toLowerCase().includes("sushi")
    ? "sushi"
    : market.dexId.toLowerCase() === "uniswap"
      || market.dexId.toLowerCase().startsWith("uniswap-")
      ? "uniswap"
      : null;
  const url = useMemo(() => {
    if (!venue) return null;
    const query = new URLSearchParams({
      token: market.address,
      pair: market.pairAddress,
      venue
    });
    if (market.project?.creator) query.set("creator", market.project.creator);
    if (
      market.project?.sourceId === "pons"
      || market.project?.sourceId === "noxa"
    ) {
      query.set("sourceId", market.project.sourceId);
    }
    return `/api/markets/wallet-constellation?${query}`;
  }, [
    market.address,
    market.pairAddress,
    market.project?.creator,
    market.project?.sourceId,
    venue
  ]);
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
          || graph.token.toLowerCase() !== market.address.toLowerCase()
          || graph.pair.toLowerCase() !== market.pairAddress.toLowerCase()
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
  }, [market.address, market.pairAddress, url]);

  return state;
}
