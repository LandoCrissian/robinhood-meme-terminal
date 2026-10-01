"use client";
import { useEffect, useState } from "react";
import { chartMarketSchema, parsePresentationEvidence, type PresentationEvidence, type TokenMarketPresentation } from "../../lib/vnext/token-presentation";
import { formatTerminalCompactUsd, formatTerminalPrice } from "../vnext/terminal-format";
export function ProjectTokenMarket({ contract }: { contract: string }) {
  const [snapshot, setSnapshot] = useState<{ contract: string; evidence: PresentationEvidence<TokenMarketPresentation> | null }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/vnext/asset-workspace?address=${contract}&view=market`, { signal: controller.signal }).then(async response => {
      const evidence = response.ok ? parsePresentationEvidence(await response.json(), contract, chartMarketSchema, "GECKOTERMINAL_TOKEN_POOLS") : null;
      if (evidence?.data && evidence.data.token.toLowerCase() !== contract.toLowerCase()) throw new Error("Mismatched token market");
      if (!controller.signal.aborted) setSnapshot({ contract, evidence });
    }).catch(() => { if (!controller.signal.aborted) setSnapshot({ contract, evidence: null }); });
    return () => controller.abort();
  }, [contract]);
  const evidence = snapshot?.contract === contract ? snapshot.evidence : null, data = evidence?.data;
  return <div className="rmtProjectMetricStrip"><span>Price<strong>{data?.priceUsd === null || data?.priceUsd === undefined ? "—" : formatTerminalPrice(data.priceUsd)}</strong></span><span>24h volume<strong>{formatTerminalCompactUsd(data?.volume24hUsd ?? null)}</strong></span><span>Liquidity<strong>{formatTerminalCompactUsd(data?.liquidityUsd ?? null)}</strong></span><small>{!snapshot || snapshot.contract !== contract ? "Market data loading" : !data ? "Market data unavailable" : evidence?.state === "STALE" ? "Last observed market data" : "Market snapshot"}</small></div>;
}
