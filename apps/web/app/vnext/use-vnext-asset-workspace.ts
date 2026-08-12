"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExternalMarket,
  ExternalMarketResponse,
  UniversalMarketResolution
} from "../../lib/external-market";
import type { VNextEcosystemIntelligence } from "../../lib/vnext/ecosystem-intelligence";

export type VNextAssetWorkspaceStatus = "idle" | "loading" | "ready" | "partial" | "stale" | "unavailable";

type WorkspaceResolutionResponse = {
  resolution?: UniversalMarketResolution;
  ecosystem?: VNextEcosystemIntelligence;
  stockAssetCoverage?: "complete" | "unavailable";
  updatedAt?: string;
  error?: string;
};

function exactMarket(payload: ExternalMarketResponse, address: string) {
  return payload.markets?.find((market) => market.address.toLowerCase() === address.toLowerCase());
}

function validResolution(payload: WorkspaceResolutionResponse, address: string) {
  const resolution = payload.resolution;
  return resolution?.chainId === 4_663
    && resolution.token.address.toLowerCase() === address.toLowerCase()
    ? resolution
    : undefined;
}

export function useVNextAssetWorkspace(address?: string, pairAddress?: string) {
  const [market, setMarket] = useState<ExternalMarket>();
  const [resolution, setResolution] = useState<UniversalMarketResolution>();
  const [ecosystem, setEcosystem] = useState<VNextEcosystemIntelligence>();
  const [stockAssetCoverage, setStockAssetCoverage] = useState<"complete" | "unavailable">();
  const [status, setStatus] = useState<VNextAssetWorkspaceStatus>(address ? "loading" : "idle");
  const [observedAt, setObservedAt] = useState<string>();
  const requestId = useRef(0);
  const currentAddress = useRef<string | undefined>(undefined);
  const hasSnapshot = useRef(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!address) {
      setMarket(undefined);
      setResolution(undefined);
      setEcosystem(undefined);
      setObservedAt(undefined);
      setStockAssetCoverage(undefined);
      setStatus("idle");
      currentAddress.current = undefined;
      hasSnapshot.current = false;
      return;
    }
    const id = ++requestId.current;
    const sameAsset = currentAddress.current?.toLowerCase() === address.toLowerCase();
    if (!quiet || !sameAsset) setStatus("loading");
    const lookup = new URLSearchParams({ contract: address });
    const workspace = new URLSearchParams({ address });
    if (pairAddress) workspace.set("pair", pairAddress);
    try {
      const [marketResult, resolutionResult] = await Promise.allSettled([
        fetch(`/api/markets/external?${lookup}`, { cache: "no-store" }).then(async (response) => ({
          ok: response.ok,
          payload: await response.json() as ExternalMarketResponse
        })),
        fetch(`/api/vnext/asset-workspace?${workspace}`, { cache: "no-store" }).then(async (response) => ({
          ok: response.ok,
          payload: await response.json() as WorkspaceResolutionResponse
        }))
      ]);
      if (id !== requestId.current) return;
      const nextMarket = marketResult.status === "fulfilled" && marketResult.value.ok
        ? exactMarket(marketResult.value.payload, address)
        : undefined;
      const nextResolution = resolutionResult.status === "fulfilled" && resolutionResult.value.ok
        ? validResolution(resolutionResult.value.payload, address)
        : undefined;
      if (!nextMarket && !nextResolution) throw new Error("Asset workspace unavailable.");
      currentAddress.current = address;
      hasSnapshot.current = true;
      if (nextMarket) setMarket(nextMarket);
      else if (!sameAsset) setMarket(undefined);
      if (nextResolution) setResolution(nextResolution);
      else if (!sameAsset) setResolution(nextMarket?.resolution);
      if (resolutionResult.status === "fulfilled" && resolutionResult.value.ok) {
        setEcosystem(resolutionResult.value.payload.ecosystem);
      } else if (!sameAsset) {
        setEcosystem(undefined);
      }
      if (resolutionResult.status === "fulfilled" && resolutionResult.value.ok) {
        setStockAssetCoverage(resolutionResult.value.payload.stockAssetCoverage);
      } else if (!sameAsset) {
        setStockAssetCoverage(undefined);
      }
      setObservedAt(
        marketResult.status === "fulfilled" ? marketResult.value.payload.updatedAt
          : resolutionResult.status === "fulfilled" ? resolutionResult.value.payload.updatedAt
            : new Date().toISOString()
      );
      setStatus(
        marketResult.status === "fulfilled" && marketResult.value.payload.stale
          ? "stale"
          : nextMarket && (nextResolution || nextMarket.resolution)
            ? "ready"
            : "partial"
      );
    } catch {
      if (id !== requestId.current) return;
      setStatus(sameAsset && hasSnapshot.current ? "stale" : "unavailable");
    }
  }, [address, pairAddress]);

  useEffect(() => {
    void refresh(false);
    if (!address) return;
    const interval = window.setInterval(() => void refresh(true), 30_000);
    return () => {
      requestId.current += 1;
      window.clearInterval(interval);
    };
  }, [address, refresh]);

  const snapshotIsCurrent = Boolean(address && currentAddress.current?.toLowerCase() === address.toLowerCase());
  return {
    market: snapshotIsCurrent ? market : undefined,
    resolution: snapshotIsCurrent ? resolution : undefined,
    ecosystem: snapshotIsCurrent ? ecosystem : undefined,
    status,
    observedAt: snapshotIsCurrent ? observedAt : undefined,
    stockAssetCoverage: snapshotIsCurrent ? stockAssetCoverage : undefined,
    refresh
  };
}
