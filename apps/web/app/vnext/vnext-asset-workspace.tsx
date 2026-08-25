"use client";

import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import {
  externalProjectProvenanceLabel,
  externalProjectProvenanceDescription,
  type ExternalMarket,
  type LaunchpadLifecycleEvidence,
  type ExternalSocialLinks,
  type UniversalMarketPool,
  type UniversalMarketResolution
} from "../../lib/external-market";
import { summarizeExternalTradeActors, summarizeExternalSellPressure } from "../../lib/external-trades";
import { formatOwnershipBps } from "../../lib/token-risk-evidence";
import { useExternalMarketStream } from "../../lib/use-external-market-stream";
import { useTokenRiskEvidence } from "../../lib/use-token-risk-evidence";
import { useWalletConstellation } from "../../lib/use-wallet-constellation";
import {
  selectVNextChartPool,
  shouldRequestVNextExternalWorkspaceMarket,
  type VNextDirectoryMarket,
  type VNextExecutionUiState,
  type VNextSelectedMarketExecutionState
} from "../../lib/vnext/market-directory";
import type { VNextEcosystemIntelligence, VNextUpMarketIntelligence } from "../../lib/vnext/ecosystem-intelligence";
import type { VNextUniversalMarketSearchPool } from "../../lib/vnext/universal-market-search-contract";
import type { VNextDetectedWalletAsset } from "../../lib/vnext/wallet-assets";
import { safeExternalNavigationUrl, safeExternalSocialNavigationUrl } from "../../lib/vnext/external-navigation";
import type { IdentityStatus } from "./use-vnext-market-directory";
import { CopyAddress, ExplorerLink, ExternalProjectLink } from "./terminal-links";
import { TokenArtwork } from "./token-artwork";
import { useVNextAssetWorkspace, workspaceTokenPresentation } from "./use-vnext-asset-workspace";
import { VNextMarketChart } from "./vnext-market-chart";

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

const SOCIAL_LABELS: Record<keyof ExternalSocialLinks, string> = {
  website: "Website",
  x: "X",
  telegram: "Telegram",
  discord: "Discord",
  farcaster: "Farcaster"
};

function safeSocialEntries(links?: ExternalSocialLinks) {
  if (!links) return [];
  return (Object.keys(SOCIAL_LABELS) as Array<keyof ExternalSocialLinks>).flatMap((kind) => {
    const href = kind === "website"
      ? safeExternalNavigationUrl(links[kind])
      : safeExternalSocialNavigationUrl(links[kind], kind);
    return href ? [{ kind, label: SOCIAL_LABELS[kind], href }] : [];
  });
}

function formatUsd(value: number | null) {
  if (value === null) return "Unavailable";
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 5 })}`;
}

function compactUsd(value: number | null) {
  if (value === null) return "Unavailable";
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

function WorkspacePosition({
  directoryMarket,
  walletAssets,
  executionState,
  executionUiState,
  onTradeSide
}: {
  directoryMarket: VNextDirectoryMarket;
  walletAssets: VNextDetectedWalletAsset[];
  executionState: VNextSelectedMarketExecutionState;
  executionUiState: VNextExecutionUiState;
  onTradeSide: (side: "buy" | "sell") => void;
}) {
  const { address, isConnected } = useAccount();
  const holding = walletAssets.find((asset) => asset.address.toLowerCase() === directoryMarket.address.toLowerCase());
  const units = holding?.decimals === null || !holding ? null : Number(formatUnits(BigInt(holding.balanceAtomic), holding.decimals));
  const positionValue = units !== null && Number.isFinite(units) && directoryMarket.priceUsd !== null ? units * directoryMarket.priceUsd : null;
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
    {executionState === "stock-token-view-only" ? <>
      <div className="vnPositionActions isViewOnly"><button type="button" disabled>View only</button></div>
      <p className="vnStockTokenViewOnlyPolicy">Official Robinhood Stock Tokens are view-only in RMT until jurisdiction controls are available.</p>
    </> : executionState === "asset-only" ? <>
      <div className="vnPositionActions isViewOnly"><button type="button" disabled>Asset only</button></div>
      <p className="vnStockTokenViewOnlyPolicy">Onchain identity is verified. No supported market evidence is attached, so execution is not evaluated.</p>
    </> : <div className="vnPositionActions"><button type="button" onClick={() => onTradeSide("buy")}>{executionUiState === "preview-only" ? "Buy quote" : "Buy"}</button><button type="button" disabled={!hasPosition} onClick={() => onTradeSide("sell")}>{executionUiState === "preview-only" ? "Sell quote" : "Sell"}</button></div>}
    <footer>Exact connected-wallet balance. Cost basis and P&amp;L remain hidden until complete wallet history can be proven.</footer>
  </section>;
}

function WorkspaceQuickLinks({
  directoryMarket,
  market,
  primaryPool
}: {
  directoryMarket: VNextDirectoryMarket;
  market?: ExternalMarket;
  primaryPool?: string;
}) {
  const projectLinks = safeSocialEntries(market?.project?.socials);
  const projectUrls = new Set(projectLinks.map((link) => link.href));
  const observedLinks = safeSocialEntries(market?.socials).filter((link) => !projectUrls.has(link.href));
  const origin = market?.origin;
  const creationTransaction = origin?.kind === "rmt-v6"
    ? origin.launchTransactionHash
    : origin?.state === "attributed" ? origin.claim.transactionHash : undefined;

  return <section className="vnAssetQuickLinks" aria-label="Selected asset identity and links">
    <div className="vnAssetContractIdentity">
      <span><small>Token contract · Robinhood Chain</small><CopyAddress address={directoryMarket.address} /></span>
      <ExplorerLink kind="token" value={directoryMarket.address} accessibleName={`Open ${directoryMarket.symbol} token contract in Robinhood Chain explorer`}>Explorer ↗</ExplorerLink>
    </div>
    <div className="vnAssetQuickLinkRows">
      {primaryPool ? <ExplorerLink kind="pool" value={primaryPool} accessibleName={`Open ${directoryMarket.symbol} primary pool in Robinhood Chain explorer`}>Primary pool ↗</ExplorerLink> : null}
      <ExternalProjectLink href={market?.url ?? directoryMarket.url} accessibleName={`Open ${directoryMarket.symbol} market source`}>Market source ↗</ExternalProjectLink>
      {market?.project?.creator ? <ExplorerLink kind="address" value={market.project.creator} accessibleName={`Open reported creator address for ${directoryMarket.symbol}`}>Creator address ↗</ExplorerLink> : null}
      {creationTransaction ? <ExplorerLink kind="transaction" value={creationTransaction} accessibleName={`Open creation evidence for ${directoryMarket.symbol}`}>Creation transaction ↗</ExplorerLink> : null}
    </div>
    {projectLinks.length ? <div className="vnProjectLinkGroup">
      <small>Project links · {market?.project ? externalProjectProvenanceLabel(market.project) : "cross-checked metadata"}</small>
      <div>{projectLinks.map((link) => <ExternalProjectLink href={link.href} socialKind={link.kind === "website" ? undefined : link.kind} accessibleName={`Open ${directoryMarket.symbol} project ${link.label}`} key={`${link.kind}:${link.href}`}>{link.label} ↗</ExternalProjectLink>)}</div>
    </div> : null}
    {observedLinks.length ? <div className="vnProjectLinkGroup isObserved">
      <small>Project links · market metadata</small>
      <div>{observedLinks.map((link) => <ExternalProjectLink href={link.href} socialKind={link.kind === "website" ? undefined : link.kind} accessibleName={`Open ${directoryMarket.symbol} ${link.label} from market metadata`} key={`${link.kind}:${link.href}`}>{link.label} ↗</ExternalProjectLink>)}</div>
      <p>Reported by DEX market metadata; RMT does not guarantee project control of these destinations.</p>
    </div> : null}
  </section>;
}

function lifecycleStateLabel(state: LaunchpadLifecycleEvidence["state"]) {
  return state.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}

function WorkspaceOrigin({
  market,
  token,
  launchpadEvidence
}: {
  market?: ExternalMarket;
  token: string;
  launchpadEvidence: LaunchpadLifecycleEvidence[];
}) {
  const origin = market?.origin;
  const verified = launchpadEvidence.length > 0 || origin?.kind === "rmt-v6" || origin?.state === "attributed";
  const label = launchpadEvidence.length === 1
    ? `${launchpadEvidence[0]!.sourceName} · ${lifecycleStateLabel(launchpadEvidence[0]!.state)}`
    : launchpadEvidence.length > 1 ? "Multiple verified launch sources"
      : origin?.kind === "rmt-v6" ? "RMT V6 verified"
    : origin?.state === "attributed" ? origin.sourceName
      : origin?.state === "disputed" ? "Origin disputed"
        : origin?.state === "unattributed" ? "Origin unattributed"
          : origin ? "Origin unknown" : "Origin checking";
  const detail = launchpadEvidence.length
    ? "Token-level launch provenance and lifecycle are independently verified. Current market venue evidence remains separate."
    : origin?.kind === "rmt-v6" ? `Creation proven at launch block ${origin.launchBlock}.`
    : origin?.state === "attributed" ? `${origin.claim.claimKind.replace("-", " ")} · independently indexed from ${origin.coverage} coverage.`
      : origin?.state === "disputed" ? `${origin.claims.length} incompatible claims require review; RMT does not choose one.`
        : origin?.state === "unattributed" ? "Complete indexed coverage found no verified creator source."
          : origin?.state === "unknown" ? `Coverage is ${origin.coverage}; no creator attribution is inferred.`
            : "No attribution is shown before verified evidence arrives.";
  const evidenceTransaction = origin?.kind === "rmt-v6" ? origin.launchTransactionHash
    : origin?.state === "attributed" ? origin.claim.transactionHash : undefined;

  return <section className="vnWorkspaceCard vnOriginCard" aria-labelledby="vn-origin-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Project origin</span><h3 id="vn-origin-heading">{label}</h3></div><span>{verified ? "Verified" : "Not inferred"}</span></header>
    <p>{detail}</p>
    {market?.project && <p className="vnOriginProject">{externalProjectProvenanceDescription(market.project)}</p>}
    {launchpadEvidence.length ? <div className="vnLaunchpadLifecycle" aria-label="Launch venue and lifecycle evidence">
      {launchpadEvidence.map((evidence) => <article key={`${evidence.sourceId}:${evidence.version}:${evidence.factory}`}>
        <div><strong>{evidence.sourceName}</strong><span>{evidence.version} · {lifecycleStateLabel(evidence.state)} · {evidence.current ? "Current" : "Historical"}</span></div>
        <dl>
          <div><dt>Origin venue</dt><dd>{evidence.sourceName}</dd></div>
          <div><dt>Current venue</dt><dd>{evidence.venue.kind === "canonical-pool" ? evidence.venue.poolId ? "Canonical V4 PoolId" : "Canonical pool" : evidence.venue.kind === "source-market" ? "Launch-source market" : evidence.venue.kind === "bonding-curve" ? "Live bonding curve" : evidence.venue.kind === "launch-pending" ? "Launch pending" : "Unavailable"}</dd></div>
          <div><dt>Recent activity</dt><dd>{evidence.activity.buys24h === null || evidence.activity.sells24h === null ? "Unavailable" : `${evidence.activity.buys24h} buys · ${evidence.activity.sells24h} sells`}</dd></div>
        </dl>
        <div className="vnOriginLinks">
          <ExplorerLink kind="address" value={evidence.factory}>{evidence.sourceName} contract ↗</ExplorerLink>
          {evidence.creator ? <ExplorerLink kind="address" value={evidence.creator}>Creator {shortAddress(evidence.creator)} ↗</ExplorerLink> : null}
          {evidence.launchTransactionHash ? <ExplorerLink kind="transaction" value={evidence.launchTransactionHash}>Launch transaction ↗</ExplorerLink> : null}
          {evidence.venue.address ? <ExplorerLink kind={evidence.venue.kind === "canonical-pool" || evidence.venue.kind === "source-market" ? "pool" : "address"} value={evidence.venue.address}>{evidence.venue.kind === "canonical-pool" || evidence.venue.kind === "source-market" ? "Current pool" : "Current venue"} ↗</ExplorerLink> : null}
        </div>
      </article>)}
    </div> : <p>No independently verified launch-venue lifecycle evidence is attached.</p>}
    <div className="vnOriginLinks">
      <ExplorerLink kind="token" value={token}>Contract {shortAddress(token)} ↗</ExplorerLink>
      {evidenceTransaction && <ExplorerLink kind="transaction" value={evidenceTransaction}>Creation evidence ↗</ExplorerLink>}
      {market?.project?.creator && <ExplorerLink kind="address" value={market.project.creator}>Creator {shortAddress(market.project.creator)} ↗</ExplorerLink>}
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
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Confirmed activity</span><h3 id="vn-activity-heading">Market flow &amp; trade tape</h3></div><span className={`vnLiveState is${stream.status}`}><i aria-hidden="true" />{stream.status === "live" ? "Streaming" : stream.status === "fallback" ? "Fallback live" : stream.status === "connecting" ? "Connecting" : stream.status === "unsupported" ? "Unavailable" : "Reconnecting"}</span></header>
    <div className="vnMarketFlow" aria-label="Market activity by time window">{windows.map((window) => <span key={window.label}><b>{window.label}</b><small>{window.buys.toLocaleString()} buys · {window.sells.toLocaleString()} sells</small><strong>{compactUsd(window.volume)}</strong></span>)}</div>
    <div className="vnActivitySummary">
      <span><small>Swaps shown</small><strong>{trades.length}</strong></span>
      <span><small>Active wallets</small><strong>{actors.uniqueActors}</strong></span>
      <span><small>5m net sells</small><strong className={pressure.level === "urgent" ? "vnNegative" : ""}>{compactUsd(pressure.netSellVolume5mUsd)}</strong></span>
    </div>
    {actors.actors.length > 0 && <div className="vnActorStrip" aria-label="Most active confirmed wallets">{actors.actors.slice(0, 4).map((actor) => <ExplorerLink kind="address" value={actor.trader} accessibleName={`Open active wallet ${shortAddress(actor.trader)} in Robinhood Chain explorer`} key={actor.trader}><span><strong>{shortAddress(actor.trader)}</strong><small>{actor.buyCount} buys · {actor.sellCount} sells</small></span><b className={actor.netVolumeUsd < 0 ? "vnNegative" : "vnPositive"}>{actor.netVolumeUsd < 0 ? "−" : "+"}{compactUsd(Math.abs(actor.netVolumeUsd))}</b></ExplorerLink>)}</div>}
    {trades.length ? <details className="vnTapeDetails"><summary>Latest confirmed swaps <b>{trades.length}</b></summary><div className="vnTradeTape">
      {trades.slice(0, 12).map((trade) => <ExplorerLink kind="transaction" value={trade.transactionHash} accessibleName={`Open ${trade.side} transaction in Robinhood Chain explorer`} key={trade.id}>
        <b className={trade.side === "buy" ? "isBuy" : "isSell"}>{trade.side}</b>
        <span><strong>{trade.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {market.symbol}</strong><small>{shortAddress(trade.trader)}</small></span>
        <span><strong>{compactUsd(trade.volumeUsd)}</strong><small>{relativeTime(trade.timestamp)} ago ↗</small></span>
      </ExplorerLink>)}
    </div></details> : <div className="vnWorkspaceEmpty"><strong>{stream.status === "unsupported" ? "Exact-pool activity unavailable" : stream.status === "connecting" ? "Opening exact-pool stream" : "No recent swaps"}</strong><span>{stream.status === "unsupported" ? "This market representation does not expose a conventional verified EVM pool address. The canonical market remains visible." : "New confirmed swaps appear without resetting the workspace."}</span></div>}
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
      {holders.length > 0 ? <><div className="vnConcentrationTrack" aria-label={`Visible top-holder concentration ${formatOwnershipBps(graph?.holderSnapshot.topNonPoolShareBps ?? null)}`}>{holders.slice(0, 6).map((holder, index) => <i className={holder.isFlagged ? "isFlagged" : holder.isContract ? "isContract" : ""} style={{ width: `${Math.max(.75, (holder.supplyShareBps ?? 0) / 100)}%` }} title={`${shortAddress(holder.address)} · ${formatOwnershipBps(holder.supplyShareBps)}`} key={holder.address} data-rank={index + 1} />)}</div><div className="vnHolderList">{holders.slice(0, 8).map((holder, index) => <ExplorerLink kind="address" value={holder.address} accessibleName={`Open holder ${shortAddress(holder.address)} in Robinhood Chain explorer`} key={holder.address}><b>{index + 1}</b><span><strong>{shortAddress(holder.address)}</strong><small>{holder.role === "creator" ? "Reported creator" : holder.isFlagged ? "Explorer flagged" : holder.isContract ? "Contract" : "Wallet"}</small></span><strong>{formatOwnershipBps(holder.supplyShareBps)}</strong><i aria-hidden="true">↗</i></ExplorerLink>)}</div></> : <p className="vnEvidenceCaution">Holder rows are unavailable. Missing concentration data remains unknown, never safe.</p>}
      {graph?.signals.length ? <details className="vnEvidenceDetails"><summary>Observed wallet relationships <b>{graph.signals.length}</b></summary><div>{graph.signals.slice(0, 4).map((signal) => <span className={signal.severity} key={`${signal.code}:${signal.relatedAddresses.join(":")}`}><strong>{signal.label}</strong><small>{signal.relatedAddresses.map(shortAddress).join(" ↔ ")}</small><small>{signal.description}</small></span>)}</div></details> : null}
      {graph && <p className="vnCoverageNote">{graph.coverage.description} · {graph.coverage.sampledTransfers} transfers sampled.</p>}
    </div>}

    {tab === "liquidity" && <div className="vnEvidencePane" role="tabpanel">
      <div className="vnLiquidityHeadline"><span><small>Displayed pool liquidity</small><strong>{compactUsd(market.liquidityUsd)}</strong></span><ExplorerLink kind="pool" value={market.pairAddress}>Pool {shortAddress(market.pairAddress)} ↗</ExplorerLink></div>
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

function canonicalVenueLabel(pool: VNextUniversalMarketSearchPool) {
  return `${pool.protocol === "uniswap" ? "Uniswap" : pool.protocol === "sushiswap" ? "Sushi" : "up."} V${pool.version}`;
}

function VerifiedMarkets({
  canonicalMarkets,
  resolution,
  selectedPool
}: {
  canonicalMarkets?: VNextUniversalMarketSearchPool[];
  resolution?: UniversalMarketResolution;
  selectedPool?: string;
}) {
  if (canonicalMarkets?.length) {
    return <section className="vnWorkspaceCard vnMarketsCard" aria-labelledby="vn-verified-markets-heading">
      <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Canonical inventory</span><h3 id="vn-verified-markets-heading">Canonical markets</h3></div><span>{canonicalMarkets.length} found</span></header>
      <div className="vnVerifiedMarkets">{canonicalMarkets.map((pool) => {
        const selected = Boolean(pool.poolAddress && selectedPool?.toLowerCase() === pool.poolAddress.toLowerCase());
        const identity = pool.poolAddress ?? pool.poolKey;
        return <ExplorerLink kind={pool.poolAddress ? "pool" : "transaction"} value={pool.poolAddress ?? pool.transactionHash} className={selected ? "isSelected" : ""} accessibleName={`Open ${canonicalVenueLabel(pool)} market evidence in Robinhood Chain explorer`} key={`${pool.sourceId}:${pool.poolKey}`}>
          <span><strong>{canonicalVenueLabel(pool)}{selected ? " · displayed" : ""}</strong><small>{pool.version === 4 ? `PoolId ${shortAddress(pool.poolKey)}` : `Pool ${shortAddress(identity)}`} · tokens {shortAddress(pool.token0)} / {shortAddress(pool.token1)}</small></span>
          <b>Canonical inventory</b>
          <i aria-hidden="true">↗</i>
        </ExplorerLink>;
      })}</div>
      <footer>Canonical market existence does not imply chart coverage or execution availability. The execution engine evaluates routes only when the trader asks.</footer>
    </section>;
  }
  const pools = resolution?.pools ?? [];
  return <section className="vnWorkspaceCard vnMarketsCard" aria-labelledby="vn-verified-markets-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">Onchain resolution</span><h3 id="vn-verified-markets-heading">Canonical markets</h3></div><span>{pools.length} found</span></header>
    {pools.length ? <div className="vnVerifiedMarkets">{pools.map((pool) => {
      const selected = selectedPool?.toLowerCase() === pool.poolAddress.toLowerCase();
      return <ExplorerLink kind="pool" value={pool.poolAddress} className={selected ? "isSelected" : ""} accessibleName={`Open ${venueLabel(pool)} pool in Robinhood Chain explorer`} key={pool.poolAddress}>
        <span><strong>{venueLabel(pool)}{selected ? " · displayed" : ""}</strong><small>{shortAddress(pool.poolAddress)} · quote {shortAddress(pool.quoteToken)} · {pool.fee === null ? "fee read at quote" : `${pool.fee / 10_000}% fee`}</small></span>
        <b>{pool.execution === "route-check-required" ? "Quote on demand" : "View only"}</b>
        <i aria-hidden="true">↗</i>
      </ExplorerLink>;
    })}</div> : <div className="vnWorkspaceEmpty"><strong>No canonical market evidence attached</strong><span>Verified asset identity remains available. Metrics, chart activity, and execution are not evaluated without a supported market.</span></div>}
    <footer>Displayed price source, project origin and selected execution venue remain independent. The execution engine compares eligible routes only when the trader asks.</footer>
  </section>;
}

function WorkspaceRwaRelationships({ relationships, coverage }: { relationships: NonNullable<ExternalMarket["stockAssetRelationships"]>; coverage?: "complete" | "stale" | "unavailable" }) {
  return <section className="vnWorkspaceCard vnRwaCard" aria-labelledby="vn-rwa-heading">
    <header className="vnWorkspaceCardHead"><div><span className="vnEyebrow">RWA relationship</span><h3 id="vn-rwa-heading">Stock-token classification</h3></div><span>{relationships.length ? coverage === "stale" ? "Last-known registry" : "Registry verified" : coverage === "complete" ? "No match" : coverage === "stale" ? "Last-known coverage" : "Coverage unknown"}</span></header>
    {relationships.length ? <div>{relationships.map((relationship) => <span key={`${relationship.relationship}:${relationship.contractAddress}`}><strong>{relationship.tokenSymbol} · {relationship.relationship === "canonical-stock-token" ? "Canonical stock token" : "Paired market asset"}</strong><small>{relationship.tokenName} · {relationship.status} · multiplier {relationship.currentMultiplier}</small><small>{coverage === "stale" ? "Provenance · Robinhood registry · last known, non-authoritative" : "Provenance · Robinhood live asset registry"}</small><ExplorerLink kind="token" value={relationship.contractAddress}>Registry contract {shortAddress(relationship.contractAddress)} ↗</ExplorerLink></span>)}</div> : <p className="vnEvidenceCaution">{coverage === "complete" ? "The current Robinhood registry has no canonical stock-token relationship for this market." : coverage === "stale" ? "Only last-known Robinhood registry coverage is available. It is not current execution authority." : "Registry coverage is unavailable. RMT does not infer RWA status from a name, symbol, or trading pair."}</p>}
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
    {markets.length ? <div className="vnEcosystemMarkets">{markets.map((market) => <ExplorerLink kind="pool" value={market.poolAddress} accessibleName={`Open ${upVenueLabel(market)} pool in Robinhood Chain explorer`} key={market.poolAddress}>
      <span><strong>{upVenueLabel(market)}</strong><small>{shortAddress(market.poolAddress)} · quote {shortAddress(market.quoteToken)}</small></span>
      <span><b>{upFeeLabel(market)}</b><small>{market.gaugeState === "live" ? "Gauge live" : market.gaugeState === "inactive" ? "Gauge inactive" : market.gaugeState === "none" ? "No gauge" : "Gauge state delayed"}</small></span>
      <i aria-hidden="true">↗</i>
    </ExplorerLink>)}</div> : <p className="vnEvidenceCaution">{!ecosystem ? "Checking exact up. market identity without blocking the rest of the workspace." : ecosystem.status === "unavailable" ? "up. market evidence is temporarily unavailable. RMT does not convert that into a no-market claim." : "No canonical USDG, WETH, or displayed up. pool was found for this asset at the verified block."}</p>}
    {ecosystem?.observedBlock && <p className="vnCoverageNote">Factory, pool, live fee and Voter state checked at Robinhood block {Number(ecosystem.observedBlock).toLocaleString()}.</p>}
    <footer>up. is a market venue, not project origin. It never proves StonkBrokers creation. StonkBrokers token-created and source-listed claims remain unavailable until production launcher or registry evidence is independently admitted.</footer>
  </section>;
}

export function VNextAssetWorkspace({
  presentation,
  directoryMarket,
  identityStatus,
  walletAssets,
  executionState,
  executionUiState,
  onTradeSide
}: {
  presentation: "desktop" | "mobile";
  directoryMarket: VNextDirectoryMarket;
  identityStatus: IdentityStatus;
  walletAssets: VNextDetectedWalletAsset[];
  executionState: VNextSelectedMarketExecutionState;
  executionUiState: VNextExecutionUiState;
  onTradeSide: (side: "buy" | "sell") => void;
}) {
  const [section, setSection] = useState<"activity" | "evidence" | "markets" | "origin" | "position" | "ecosystem" | "rwa">("activity");
  const workspace = useVNextAssetWorkspace(
    directoryMarket.address,
    directoryMarket.pairAddress,
    shouldRequestVNextExternalWorkspaceMarket(directoryMarket)
  );
  const resolution = workspace.resolution ?? workspace.market?.resolution;
  const market = workspace.market;
  const presentationIdentity = workspaceTokenPresentation({
    address: directoryMarket.address,
    resolution,
    canonicalIdentity: directoryMarket.verifiedIdentity,
    provider: market,
    fallback: directoryMarket
  });
  const displayName = presentationIdentity.name;
  const displaySymbol = presentationIdentity.symbol;
  const canonicalStockRelationship = workspace.stockAssetRelationships.find((relationship) => (
    relationship.relationship === "canonical-stock-token"
    && relationship.contractAddress.toLowerCase() === directoryMarket.address.toLowerCase()
  ));
  const workspacePool = market ? selectVNextChartPool(market) : undefined;
  const directoryPool = selectVNextChartPool(directoryMarket);
  const selectedPool = workspacePool ?? directoryPool;
  const lifecycleBySource = new Map<string, LaunchpadLifecycleEvidence>();
  for (const evidence of [...(directoryMarket.launchpadEvidence ?? []), ...(market?.launchpadEvidence ?? [])]) {
    lifecycleBySource.set(`${evidence.sourceId}:${evidence.version}:${evidence.factory}`.toLowerCase(), evidence);
  }
  const launchpadEvidence = [...lifecycleBySource.values()];
  const originState = launchpadEvidence.length
    ? launchpadEvidence.map((evidence) => `${evidence.sourceName} ${lifecycleStateLabel(evidence.state)}`).join(" · ")
    : market?.origin?.kind === "rmt-v6"
    ? "RMT V6 creation proven"
    : market?.origin?.state === "attributed" ? `${market.origin.sourceName} attributed`
      : market?.origin?.state === "disputed" ? "Disputed"
        : market?.origin?.state === "unattributed" ? "Unattributed"
          : "Unknown";

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
    ? market ? <WorkspaceActivity market={market} /> : <div className="vnWorkspaceCard vnWorkspaceEmpty"><strong>Trade activity loading</strong><span>Exact-pool activity appears when canonical market evidence and telemetry are available.</span></div>
    : section === "evidence"
      ? market ? <WorkspaceEvidence market={market} /> : <div className="vnWorkspaceCard vnWorkspaceEmpty"><strong>Market evidence loading</strong><span>Missing contract, liquidity and holder evidence remains unknown.</span></div>
      : section === "markets"
        ? <VerifiedMarkets canonicalMarkets={directoryMarket.canonicalMarkets} resolution={resolution} selectedPool={selectedPool} />
        : section === "position"
          ? <WorkspacePosition directoryMarket={directoryMarket} walletAssets={walletAssets} executionState={executionState} executionUiState={executionUiState} onTradeSide={onTradeSide} />
          : section === "origin"
            ? <WorkspaceOrigin market={market} token={directoryMarket.address} launchpadEvidence={launchpadEvidence} />
            : section === "ecosystem"
              ? <WorkspaceEcosystemIntelligence ecosystem={workspace.ecosystem} />
              : <WorkspaceRwaRelationships relationships={workspace.stockAssetRelationships} coverage={workspace.stockAssetCoverage} />;

  return <section className={`vnAssetPanel vnAssetWorkspace is${presentation}`} aria-labelledby="vn-asset-heading">
    <header className="vnAssetWorkspaceHeader">
      <div className="vnAssetWorkspaceIdentity"><TokenArtwork className="vnAssetWorkspaceMark" symbol={displaySymbol} imageUrl={directoryMarket.imageUri ?? canonicalStockRelationship?.logoUrl ?? undefined} /><span><span className="vnEyebrow">Asset workspace</span><h2 id="vn-asset-heading">{displayName} <b>{displaySymbol}</b></h2><small>Robinhood Chain · {presentationIdentity.verified || identityStatus === "verified" ? "onchain token identity proven" : identityStatus === "checking" ? "identity checking" : "identity evidence unavailable"}</small></span></div>
      <div className="vnWorkspaceStatusGroup">{executionState === "stock-token-view-only" ? <strong className="vnStockTokenViewOnlyBadge">View only</strong> : null}<span className={`vnWorkspaceStatus is${workspace.status}`}><i aria-hidden="true" />{workspace.status === "ready" ? "Live evidence" : workspace.status === "partial" ? "Partial evidence" : workspace.status === "stale" ? "Last loaded" : workspace.status === "loading" ? "Loading evidence" : "Evidence unavailable"}</span></div>
    </header>
    <div className="vnAssetPrice"><strong>{formatUsd(directoryMarket.priceUsd)}</strong><span className={directoryMarket.priceChange24h !== null && directoryMarket.priceChange24h > 0 ? "vnPositive" : directoryMarket.priceChange24h !== null && directoryMarket.priceChange24h < 0 ? "vnNegative" : ""}>{directoryMarket.priceChange24h === null ? "Unavailable" : `${directoryMarket.priceChange24h > 0 ? "+" : ""}${directoryMarket.priceChange24h.toFixed(1)}%`} <small>24h</small></span></div>
    <dl className="vnAssetStats"><div><dt>Market cap</dt><dd>{compactUsd(directoryMarket.marketCapUsd)}</dd></div><div><dt>Liquidity</dt><dd>{compactUsd(directoryMarket.liquidityUsd)}</dd></div><div><dt>24h volume</dt><dd>{compactUsd(directoryMarket.volume24h)}</dd></div><div><dt>Market age</dt><dd>{formatAge(directoryMarket.ageMinutes)}</dd></div></dl>

    <dl className="vnAssetIdentityFacts" aria-label="Selected market identity">
      <div><dt>Chain</dt><dd>Robinhood Chain · 4663</dd></div>
      <div><dt>Primary venue</dt><dd>{market?.dexId ?? directoryMarket.dexId ?? "Unknown"}</dd></div>
      <div><dt>Project origin</dt><dd>{originState}</dd></div>
      <div><dt>RWA relationship</dt><dd>{canonicalStockRelationship ? "Canonical stock token" : workspace.stockAssetRelationships.some((relationship) => relationship.relationship === "paired-market-asset") || directoryMarket.rwaRelationship === "paired-market-asset" ? "RWA-paired market" : "Not reported"}</dd></div>
    </dl>
    <WorkspaceQuickLinks directoryMarket={directoryMarket} market={market} primaryPool={selectedPool} />

    {selectedPool ? <VNextMarketChart token={directoryMarket.address} pair={selectedPool} symbol={directoryMarket.symbol} /> : <div className="vnChart vnChartEmpty"><strong>Canonical pool required</strong><span>RMT will not render invented price history.</span></div>}

    <div className="rmtWorkspaceTabs" role="tablist" aria-label="Asset intelligence">
      {sections.map((item) => <button key={item.id} type="button" role="tab" aria-selected={section === item.id} className={section === item.id ? "isActive" : ""} onClick={() => setSection(item.id)}>{item.label}</button>)}
    </div>
    <div className="rmtWorkspaceIntelligence" role="tabpanel">{intelligence}</div>
  </section>;
}
