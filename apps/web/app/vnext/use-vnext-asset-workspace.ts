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
import { cachedPublicWorkspaceRead, readPublicWorkspace } from "../../lib/vnext/public-workspace-read";
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
    currentAddress.current = address;
    const coreUrl = `/api/vnext/asset-workspace?${workspace}&view=core`;
    const enrichmentUrl = `/api/vnext/asset-workspace?${workspace}&view=enrichment`;
    const marketUrl = `/api/markets/external?${lookup}`;
    const current = () => id === requestId.current;
    let success = sameAsset && hasSnapshot.current;
    let coreSnapshot: WorkspaceResolutionResponse | undefined;
    let marketSnapshot: ExternalMarket | undefined;
    let marketStale = false;
    const publishCore = (payload: WorkspaceResolutionResponse) => {
      if (!current()) return;
      const resolution = validResolution(payload, address);
      if (!resolution && !payload.stockAssetRelationships?.length) return;
      coreSnapshot = payload;
      success = true; hasSnapshot.current = true;
      setResolution(resolution);
      setStockAssetCoverage(payload.stockAssetCoverage);
      setStockAssetRelationships(mergeWorkspaceStockAssetRelationships(address, payload.stockAssetRelationships, marketSnapshot));
      setObservedAt(payload.updatedAt); setStatus("partial");
    };
    const publishMarket = (payload: ExternalMarketResponse) => {
      if (!current()) return;
      const market = exactWorkspaceMarket(payload, address, pairAddress);
      if (!market) return;
      marketSnapshot = market; marketStale = Boolean(payload.stale);
      success = true; hasSnapshot.current = true; setMarket(market);
      setStockAssetRelationships(mergeWorkspaceStockAssetRelationships(address, coreSnapshot?.stockAssetRelationships, market));
      setObservedAt(payload.updatedAt); setStatus(payload.stale ? "stale" : "partial");
    };
    if (!sameAsset) {
      setMarket(undefined); setResolution(undefined); setEcosystem(undefined); setObservedAt(undefined);
      setStockAssetCoverage(undefined); setStockAssetRelationships([]); hasSnapshot.current = false;
      const cachedCore = cachedPublicWorkspaceRead<WorkspaceResolutionResponse>(coreUrl);
      const cachedMarket = externalMarketLookup ? cachedPublicWorkspaceRead<ExternalMarketResponse>(marketUrl) : undefined;
      if (cachedCore) publishCore(cachedCore);
      if (cachedMarket) publishMarket(cachedMarket);
      if (success) setStatus("stale");
    }
    // Each section publishes as soon as it resolves. Optional intelligence and
    // external activity never hold core identity/controls behind Promise.all.
    const core = readPublicWorkspace<WorkspaceResolutionResponse>(coreUrl).then(publishCore);
    const marketRead = externalMarketLookup ? readPublicWorkspace<ExternalMarketResponse>(marketUrl).then(publishMarket) : Promise.resolve();
    const enrichment = readPublicWorkspace<WorkspaceResolutionResponse>(enrichmentUrl).then(payload => {
      if (current()) setEcosystem(payload.ecosystem);
    });
    const results = await Promise.allSettled([core, marketRead, enrichment]);
    if (!current()) return;
    if (!success) setStatus("unavailable");
    else if (marketStale || results.some(result => result.status === "rejected")) setStatus(sameAsset ? "stale" : "partial");
    else setStatus(coreSnapshot && (!externalMarketLookup || marketSnapshot) ? "ready" : "partial");

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
