import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { projectById, projectCollectionDestinations, WITHDRAWN_PROJECT_RELATIONSHIPS } from "@rmt/shared/project-identity";
import { readRmtNftProjectIdentity, readRmtNftProjectOnchain } from "../../../lib/server/nft-project-market";
import { projectComposition } from "../../../lib/vnext/project-presentation";
import { TerminalIcon } from "../../vnext/terminal-icon";
import { CopyAddress, ExplorerLink } from "../../vnext/terminal-links";
import { ProjectWalletOwnership } from "../project-wallet-ownership";
import { ProjectTokenMarket } from "../project-token-market";
import { ProjectArtwork } from "../../vnext/project-artwork";

async function CollectionOwnership({ projectId, contract }: { projectId: string; contract: string }) {
  const indexed = readRmtNftProjectIdentity(projectId)?.project.collections.some(collection => collection.contractAddress.toLowerCase() === contract.toLowerCase());
  const result = indexed ? await readRmtNftProjectOnchain(projectId) : null;
  const complete = result && "completeness" in result && result.collectionAddress.toLowerCase() === contract.toLowerCase() && result.completeness === "COMPLETE" && Date.now() - Date.parse(result.asOf) <= 300_000 && Date.parse(result.asOf) <= Date.now() + 5_000;
  return <div className="rmtProjectMetricRegion isOwnership">{complete ? <div className="rmtProjectMetricStrip"><span>Holders<strong>{result.holderCount !== null ? BigInt(result.holderCount).toLocaleString() : null}</strong></span><span>Circulating NFTs<strong>{result.circulatingTokenCount !== null ? BigInt(result.circulatingTokenCount).toLocaleString() : null}</strong></span></div> : <p className="rmtProjectQuietState">Ownership data unavailable</p>}</div>;
}
export default async function ProjectMarketPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const project = projectById(projectId); if (!project) notFound();
  const { tokens, collections, label } = projectComposition(project);
  return <main className={`rmtProjectMarket ${tokens.length ? "isPairedProject" : "isNftLedProject"}`} data-project-market={projectId}>
    <nav className="rmtProjectBreadcrumb"><Link href="/projects">← Projects</Link><span>Robinhood Chain</span></nav>
    <header className="rmtProjectHero isProjectIdentity"><ProjectArtwork project={project} className="isHeroArt" priority /><div><p>{label}</p><h1>{project.displayName}</h1><span className="rmtProjectHeroComposition">{tokens.map(asset => asset.symbol ?? asset.name).join(" · ")}{tokens.length ? <b aria-label="Connected to"> ↔ </b> : null}{collections.map(asset => asset.name).join(" · ")}</span><div className="rmtProjectLinks">{project.links.map(link => <a className="rmtIconButton" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={link.label}><TerminalIcon name={link.label === "X" ? "x" : link.label === "Website" ? "website" : link.label === "Telegram" ? "telegram" : "external"} /></a>)}</div></div></header>
    <div className="rmtProjectAssetsGrid">{project.assets.map(asset => {
      const destinations = projectCollectionDestinations(project, asset.contract);
      const destination = destinations[0];
      const localCollection = readRmtNftProjectIdentity(projectId)?.project.collections.some(collection => collection.contractAddress.toLowerCase() === asset.contract.toLowerCase());
      const isToken = asset.kind === "ERC20";
      return <section className="rmtProjectAssetCard" id={asset.contract.toLowerCase()} key={asset.contract}>
        <header><ProjectArtwork project={project} contract={asset.contract} className="isAssetArt" priority /><span><small>{isToken ? "Token" : "NFT collection"}</small><h2>{asset.name ?? asset.symbol ?? "Asset"}</h2>{isToken ? <span className="rmtProjectAssetSymbol">{asset.symbol}</span> : null}</span></header>
        <div className="rmtProjectContract"><CopyAddress address={asset.contract} /><ExplorerLink kind="token" value={asset.contract} className="rmtIconButton" accessibleName={`Explore ${asset.name ?? asset.kind} contract`}><TerminalIcon name="external" /></ExplorerLink></div>
        {isToken ? <><ProjectTokenMarket contract={asset.contract} /><Link className="rmtProjectPrimary isTradeToken" href={`/?market=${asset.contract}&project=${projectId}`}>Trade token <TerminalIcon name="chevron" /></Link></> : <>{localCollection ? <Suspense fallback={<div className="rmtProjectMetricRegion isOwnership"><p className="rmtProjectQuietState">Loading ownership</p></div>}><CollectionOwnership projectId={projectId} contract={asset.contract} /></Suspense> : <div className="rmtProjectMetricRegion isUnavailableOwnership"><p className="rmtProjectQuietState">Ownership data unavailable</p></div>}{destination ? <a className="rmtProjectPrimary" href={destination.url} target="_blank" rel="noopener noreferrer">{destination.kind === "MARKETPLACE" ? "Explore NFT collection" : destination.label} <TerminalIcon name="external" /></a> : <ExplorerLink kind="token" value={asset.contract} className="rmtProjectPrimary" accessibleName={`View ${asset.name ?? asset.kind} contract`}>View contract <TerminalIcon name="external" /></ExplorerLink>}{localCollection ? <Link className="rmtProjectSecondary" href={`/nft/${projectId}`}>RMT collection <TerminalIcon name="chevron" /></Link> : null}{destinations.slice(1).map(item => <a key={item.url} className="rmtProjectSecondary" href={item.url} target="_blank" rel="noopener noreferrer">{item.label} <TerminalIcon name="external" /></a>)}</>}
      </section>; })}</div>
    <ProjectWalletOwnership projectId={projectId} />
    <details className="rmtProjectEvidence"><summary>Evidence &amp; Sources</summary><p>Project relationships connect assets. They do not authorize swaps or establish benefits. Artwork is presentation evidence, not ownership authority.</p><p>Artwork provenance: <Link href="/project-art/evidence.json">retained source records</Link>. Ownership summaries use complete, current RMT indexed evidence; unavailable summaries do not establish zero ownership.</p>{project.assets.map(asset => <article key={asset.contract}><strong>{asset.name} · {asset.relationship}</strong><code>{asset.contract}</code>{asset.evidence?.map((e, i) => <p key={i}>{e.class} · {e.source}<br />{e.observedAt}{e.blockNumber ? ` · block ${e.blockNumber}` : ""}</p>)}</article>)}{WITHDRAWN_PROJECT_RELATIONSHIPS.filter(edge => edge.projectId === projectId).map(edge => <article key={edge.asset.contract}><strong>Historical relationship · inactive</strong><code>{edge.asset.contract}</code><p>{edge.reason} · {edge.decisionEvidence.source}</p></article>)}{project.pendingRelationships?.map(edge => <p key={edge.type}>{edge.type}: {edge.reason}</p>)}</details>
  </main>;
}
