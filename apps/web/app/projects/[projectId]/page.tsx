import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { projectById, projectCollectionLink } from "@rmt/shared/project-identity";
import { readRmtNftProjectIdentity, readRmtNftProjectOnchain, readRmtNftProjectInventory } from "../../../lib/server/nft-project-market";
import { NftItemMedia } from "../../nft/_components/nft-item-media";
import { TerminalIcon } from "../../vnext/terminal-icon";
import { CopyAddress, ExplorerLink } from "../../vnext/terminal-links";
import { ProjectWalletOwnership } from "../project-wallet-ownership";
import { ProjectTokenMarket } from "../project-token-market";

async function CollectionOwnership({ projectId, contract }: { projectId: string; contract: string }) {
  const indexed = readRmtNftProjectIdentity(projectId)?.project.collections.some(collection => collection.contractAddress.toLowerCase() === contract.toLowerCase());
  const result = indexed ? await readRmtNftProjectOnchain(projectId) : null;
  const complete = result && "completeness" in result && result.collectionAddress.toLowerCase() === contract.toLowerCase() && result.completeness === "COMPLETE" && Date.now() - Date.parse(result.asOf) <= 300_000 && Date.parse(result.asOf) <= Date.now() + 5_000;
  return <div className="rmtProjectMetricStrip"><span>Holders<strong>{complete ? result.holderCount : "—"}</strong></span><span>Circulating NFTs<strong>{complete ? result.circulatingTokenCount : "—"}</strong></span><small>{complete ? "RMT canonical ownership" : "Ownership summary unavailable"}</small></div>;
}
async function CollectionArt({ projectId }: { projectId: string }) {
  const inventory = await readRmtNftProjectInventory(projectId, { limit: 1 });
  const item = inventory && "items" in inventory ? inventory.items[0] : null;
  return <div className="rmtProjectCollectionArt">{item?.metadata.status === "READY" && item.metadata.image ? <Link href={`/nft/${projectId}/${item.tokenId}`} aria-label={`Open canonical ${projectId} NFT ${item.tokenId}`}><NftItemMedia metadata={item.metadata} alt={`${projectId} #${item.tokenId}`} className="rmtProjectCanonicalArt" /></Link> : <span className="rmtProjectMonogram" aria-label="CCFF00 monogram fallback">CC</span>}<span>{item?.metadata.status === "READY" && item.metadata.image ? "Canonical inventory artwork" : "Collection identity"}</span></div>;
}
export default async function ProjectMarketPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const project = projectById(projectId); if (!project) notFound();
  const tokenCount = project.assets.filter(asset => asset.kind === "ERC20").length, nftCount = project.assets.length - tokenCount;
  return <main className="rmtProjectMarket" data-project-market={projectId}>
    <nav><Link href="/projects">← Projects</Link><Link href="/">Markets</Link><Link href="/nft">NFTs</Link></nav>
    <header className="rmtProjectHero"><p>{projectId === "ccff00" ? "RMT ecosystem · NFT-led project" : "Project Market · Robinhood Chain"}</p><h1>{project.displayName}</h1><span>{tokenCount ? `${tokenCount} ${tokenCount === 1 ? "token" : "tokens"} · ` : ""}{nftCount} NFT {nftCount === 1 ? "collection" : "collections"}</span><div className="rmtProjectLinks">{project.links.map(link => <a className="rmtIconButton" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={link.label}><TerminalIcon name={link.label === "X" ? "x" : link.label === "Website" ? "website" : "external"} /></a>)}</div></header>
    <nav className="rmtProjectAssetNav" aria-label="Project assets">{project.assets.map(asset => <a href={`#${asset.contract.toLowerCase()}`} key={asset.contract}>{asset.kind === "ERC20" ? "Token" : "NFT"} · {asset.symbol ?? asset.name}</a>)}</nav>
    <div className="rmtProjectAssetsGrid">{project.assets.map(asset => {
      const collectionLink = projectCollectionLink(project, asset.contract);
      const localCollection = readRmtNftProjectIdentity(projectId)?.project.collections.some(collection => collection.contractAddress.toLowerCase() === asset.contract.toLowerCase());
      return <section className="rmtProjectAssetCard" id={asset.contract.toLowerCase()} key={asset.contract}>
      <header><TerminalIcon name={asset.kind === "ERC20" ? "market" : "project"} /><span><small>{asset.kind === "ERC20" ? "Token market" : "NFT collection"}</small><h2>{asset.name ?? asset.symbol ?? "Asset"}</h2></span></header>
      <div className="rmtProjectContract"><CopyAddress address={asset.contract} /><ExplorerLink kind="token" value={asset.contract} className="rmtIconButton" accessibleName={`Explore ${asset.name ?? asset.kind} contract`}><TerminalIcon name="external" /></ExplorerLink></div>
      {asset.kind === "ERC20" ? <><ProjectTokenMarket contract={asset.contract} /><Link className="rmtProjectPrimary" href={`/?market=${asset.contract}&project=${projectId}`}>Open token market <TerminalIcon name="chevron" /></Link></> : <><Suspense fallback={<div className="rmtProjectMetricStrip"><small>Ownership loading</small></div>}><CollectionOwnership projectId={projectId} contract={asset.contract} /></Suspense>{localCollection ? <Link className="rmtProjectPrimary" href={`/nft/${projectId}`}>Explore collection <TerminalIcon name="chevron" /></Link> : collectionLink ? <a className="rmtProjectPrimary" href={collectionLink.url} target="_blank" rel="noopener noreferrer">View collection on OpenSea <TerminalIcon name="external" /></a> : <ExplorerLink kind="token" value={asset.contract} className="rmtProjectPrimary" accessibleName={`Explore ${asset.name ?? asset.kind} collection`}>Explore collection contract <TerminalIcon name="external" /></ExplorerLink>}</>}
    </section>; })}</div>
    {projectId === "ccff00" ? <Suspense fallback={<div className="rmtProjectCollectionArt"><span className="rmtProjectMonogram">CC</span><span>Collection identity</span></div>}><CollectionArt projectId={projectId} /></Suspense> : null}
    <ProjectWalletOwnership projectId={projectId} />
    <details className="rmtProjectEvidence"><summary>Evidence &amp; Sources</summary><p>Project relationships describe connected assets. They do not authorize swaps or establish benefits.</p>{project.assets.map(asset => <article key={asset.contract}><strong>{asset.name} · {asset.relationship}</strong><code>{asset.contract}</code>{asset.evidence?.map((e, i) => <p key={i}>{e.class} · {e.source}<br />{e.observedAt}{e.blockNumber ? ` · block ${e.blockNumber}` : ""}</p>)}</article>)}{project.pendingRelationships?.map(edge => <p key={edge.type}>{edge.type}: {edge.reason}</p>)}</details>
  </main>;
}
