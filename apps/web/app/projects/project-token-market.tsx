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
  return <div className="rmtProjectMetricRegion">{data ? <div className="rmtProjectMetricStrip">
    {data.priceUsd !== null ? <span>Price<strong>{formatTerminalPrice(data.priceUsd)}</strong>{data.priceChange24h !== null ? <em>{data.priceChange24h > 0 ? "+" : ""}{data.priceChange24h.toFixed(2)}% · 24h</em> : null}</span> : null}
    {data.volume24hUsd !== null ? <span>24h volume<strong>{formatTerminalCompactUsd(data.volume24hUsd)}</strong></span> : null}
    {data.liquidityUsd !== null ? <span>Liquidity<strong>{formatTerminalCompactUsd(data.liquidityUsd)}</strong></span> : null}
    {evidence?.state === "STALE" ? <small>Last observed market data</small> : null}
  </div> : <p className="rmtProjectQuietState">{!snapshot || snapshot.contract !== contract ? "Loading market data" : "Market data unavailable"}</p>}</div>;
}
