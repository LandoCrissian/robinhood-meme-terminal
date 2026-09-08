import type { TokenRiskEvidenceState } from "../token-risk-evidence";
import type { WalletConstellationState } from "../use-wallet-constellation";
import { selectVNextCanonicalMarket, type VNextDirectoryMarket } from "./market-directory";

export function workspaceCanonicalMarkets(market: Pick<VNextDirectoryMarket, "address" | "canonicalMarkets" | "primaryMarket" | "launchpadEvidence">) {
  const token = market.address.toLowerCase();
  const unique = new Map<string, NonNullable<VNextDirectoryMarket["canonicalMarkets"]>[number]>();
  for (const pool of market.canonicalMarkets ?? []) {
    if (pool.token0.toLowerCase() !== token && pool.token1.toLowerCase() !== token) continue;
    const key = `${pool.sourceId}:${pool.poolKey.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, pool);
  }
  const pools = [...unique.values()];
  const primary = selectVNextCanonicalMarket({ ...market, canonicalMarkets: pools });
  return primary ? [primary, ...pools.filter((pool) => pool !== primary)] : [];
}

// PoolKey LP fee, not a routing promise or a hook's beforeSwap override return.
// Uniswap v4 LPFeeLibrary: 0x800000 = dynamic, static fees <= 1,000,000 ppm.
export function workspacePoolFeeLabel(fee: number | null, version: number, protocol = "uniswap") {
  if (protocol !== "uniswap" && protocol !== "sushiswap") return "Pool swap fee · read at quote";
  if (version === 4 && protocol === "uniswap" && fee === 0x800000) return "Dynamic fee · read at quote";
  if (fee === null || !Number.isSafeInteger(fee) || fee < 0 || fee > 1_000_000
    || (version !== 2 && version !== 3 && version !== 4)
    || (version === 3 && (fee === 0 || fee === 1_000_000))) return "Pool swap fee · read at quote";
  const percent = (fee / 10_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return version === 4 ? `Configured static LP fee · ${percent}% (not an execution quote)` : `Pool swap fee · ${percent}%`;
}

export type WorkspaceEvidenceStatus = "ready" | "stale" | "unavailable" | "checking";
export function workspaceEvidenceStates(risk: TokenRiskEvidenceState, constellation: WalletConstellationState, liquidityUsd?: number | null): Record<"holders" | "liquidity" | "risk", WorkspaceEvidenceStatus> {
  const evidence = risk.evidence;
  const available = (status: string | undefined) => status === "ready" || status === "stale";
  const freshness: WorkspaceEvidenceStatus = evidence?.freshness === "stale" ? "stale" : "ready";
  const holderEvidence = evidence && (evidence.holders.count !== null || evidence.holders.topHolders.length > 0);
  const graphEvidence = constellation.graph && (constellation.graph.holderSnapshot.count !== null || constellation.graph.nodes.some((node) => typeof node.supplyShareBps === "number"));
  const holders: WorkspaceEvidenceStatus = graphEvidence ? "ready"
    : holderEvidence && (evidence.domains === undefined || available(evidence.domains.holders))
      ? evidence.domains?.holders === "stale" ? "stale" : freshness
      : evidence?.domains?.holders === "unavailable" ? "unavailable"
        : risk.status === "loading" || constellation.status === "loading" ? "checking" : "unavailable";
  const liquidity: WorkspaceEvidenceStatus = Number.isFinite(liquidityUsd) && Number(liquidityUsd) >= 0 ? "ready"
    : evidence && (evidence.domains === undefined ? evidence.liquidity.evidenceSource !== "none" : available(evidence.domains.liquidity))
      ? evidence.domains?.liquidity === "stale" ? "stale" : freshness
      : liquidityUsd === null ? "unavailable" : risk.status === "loading" ? "checking" : "unavailable";
  const riskDomains = evidence?.domains ? [evidence.domains.contract, evidence.domains.abi, evidence.domains.sell] : undefined;
  const riskStatus: WorkspaceEvidenceStatus = risk.status === "loading" ? "checking"
    : !evidence || (riskDomains && !riskDomains.some(available)) ? "unavailable"
      : riskDomains?.includes("stale") ? "stale" : freshness;
  return { holders, liquidity, risk: riskStatus };
}
