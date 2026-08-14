"use client";

import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import {
  externalProjectProvenanceDescription,
  type ExternalMarket,
  type UniversalMarketPool,
  type UniversalMarketResolution
} from "../../lib/external-market";
import { summarizeExternalTradeActors, summarizeExternalSellPressure } from "../../lib/external-trades";
import { formatOwnershipBps } from "../../lib/token-risk-evidence";
import { useExternalMarketStream } from "../../lib/use-external-market-stream";
import { useTokenRiskEvidence } from "../../lib/use-token-risk-evidence";
import { useWalletConstellation } from "../../lib/use-wallet-constellation";
import type { VNextDirectoryMarket } from "../../lib/vnext/market-directory";
import type { VNextEcosystemIntelligence, VNextUpMarketIntelligence } from "../../lib/vnext/ecosystem-intelligence";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import type { IdentityStatus } from "./use-vnext-market-directory";
import { TokenArtwork } from "./token-artwork";
import { useVNextAssetWorkspace } from "./use-vnext-asset-workspace";
import { VNextMarketChart } from "./vnext-market-chart";

const EXPLORER = "https://robinhoodchain.blockscout.com";

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 5 })}`;
}

function compactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatAge(minutes: number | null) {
  if (minutes === null) return "Unknown";
  if (minutes < 60) return `${Math.max(1, Math.floor(minutes))}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1_440)}d`;
}

function relativeTime(timestamp: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h`;
}

function venueLabel(pool: UniversalMarketPool) {
  const labels: Record<UniversalMarketPool["venue"], string> = {
    "uniswap-v2": "Uniswap V2",
    "uniswap-v3": "Uniswap V3",
    "sushi-v2": "Sushi V2",
    "sushi-v3": "Sushi V3"
  };
  return labels[pool.venue];
}

function riskFlagLabel(flag: ExternalMarket["riskFlags"][number]) {
  const labels: Record<ExternalMarket["riskFlags"][number], string> = {
    "thin-liquidity": "Thin liquidity",
    "extreme-price-spike": "Extreme price move",
    "high-volume-low-trades": "High volume / few trades",
    "very-new-low-activity": "Very new / low activity",
    "one-sided-activity": "One-sided activity"
  };
  return labels[flag];
}

function fallbackMarketFromResolution(
  directory: VNextDirectoryMarket,
  resolution?: UniversalMarketResolution
): ExternalMarket | undefined {
  const pool = resolution?.pools[0];
  const pairAddress = directory.pairAddress ?? pool?.poolAddress;
  if (!pairAddress) return undefined;
  const dexId = directory.dexId ?? pool?.venue ?? "DEX";
  const url = directory.url ?? `${EXPLORER}/address/${pairAddress}`;
  return {
    address: directory.address,
    name: directory.name,
    symbol: directory.symbol,
    pairAddress,
    url,
    dexId,
    resolution,
    origin: { kind: "external", state: "unknown", coverage: "unavailable" },
    venue: { kind: "dex", dexId, pairAddress, url, execution: "read-only" },
    priceUsd: directory.priceUsd,
    liquidityUsd: directory.liquidityUsd,
    marketCapUsd: directory.marketCapUsd,
    fdvUsd: directory.marketCapUsd,
    volume5m: 0,
    volume1h: 0,
    volume24h: directory.volume24h,
    priceChange5m: 0,
    priceChange1h: 0,
    priceChange24h: directory.priceChange24h,
    buys5m: 0,
    sells5m: 0,
    buys1h: 0,
    sells1h: 0,
    buys24h: 0,
    sells24h: 0,
    pairCreatedAt: null,
    ageMinutes: directory.ageMinutes,
    momentumScore: 0,
    buyPressureBps: 0,
    signal: directory.signal,
    riskFlags: []
  };
}

function WorkspacePosition({
  directoryMarket,
  walletAssets,
  onTradeSide
}: {
  directoryMarket: VNextDirectoryMarket;
  walletAssets: VNextDetectedWalletAsset[];
  onTradeSide: (side: "buy" | "sell") => void;
}) {
  const { address, isConnected } = useAccount();
  const holding = walletAssets.find((asset) => asset.address.toLowerCase() === directoryMarket.address.toLowerCase());
  const units = holding?.decimals === null || !holding ? null : Number(formatUnits(BigInt(holding.balanceAtomic), holding.decimals));
  const positionValue = units !== null && Number.isFinite(units) ? units * directoryMarket.priceUsd : null;
  const hasPosition = units !== null && units > 0;

  return <section className="vnWorkspaceCard vnPositionCard" aria-labelledby="vn-position-heading">
    <header className="vnWorkspaceCardHead">
      <div><span className="vnEyebrow">Your wallet</span><h3 id="vn-position-heading">Position</h3></div>
      <span>{address ? shortAddress(address) : "Not connected"}</span>
    </header>
    <div className="vnPositionValue">
      <span><small>Holdings</small><strong>{!isConnected ? "Connect wallet" : hasPosition ? `${units.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${directoryMarket.symbol}` : "No detected balance"}</strong></span>
      <span><small>Current value</small><strong>{positionValue === null ? "—" : formatUsd(positionValue)}</strong></span>
    </div>
    <div className="vnPositionActions"><button type="button" onClick={() => onTradeSide("buy")}>Buy</button><button type="button" disabled={!hasPosition} onClick={() => onTradeSide("sell")}>Sell</button></div>
    <footer>Exact connected-wallet balance. Cost basis and P&amp;L remain hidden until complete wallet history can be proven.</footer>
  </section>;
}

function WorkspaceOrigin({ market, token }: { market?: ExternalMarket; token: string }) {
  const origin = market?.origin;
  const verified = origin?.kind === "rmt-v6" || origin?.state === "attributed";
  const label = origin?.kind === "rmt-v6" ? "RMT V6 verified"
    : origin?.state === "attributed" ? origin.sourceName
      : origin?.state === "disputed" ? "Origin disputed"
        : origin?.state === "unattributed" ? "Origin unattributed"
          : origin ? "Origin unknown" : "Origin checking";
  const detail = origin?.kind === "rmt-v6" ? `Creation proven at launch block ${origin.launchBlock}.`
    : origin?.state === "attributed" ? `${origin.claim.claimKind.replace("-", " ")} · independently indexed from ${origin.coverage} coverage.`
      : origin?.state === "disputed" ? `${origin.claims.length} incompatible claims require review; RMT does not choose one.`
        : origin?.state === "unattributed" ? "Complete indexed coverage found no verified creator source."
          : origin?.state === "unknown" ? `Coverage is ${origin.coverage}; no creator attribution is inferred.`
            : "No attribution is shown before verified evidence arrives.";
  const evidenceHref = origin?.kind === "rmt-v6" ? `${EXPLORER}/tx/${origin.launchTransactionHash}`
    : origin?.state === "attributed" ? `${EXPLORER}/tx/${origin.claim.transactionHash}`
      : undefined;

  return <section className="vnWorkspaceCard vnOriginCard" aria-labelledby="vn-origin-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Project origin</span><h3 id="vn-origin-heading">{label}</h3></div><span>{verified ? "Verified" : "Not inferred"}</span></header>
    <p>{detail}</p>
    {market?.project && <p className="vnOriginProject">{externalProjectProvenanceDescription(market.project)}</p>}
    <div className="vnOriginLinks">
      <a href={`${EXPLORER}/token/${token}`} target="_blank" rel="noopener noreferrer">Contract {shortAddress(token)} ↗</a>
      {evidenceHref && <a href={evidenceHref} target="_blank" rel="noopener noreferrer">Creation evidence ↗</a>}
      {market?.project?.creator && <a href={`${EXPLORER}/address/${market.project.creator}`} target="_blank" rel="noopener noreferrer">Creator {shortAddress(market.project.creator)} ↗</a>}
    </div>
  </section>;
}

function WorkspaceActivity({ market }: { market: ExternalMarket }) {
  const stream = useExternalMarketStream(market);
  const trades = stream.payload?.trades ?? [];
  const actors = useMemo(() => summarizeExternalTradeActors(trades), [trades]);
  const pressure = useMemo(() => summarizeExternalSellPressure(trades, market.liquidityUsd), [market.liquidityUsd, trades]);
  const windows = [
    { label: "5m", buys: market.buys5m, sells: market.sells5m, volume: market.volume5m },
    { label: "1h", buys: market.buys1h, sells: market.sells1h, volume: market.volume1h },
    { label: "24h", buys: market.buys24h, sells: market.sells24h, volume: market.volume24h }
  ];
  return <section className="vnWorkspaceCard vnActivityCard" aria-labelledby="vn-activity-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Confirmed activity</span><h3 id="vn-activity-heading">Market flow &amp; trade tape</h3></div><span className={`vnLiveState is${stream.status}`}><i aria-hidden="true" />{stream.status === "live" ? "Streaming" : stream.status === "fallback" ? "Fallback live" : stream.status === "connecting" ? "Connecting" : "Reconnecting"}</span></header>
    <div className="vnMarketFlow" aria-label="Market activity by time window">{windows.map((window) => <span key={window.label}><b>{window.label}</b><small>{window.buys.toLocaleString()} buys · {window.sells.toLocaleString()} sells</small><strong>{compactUsd(window.volume)}</strong></span>)}</div>
    <div className="vnActivitySummary">
      <span><small>Swaps shown</small><strong>{trades.length}</strong></span>
      <span><small>Active wallets</small><strong>{actors.uniqueActors}</strong></span>
      <span><small>5m net sells</small><strong className={pressure.level === "urgent" ? "vnNegative" : ""}>{compactUsd(pressure.netSellVolume5mUsd)}</strong></span>
    </div>
    {actors.actors.length > 0 && <div className="vnActorStrip" aria-label="Most active confirmed wallets">{actors.actors.slice(0, 4).map((actor) => <a href={`${EXPLORER}/address/${actor.trader}`} target="_blank" rel="noopener noreferrer" key={actor.trader}><span><strong>{shortAddress(actor.trader)}</strong><small>{actor.buyCount} buys · {actor.sellCount} sells</small></span><b className={actor.netVolumeUsd < 0 ? "vnNegative" : "vnPositive"}>{actor.netVolumeUsd < 0 ? "−" : "+"}{compactUsd(Math.abs(actor.netVolumeUsd))}</b></a>)}</div>}
    {trades.length ? <details className="vnTapeDetails"><summary>Latest confirmed swaps <b>{trades.length}</b></summary><div className="vnTradeTape">
      {trades.slice(0, 12).map((trade) => <a href={`${EXPLORER}/tx/${trade.transactionHash}`} target="_blank" rel="noopener noreferrer" key={trade.id}>
        <b className={trade.side === "buy" ? "isBuy" : "isSell"}>{trade.side}</b>
        <span><strong>{trade.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {market.symbol}</strong><small>{shortAddress(trade.trader)}</small></span>
        <span><strong>{compactUsd(trade.volumeUsd)}</strong><small>{relativeTime(trade.timestamp)} ago ↗</small></span>
      </a>)}
    </div></details> : <div className="vnWorkspaceEmpty"><strong>{stream.status === "connecting" ? "Opening exact-pool stream" : "No recent swaps"}</strong><span>New confirmed swaps appear without resetting the workspace.</span></div>}
    <footer>Exact pool only · confirmed swaps · visible wallet flow is not identity, P&amp;L, or a copy signal.</footer>
  </section>;
}

type EvidenceTab = "holders" | "liquidity" | "risk";

function WorkspaceEvidence({ market }: { market: ExternalMarket }) {
  const [tab, setTab] = useState<EvidenceTab>("holders");
  const risk = useTokenRiskEvidence(market);
  const constellation = useWalletConstellation(market);
  const evidence = risk.evidence;
  const graph = constellation.graph;
  const holders = graph?.nodes.filter((node) => node.holderRank !== null).sort((left, right) => (left.holderRank ?? 999) - (right.holderRank ?? 999)) ?? [];
  const warnings = [...new Set([...market.riskFlags.map(riskFlagLabel), ...(evidence?.warnings ?? [])])];

  return <section className="vnWorkspaceCard vnEvidenceDeck" aria-labelledby="vn-evidence-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Read-only evidence</span><h3 id="vn-evidence-heading">Holders, liquidity &amp; risk</h3></div><span>{risk.status === "ready" || constellation.status === "ready" ? "Evidence loaded" : risk.status === "loading" || constellation.status === "loading" ? "Checking…" : "Coverage limited"}</span></header>
    <div className="vnEvidenceTabs" role="tablist" aria-label="Market evidence">
      {(["holders", "liquidity", "risk"] as const).map((item) => <button type="button" role="tab" aria-selected={tab === item} className={tab === item ? "isActive" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}
    </div>

    {tab === "holders" && <div className="vnEvidencePane" role="tabpanel">
      <div className="vnEvidenceGrid">
        <span><small>Known holders</small><strong>{graph?.holderSnapshot.count?.toLocaleString() ?? evidence?.holders.count?.toLocaleString() ?? "—"}</strong></span>
        <span><small>Top 10 · no pool</small><strong>{formatOwnershipBps(graph?.holderSnapshot.topNonPoolShareBps ?? evidence?.holders.topNonPoolShareBps ?? null)}</strong></span>
        <span><small>Largest wallet</small><strong>{formatOwnershipBps(graph?.holderSnapshot.largestNonPoolShareBps ?? evidence?.holders.largestNonPoolHolder?.shareBps ?? null)}</strong></span>
        <span><small>Creator reported</small><strong>{formatOwnershipBps(graph?.holderSnapshot.creatorShareBps ?? evidence?.holders.creatorShareBps ?? null)}</strong></span>
      </div>
      {holders.length > 0 ? <><div className="vnConcentrationTrack" aria-label={`Visible top-holder concentration ${formatOwnershipBps(graph?.holderSnapshot.topNonPoolShareBps ?? null)}`}>{holders.slice(0, 6).map((holder, index) => <i className={holder.isFlagged ? "isFlagged" : holder.isContract ? "isContract" : ""} style={{ width: `${Math.max(.75, (holder.supplyShareBps ?? 0) / 100)}%` }} title={`${shortAddress(holder.address)} · ${formatOwnershipBps(holder.supplyShareBps)}`} key={holder.address} data-rank={index + 1} />)}</div><div className="vnHolderList">{holders.slice(0, 8).map((holder, index) => <a href={`${EXPLORER}/address/${holder.address}`} target="_blank" rel="noopener noreferrer" key={holder.address}><b>{index + 1}</b><span><strong>{shortAddress(holder.address)}</strong><small>{holder.role === "creator" ? "Reported creator" : holder.isFlagged ? "Explorer flagged" : holder.isContract ? "Contract" : "Wallet"}</small></span><strong>{formatOwnershipBps(holder.supplyShareBps)}</strong><i aria-hidden="true">↗</i></a>)}</div></> : <p className="vnEvidenceCaution">Holder rows are unavailable. Missing concentration data remains unknown, never safe.</p>}
      {graph?.signals.length ? <details className="vnEvidenceDetails"><summary>Observed wallet relationships <b>{graph.signals.length}</b></summary><div>{graph.signals.slice(0, 4).map((signal) => <span className={signal.severity} key={`${signal.code}:${signal.relatedAddresses.join(":")}`}><strong>{signal.label}</strong><small>{signal.relatedAddresses.map(shortAddress).join(" ↔ ")}</small><small>{signal.description}</small></span>)}</div></details> : null}
      {graph && <p className="vnCoverageNote">{graph.coverage.description} · {graph.coverage.sampledTransfers} transfers sampled.</p>}
    </div>}

    {tab === "liquidity" && <div className="vnEvidencePane" role="tabpanel">
      <div className="vnLiquidityHeadline"><span><small>Displayed pool liquidity</small><strong>{compactUsd(market.liquidityUsd)}</strong></span><a href={`${EXPLORER}/address/${market.pairAddress}`} target="_blank" rel="noopener noreferrer">Pool {shortAddress(market.pairAddress)} ↗</a></div>
      <div className="vnEvidenceGrid">
        <span><small>Pool token share</small><strong>{formatOwnershipBps(evidence?.holders.poolShareBps ?? graph?.holderSnapshot.poolShareBps ?? null)}</strong></span>
        <span><small>Liquidity control</small><strong>{evidence?.liquidity.controlStatus.replaceAll("-", " ") ?? "Not proven"}</strong></span>
        <span><small>Position owner</small><strong>{evidence?.liquidity.owner ? shortAddress(evidence.liquidity.owner) : "Unknown"}</strong></span>
        <span><small>Creator transfer</small><strong>{evidence?.liquidity.creatorCanTransfer === true ? "Possible" : evidence?.liquidity.creatorCanTransfer === false ? "Not observed" : "Unknown"}</strong></span>
        <span><small>Position ID</small><strong>{evidence?.liquidity.positionId ?? "Not available"}</strong></span>
        <span><small>Evidence source</small><strong>{evidence?.liquidity.evidenceSource.replaceAll("-", " ") ?? "None"}</strong></span>
      </div>
      <p className="vnEvidenceCaution">Liquidity and ownership can change. The execution engine rechecks its selected route independently before wallet review.</p>
    </div>}

    {tab === "risk" && <div className="vnEvidencePane" role="tabpanel">
      <div className="vnEvidenceGrid">
        <span><small>Source published</small><strong>{evidence?.contract.sourcePublished === true ? "Yes" : evidence?.contract.sourcePublished === false ? "No" : "Unknown"}</strong></span>
        <span><small>Proxy</small><strong>{evidence?.contract.isProxy === true ? "Detected" : evidence?.contract.isProxy === false ? "Not detected" : "Unknown"}</strong></span>
        <span><small>Bytecode change</small><strong>{evidence?.contract.bytecodeChanged === true ? "Detected" : evidence?.contract.bytecodeChanged === false ? "Not detected" : "Unknown"}</strong></span>
        <span><small>Contract controls</small><strong>{evidence?.contract.controls.assessment.replaceAll("-", " ") ?? "Unknown"}</strong></span>
        <span><small>Sell evidence</small><strong>{evidence?.sellSimulation.status.replaceAll("-", " ") ?? "Not run"}</strong></span>
        <span><small>Coverage</small><strong>{evidence?.coverage ?? "Unavailable"}</strong></span>
      </div>
      {warnings.length ? <div className="vnRiskFindings">{warnings.slice(0, 8).map((warning) => <span key={warning}>{warning}</span>)}</div> : <p className="vnEvidenceCaution">No warning is displayed from available evidence. Missing coverage remains unknown; this is not a safety guarantee.</p>}
      {(evidence?.contract.controls.detected.length || evidence?.contract.controls.customWriteFunctions.length) ? <details className="vnEvidenceDetails"><summary>Detected contract controls <b>{evidence.contract.controls.detected.length + evidence.contract.controls.customWriteFunctions.length}</b></summary><div>{evidence.contract.controls.detected.map((control) => <span key={`${control.category}:${control.functionName}`}><strong>{control.category}</strong><small>{control.functionName}</small></span>)}{evidence.contract.controls.customWriteFunctions.slice(0, 6).map((name) => <span key={name}><strong>Custom write</strong><small>{name}</small></span>)}</div></details> : null}
    </div>}
    <footer>Warnings inform the trader. Exact recipient, route, minimum output, freshness, authorization and simulation remain hard execution requirements.</footer>
  </section>;
}

function VerifiedMarkets({ resolution, selectedPool }: { resolution?: UniversalMarketResolution; selectedPool?: string }) {
  const pools = resolution?.pools ?? [];
  return <section className="vnWorkspaceCard vnMarketsCard" aria-labelledby="vn-verified-markets-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Onchain resolution</span><h3 id="vn-verified-markets-heading">All verified markets</h3></div><span>{pools.length} found</span></header>
    {pools.length ? <div className="vnVerifiedMarkets">{pools.map((pool) => {
      const selected = selectedPool?.toLowerCase() === pool.poolAddress.toLowerCase();
      return <a href={`${EXPLORER}/address/${pool.poolAddress}`} target="_blank" rel="noopener noreferrer" className={selected ? "isSelected" : ""} key={pool.poolAddress}>
        <span><strong>{venueLabel(pool)}{selected ? " · displayed" : ""}</strong><small>{shortAddress(pool.poolAddress)} · quote {shortAddress(pool.quoteToken)} · {pool.fee === null ? "fee read at quote" : `${pool.fee / 10_000}% fee`}</small></span>
        <b>{pool.execution === "route-check-required" ? "Quote on demand" : "View only"}</b>
        <i aria-hidden="true">↗</i>
      </a>;
    })}</div> : <div className="vnWorkspaceEmpty"><strong>No canonical pool found</strong><span>Identity may still be verified. RMT will not imply an executable route.</span></div>}
    <footer>Displayed price source, project origin and selected execution venue remain independent. The execution engine compares eligible routes only when the trader asks.</footer>
  </section>;
}

function WorkspaceRwaRelationships({ market, coverage }: { market?: ExternalMarket; coverage?: "complete" | "unavailable" }) {
  const relationships = market?.stockAssetRelationships ?? [];
  return <section className="vnWorkspaceCard vnRwaCard" aria-labelledby="vn-rwa-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">RWA relationship</span><h3 id="vn-rwa-heading">Stock-token classification</h3></div><span>{relationships.length ? "Registry verified" : coverage === "complete" ? "No match" : "Coverage unknown"}</span></header>
    {relationships.length ? <div>{relationships.map((relationship) => <span key={`${relationship.relationship}:${relationship.contractAddress}`}><strong>{relationship.tokenSymbol} · {relationship.relationship === "canonical-stock-token" ? "Canonical stock token" : "Paired market asset"}</strong><small>{relationship.tokenName} · {relationship.status} · multiplier {relationship.currentMultiplier}</small><a href={`${EXPLORER}/token/${relationship.contractAddress}`} target="_blank" rel="noopener noreferrer">Registry contract {shortAddress(relationship.contractAddress)} ↗</a></span>)}</div> : <p className="vnEvidenceCaution">{coverage === "complete" ? "The current Robinhood registry has no canonical stock-token relationship for this market." : "Registry coverage is unavailable. RMT does not infer RWA status from a name, symbol, or trading pair."}</p>}
    <footer>A project token paired with a canonical stock token is not itself classified as an RWA. Policy eligibility remains separate from route availability.</footer>
  </section>;
}

function upVenueLabel(market: VNextUpMarketIntelligence) {
  return market.venue === "up-v2"
    ? `up. V2 · ${market.stable ? "stable" : "volatile"}`
    : `up. CL · ${market.tickSpacing} spacing`;
}

function upFeeLabel(market: VNextUpMarketIntelligence) {
  return `${(market.liveFee / market.feeDenominator * 100).toLocaleString(undefined, { maximumFractionDigits: 4 })}% live fee`;
}

function WorkspaceEcosystemIntelligence({ ecosystem }: { ecosystem?: VNextEcosystemIntelligence }) {
  const markets = ecosystem?.upMarkets ?? [];
  const status = ecosystem?.status === "ready" ? "Onchain verified"
    : ecosystem?.status === "partial" ? "Partial evidence"
      : ecosystem ? "Unavailable" : "Checking";
  return <section className="vnWorkspaceCard vnEcosystemCard" aria-labelledby="vn-ecosystem-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Ecosystem intelligence</span><h3 id="vn-ecosystem-heading">up. markets &amp; gauge evidence</h3></div><span>{status}</span></header>
    {markets.length ? <div className="vnEcosystemMarkets">{markets.map((market) => <a href={`${EXPLORER}/address/${market.poolAddress}`} target="_blank" rel="noopener noreferrer" key={market.poolAddress}>
      <span><strong>{upVenueLabel(market)}</strong><small>{shortAddress(market.poolAddress)} · quote {shortAddress(market.quoteToken)}</small></span>
      <span><b>{upFeeLabel(market)}</b><small>{market.gaugeState === "live" ? "Gauge live" : market.gaugeState === "inactive" ? "Gauge inactive" : market.gaugeState === "none" ? "No gauge" : "Gauge state delayed"}</small></span>
      <i aria-hidden="true">↗</i>
    </a>)}</div> : <p className="vnEvidenceCaution">{!ecosystem ? "Checking exact up. market identity without blocking the rest of the workspace." : ecosystem.status === "unavailable" ? "up. market evidence is temporarily unavailable. RMT does not convert that into a no-market claim." : "No canonical USDG, WETH, or displayed up. pool was found for this asset at the verified block."}</p>}
    {ecosystem?.observedBlock && <p className="vnCoverageNote">Factory, pool, live fee and Voter state checked at Robinhood block {Number(ecosystem.observedBlock).toLocaleString()}.</p>}
    <footer>up. is a market venue, not project origin. It never proves StonkBrokers creation. StonkBrokers token-created and source-listed claims remain unavailable until production launcher or registry evidence is independently admitted.</footer>
  </section>;
}

export function VNextAssetWorkspace({
  presentation,
  directoryMarket,
  identityStatus,
  walletAssets,
  onTradeSide
}: {
  presentation: "desktop" | "mobile";
  directoryMarket: VNextDirectoryMarket;
  identityStatus: IdentityStatus;
  walletAssets: VNextDetectedWalletAsset[];
  onTradeSide: (side: "buy" | "sell") => void;
}) {
  const [section, setSection] = useState<"activity" | "evidence" | "markets" | "origin" | "position" | "ecosystem" | "rwa">("activity");
  const workspace = useVNextAssetWorkspace(directoryMarket.address, directoryMarket.pairAddress);
  const resolution = workspace.resolution ?? workspace.market?.resolution;
  const market = workspace.market ?? fallbackMarketFromResolution(directoryMarket, resolution);
  const selectedPool = market?.pairAddress ?? directoryMarket.pairAddress ?? resolution?.pools[0]?.poolAddress;

  const sections = [
    { id: "activity", label: "Activity" },
    { id: "evidence", label: "Safety" },
    { id: "markets", label: "Markets" },
    { id: "position", label: "Position" },
    { id: "origin", label: "Origin" },
    { id: "ecosystem", label: "up." },
    { id: "rwa", label: "RWA" }
  ] as const;
  const intelligence = section === "activity"
    ? market ? <WorkspaceActivity market={market} /> : <div className="vnWorkspaceCard vnWorkspaceEmpty"><strong>Trade activity loading</strong><span>Exact-pool activity appears only after the selected market is verified.</span></div>
    : section === "evidence"
      ? market ? <WorkspaceEvidence market={market} /> : <div className="vnWorkspaceCard vnWorkspaceEmpty"><strong>Market evidence loading</strong><span>Missing contract, liquidity and holder evidence remains unknown.</span></div>
      : section === "markets"
        ? <VerifiedMarkets resolution={resolution} selectedPool={selectedPool} />
        : section === "position"
          ? <WorkspacePosition directoryMarket={directoryMarket} walletAssets={walletAssets} onTradeSide={onTradeSide} />
          : section === "origin"
            ? <WorkspaceOrigin market={market} token={directoryMarket.address} />
            : section === "ecosystem"
              ? <WorkspaceEcosystemIntelligence ecosystem={workspace.ecosystem} />
              : <WorkspaceRwaRelationships market={market} coverage={workspace.stockAssetCoverage} />;

  return <section className={`vnAssetPanel vnAssetWorkspace is${presentation}`} aria-labelledby="vn-asset-heading">
    <header className="vnAssetWorkspaceHeader">
      <div className="vnAssetWorkspaceIdentity"><TokenArtwork className="vnAssetWorkspaceMark" symbol={directoryMarket.symbol} imageUrl={directoryMarket.imageUri} /><span><span className="vnEyebrow">Asset workspace</span><h2 id="vn-asset-heading">{directoryMarket.name} <b>{directoryMarket.symbol}</b></h2><small>Robinhood Chain · {identityStatus === "verified" ? "contract verified" : identityStatus === "checking" ? "identity checking" : "detected asset"}</small></span></div>
      <span className={`vnWorkspaceStatus is${workspace.status}`}><i aria-hidden="true" />{workspace.status === "ready" ? "Live evidence" : workspace.status === "partial" ? "Partial evidence" : workspace.status === "stale" ? "Last verified" : workspace.status === "loading" ? "Loading evidence" : "Evidence unavailable"}</span>
    </header>
    <div className="vnAssetPrice"><strong>{formatUsd(directoryMarket.priceUsd)}</strong><span className={directoryMarket.priceChange24h > 0 ? "vnPositive" : directoryMarket.priceChange24h < 0 ? "vnNegative" : ""}>{directoryMarket.priceChange24h > 0 ? "+" : ""}{directoryMarket.priceChange24h.toFixed(1)}% <small>24h</small></span></div>
    <dl className="vnAssetStats"><div><dt>Market cap</dt><dd>{compactUsd(directoryMarket.marketCapUsd)}</dd></div><div><dt>Liquidity</dt><dd>{compactUsd(directoryMarket.liquidityUsd)}</dd></div><div><dt>24h volume</dt><dd>{compactUsd(directoryMarket.volume24h)}</dd></div><div><dt>Market age</dt><dd>{formatAge(directoryMarket.ageMinutes)}</dd></div></dl>

    {selectedPool ? <VNextMarketChart token={directoryMarket.address} pair={selectedPool} symbol={directoryMarket.symbol} /> : <div className="vnChart vnChartEmpty"><strong>Verified pool required</strong><span>RMT will not render invented price history.</span></div>}

    <div className="rmtWorkspaceTabs" role="tablist" aria-label="Asset intelligence">
      {sections.map((item) => <button key={item.id} type="button" role="tab" aria-selected={section === item.id} className={section === item.id ? "isActive" : ""} onClick={() => setSection(item.id)}>{item.label}</button>)}
    </div>
    <div className="rmtWorkspaceIntelligence" role="tabpanel">{intelligence}</div>
  </section>;
}
