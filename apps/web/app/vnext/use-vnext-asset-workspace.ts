"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExternalMarket,
  ExternalMarketResponse,
  RobinhoodStockAssetRelationship,
  UniversalMarketResolution
} from "../../lib/external-market";
import type { VNextEcosystemIntelligence } from "../../lib/vnext/ecosystem-intelligence";
import { VNEXT_CLIENT_REFRESH_POLICY } from "../../lib/vnext/client-refresh-policy";
import { useVisibilityRefresh } from "./use-visibility-refresh";

export type VNextAssetWorkspaceStatus = "idle" | "loading" | "ready" | "partial" | "stale" | "unavailable";

type WorkspaceResolutionResponse = {
  resolution?: UniversalMarketResolution;
  ecosystem?: VNextEcosystemIntelligence;
  stockAssetRelationships?: RobinhoodStockAssetRelationship[];
  stockAssetCoverage?: "complete" | "stale" | "unavailable";
  updatedAt?: string;
  error?: string;
};

export function mergeWorkspaceStockAssetRelationships(
  selectedToken: string,
  tokenRelationships: RobinhoodStockAssetRelationship[] | undefined,
  exactPairMarket: ExternalMarket | undefined
) {
  const selected = selectedToken.toLowerCase();
  const relationships = [
    ...(tokenRelationships ?? []).filter((relationship) => (
      relationship.relationship === "canonical-stock-token"
      && relationship.contractAddress.toLowerCase() === selected
      && relationship.provenance === "robinhood-live-asset-registry"
    )),
    ...(exactPairMarket?.stockAssetRelationships ?? []).filter((relationship) => (
      relationship.provenance === "robinhood-live-asset-registry"
      && (relationship.relationship === "paired-market-asset"
        || relationship.contractAddress.toLowerCase() === selected)
    ))
  ];
  return [...new Map(relationships.map((relationship) => [
    `${relationship.relationship}:${relationship.contractAddress.toLowerCase()}`,
    relationship
  ])).values()];
}

export function exactWorkspaceMarket(payload: ExternalMarketResponse, address: string, expectedPair?: string) {
  const market = payload.markets?.find((candidate) => candidate.address.toLowerCase() === address.toLowerCase());
  if (!market || !expectedPair) return market;
  const primaryPool = market.primaryMarket?.pool;
  const primaryPair = primaryPool?.kind === "evm-address" ? primaryPool.value : market.pairAddress;
  return primaryPair.toLowerCase() === expectedPair.toLowerCase() ? market : undefined;
}

export function workspaceTokenPresentation(input: {
  address: string;
  resolution?: UniversalMarketResolution;
  canonicalIdentity?: { address: string; name: string; symbol: string };
  provider?: Pick<ExternalMarket, "name" | "symbol">;
  fallback: { name: string; symbol: string };
}) {
  const direct = input.resolution?.chainId === 4_663
    && input.resolution.token.address.toLowerCase() === input.address.toLowerCase()
    ? input.resolution.token
    : undefined;
  const canonical = input.canonicalIdentity?.address.toLowerCase() === input.address.toLowerCase()
    ? input.canonicalIdentity
    : undefined;
  return {
    name: direct?.name || canonical?.name || input.provider?.name || input.fallback.name,
    symbol: direct?.symbol || canonical?.symbol || input.provider?.symbol || input.fallback.symbol,
    verified: Boolean(direct || canonical)
  };
}

function validResolution(payload: WorkspaceResolutionResponse, address: string) {
  const resolution = payload.resolution;
  return resolution?.chainId === 4_663
    && resolution.token.address.toLowerCase() === address.toLowerCase()
    ? resolution
    : undefined;
}

export function useVNextAssetWorkspace(address?: string, pairAddress?: string, externalMarketLookup = true) {
  const [market, setMarket] = useState<ExternalMarket>();
  const [resolution, setResolution] = useState<UniversalMarketResolution>();
  const [ecosystem, setEcosystem] = useState<VNextEcosystemIntelligence>();
  const [stockAssetRelationships, setStockAssetRelationships] = useState<RobinhoodStockAssetRelationship[]>([]);
  const [stockAssetCoverage, setStockAssetCoverage] = useState<"complete" | "stale" | "unavailable">();
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
      setStockAssetRelationships([]);
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
        externalMarketLookup
          ? fetch(`/api/markets/external?${lookup}`).then(async (response) => ({
              ok: response.ok,
              payload: await response.json() as ExternalMarketResponse
            }))
          : Promise.resolve({ ok: false, payload: {} as ExternalMarketResponse }),
        fetch(`/api/vnext/asset-workspace?${workspace}`).then(async (response) => ({
          ok: response.ok,
          payload: await response.json() as WorkspaceResolutionResponse
        }))
      ]);
      if (id !== requestId.current) return;
      const nextMarket = marketResult.status === "fulfilled" && marketResult.value.ok
        ? exactWorkspaceMarket(marketResult.value.payload, address, pairAddress)
        : undefined;
      const nextResolution = resolutionResult.status === "fulfilled" && resolutionResult.value.ok
        ? validResolution(resolutionResult.value.payload, address)
        : undefined;
      const nextStockAssetRelationships = resolutionResult.status === "fulfilled" && resolutionResult.value.ok
        ? mergeWorkspaceStockAssetRelationships(
            address,
            resolutionResult.value.payload.stockAssetRelationships,
            nextMarket
          )
        : [];
      if (!nextMarket && !nextResolution && !nextStockAssetRelationships.length) throw new Error("Asset workspace unavailable.");
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
        setStockAssetRelationships(nextStockAssetRelationships);
      } else if (!sameAsset) {
        setStockAssetCoverage(undefined);
        setStockAssetRelationships([]);
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
  }, [address, externalMarketLookup, pairAddress]);

  useVisibilityRefresh(() => refresh(true), VNEXT_CLIENT_REFRESH_POLICY.assetWorkspaceMs, {
    enabled: Boolean(address),
    refreshKey: `${address ?? "none"}:${pairAddress ?? "none"}`
  });

  useEffect(() => () => {
    requestId.current += 1;
  }, [address, pairAddress]);

  const snapshotIsCurrent = Boolean(address && currentAddress.current?.toLowerCase() === address.toLowerCase());
  return {
    market: snapshotIsCurrent ? market : undefined,
    resolution: snapshotIsCurrent ? resolution : undefined,
    ecosystem: snapshotIsCurrent ? ecosystem : undefined,
    status,
    observedAt: snapshotIsCurrent ? observedAt : undefined,
    stockAssetCoverage: snapshotIsCurrent ? stockAssetCoverage : undefined,
    stockAssetRelationships: snapshotIsCurrent ? stockAssetRelationships : [],
    refresh
  };
}
