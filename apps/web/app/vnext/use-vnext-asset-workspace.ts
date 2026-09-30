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
import { projectsForContract } from "@rmt/shared/project-identity";
import { chartMarketSchema, visualSchema, parsePresentationEvidence, retainPresentationEvidence, type PresentationEvidence, type TokenMarketPresentation, type TokenVisualPresentation, type TokenPresentation } from "../../lib/vnext/token-presentation";

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
  const [visual, setVisual] = useState<PresentationEvidence<TokenVisualPresentation>>();
  const [chartMarket, setChartMarket] = useState<PresentationEvidence<TokenMarketPresentation>>();
  const [resolution, setResolution] = useState<UniversalMarketResolution>();
  const [identityStale, setIdentityStale] = useState(false);
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
      setVisual(undefined); setChartMarket(undefined);
      setResolution(undefined);
      setIdentityStale(false);
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
    const visualUrl = `/api/vnext/asset-workspace?address=${address}&view=visual`;
    const chartMarketUrl = `/api/vnext/asset-workspace?address=${address}&view=market`;
    const current = () => id === requestId.current;
    let success = sameAsset && hasSnapshot.current;
    let coreSnapshot: WorkspaceResolutionResponse | undefined;
    let marketSnapshot: ExternalMarket | undefined;
    let marketStale = false;
    const publishCore = (payload: WorkspaceResolutionResponse) => {
      if (!current()) return;
      const resolution = validResolution(payload, address);
      setIdentityStale(!resolution);
      if (!resolution && !payload.stockAssetRelationships?.length) return;
      coreSnapshot = payload;
      success = true; hasSnapshot.current = true;
      if (resolution) setResolution(resolution);
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
      setVisual(undefined); setChartMarket(undefined);
      setMarket(undefined); setResolution(undefined); setEcosystem(undefined); setObservedAt(undefined);
      setIdentityStale(false);
      setStockAssetCoverage(undefined); setStockAssetRelationships([]); hasSnapshot.current = false;
      const cachedCore = cachedPublicWorkspaceRead<WorkspaceResolutionResponse>(coreUrl);
      const cachedMarket = externalMarketLookup ? cachedPublicWorkspaceRead<ExternalMarketResponse>(marketUrl) : undefined;
      if (cachedCore) publishCore(cachedCore);
      if (cachedMarket) publishMarket(cachedMarket);
      if (success) setStatus("stale");
    }
    // Each section publishes as soon as it resolves. Optional intelligence and
    // external activity never hold core identity/controls behind Promise.all.
    const core = readPublicWorkspace<WorkspaceResolutionResponse>(coreUrl).then(publishCore).catch(error => {
      if (current()) setIdentityStale(true);
      throw error;
    });
    const marketRead = externalMarketLookup ? readPublicWorkspace<ExternalMarketResponse>(marketUrl).then(publishMarket) : Promise.resolve();
    const enrichment = readPublicWorkspace<WorkspaceResolutionResponse>(enrichmentUrl).then(payload => {
      if (current() && payload.ecosystem) setEcosystem(payload.ecosystem);
    });
    const visualRead = readPublicWorkspace<unknown>(visualUrl).then(value => {
      const next = parsePresentationEvidence(value, address, visualSchema, "GECKOTERMINAL_TOKEN_INFO");
      if (!next) throw new Error("Visual presentation response unavailable.");
      if (current() && next) setVisual(previous => retainPresentationEvidence(sameAsset ? previous : undefined, next));
    }).catch(() => { if (current()) setVisual(previous => previous ? { ...previous, state: "STALE" } : undefined); });
    const chartMarketRead = readPublicWorkspace<unknown>(chartMarketUrl).then(value => {
      const next = parsePresentationEvidence(value, address, chartMarketSchema, "GECKOTERMINAL_TOKEN_POOLS");
      if (!next || (next.data && next.data.token.toLowerCase() !== address.toLowerCase())) throw new Error("Market presentation response unavailable.");
      if (current() && next && (!next.data || next.data.token.toLowerCase() === address.toLowerCase())) setChartMarket(previous => retainPresentationEvidence(sameAsset ? previous : undefined, next));
    }).catch(() => { if (current()) setChartMarket(previous => previous ? { ...previous, state: "STALE" } : undefined); });
    const results = await Promise.allSettled([core, marketRead, enrichment, visualRead, chartMarketRead]);
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
  const identity = snapshotIsCurrent ? resolution?.token : undefined;
  const presentation: TokenPresentation | undefined = address ? {
    chainId: 4663, contract: address,
    identity: { state: identity ? identityStale ? "STALE" : "READY" : "UNAVAILABLE", data: identity ? { name: identity.name, symbol: identity.symbol, decimals: identity.decimals, contract: address } : null, observedAt: identity ? resolution!.resolvedAt : null, provenance: "RMT_ONCHAIN_IDENTITY" },
    visual: snapshotIsCurrent && visual ? visual : { state: "UNAVAILABLE", data: null, observedAt: null, provenance: "GECKOTERMINAL_TOKEN_INFO" },
    market: snapshotIsCurrent && chartMarket ? chartMarket : { state: "UNAVAILABLE", data: null, observedAt: null, provenance: "GECKOTERMINAL_TOKEN_POOLS" },
    project: { state: "READY", data: projectsForContract(address), observedAt: null, provenance: "OWNER_CONFIRMED_PROJECT_TOKEN" }
  } : undefined;
  return {
    presentation,
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
