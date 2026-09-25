import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cache, Suspense } from "react";
import { formatUnits } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  readRmtNftProjectIdentity,
  readRmtNftProjectInventory,
  readRmtNftProjectMarketplace,
  readRmtNftProjectOnchain,
} from "../../../lib/server/nft-project-market";
import { NftItemMedia } from "../_components/nft-item-media";
import styles from "./project-market.module.css";
import inventoryStyles from "./inventory.module.css";

export const dynamic = "force-dynamic";
const readInventoryForRequest = cache((projectId: string, afterTokenId?: string) => readRmtNftProjectInventory(projectId, { afterTokenId, limit: 24 }));
const readOnchainForRequest = cache(readRmtNftProjectOnchain);
const readMarketplaceForRequest = cache(readRmtNftProjectMarketplace);

function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function amount(value: string, decimals: number) {
  const [whole, fraction = ""] = formatUnits(BigInt(value), decimals).split(".");
  return fraction ? `${whole}.${fraction.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "") : whole;
}

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }): Promise<Metadata> {
  const { projectId } = await params;
  return projectId.toLowerCase() === "ccff00"
    ? { title: "CCFF00 NFT Project Market | RMT", description: "RMT-curated CCFF00 NFT activity, ownership and OpenSea market evidence on Robinhood Chain." }
    : { robots: { index: false, follow: false } };
}

async function MarketplaceMetrics({ projectId }: { projectId: string }) {
  const result = await readMarketplaceForRequest(projectId);
  const marketplace = result && "provider" in result ? result : null;
  const current = marketplace && ["AVAILABLE", "PARTIAL"].includes(marketplace.availability) ? marketplace : null;
  const listing = current?.lowestNormalizedListing ?? null;
  const volume = current?.volume24hByPaymentAsset.length
    ? current.volume24hByPaymentAsset.map((entry) => `${amount(entry.grossAmount, entry.paymentAsset.decimals)} ${entry.paymentAsset.symbol}`).join(" · ") : "—";
  const reports = current ? current.recentProviderSales.length.toString() : "—";
  const provenance = marketplace?.availabilityReason === "STALE" ? "Exact native listing stale · 24h aggregates separately current"
    : current ? `OpenSea observed ${new Date(current.asOf!).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}`
      : marketplace?.availabilityReason === "SOURCE_STALE" ? "OpenSea source stale · current metrics unavailable" : "Marketplace evidence unavailable";
  return <>
    <article data-marketplace-metric="NATIVE_FLOOR"><span>NATIVE FLOOR</span><strong>{listing ? `${amount(listing.grossAmount, listing.paymentAsset.decimals)} ${listing.paymentAsset.symbol}` : "—"}</strong><small>{listing ? "Lowest normalized native-payment OpenSea listing · not executable" : provenance}</small></article>
    <article data-marketplace-metric="24H_VOLUME"><span>24H VOLUME</span><strong>{volume}</strong><small>{current ? "OpenSea-reported 24h aggregate · exact payment assets" : provenance}</small></article>
    <article data-marketplace-metric="RECENT_REPORTS"><span>RECENT REPORTS</span><strong>{reports}</strong><small>{current ? `Latest provider reports · bounded to ${current.recentProviderSales.length}/20 records · not a 24h total` : provenance}</small></article>
  </>;
}

async function OwnershipMetrics({ projectId }: { projectId: string }) {
  const result = await readOnchainForRequest(projectId);
  const onchain = result && "sourceStatus" in result ? result : null;
  return <>
    <article><span>HOLDERS</span><strong>{onchain?.holderCount ?? "—"}</strong><small>{onchain?.completeness === "COMPLETE" ? "Canonical current ownership" : onchain?.sourceStatus === "BACKFILLING" ? "Ownership backfilling" : "Ownership unavailable"}</small></article>
    <article><span>SUPPLY</span><strong>{onchain?.circulatingTokenCount ?? "—"}</strong><small>{onchain ? "Current canonical ownership rows" : "Ownership unavailable"}</small></article>
  </>;
}

async function CollectionSpotlight({ projectId, displayName }: { projectId: string; displayName: string }) {
  const inventory = await readInventoryForRequest(projectId);
  const featured = inventory && "items" in inventory && inventory.availability === "AVAILABLE" ? inventory.items.slice(0, 3) : [];
  return <section className={styles.collectionSpotlight} aria-label={`${displayName} collection spotlight`}>
    <div className={styles.collectionHeroCopy}><span>COLLECTION SPOTLIGHT</span><h2>Canonical art. Current ownership.</h2><p>Onchain tokenURI inventory and ownership remain canonical. Marketplace evidence is shown separately.</p></div>
    <div className={styles.heroArt}>{featured.length ? featured.map((item, index) => <Link href={`/nft/${projectId}/${item.tokenId}`} key={item.tokenId} className={styles[`heroArt${index + 1}`]}><NftItemMedia metadata={item.metadata} alt={`${displayName} token ${item.tokenId}`} className={styles.heroArtMedia} /><span>#{item.tokenId}</span></Link>) : <div className={styles.heroArtUnavailable}>CANONICAL ART<br/>AWAITING INDEXER</div>}</div>
  </section>;
}

async function InventoryGallery({ projectId, displayName, afterTokenId }: { projectId: string; displayName: string; afterTokenId?: string }) {
  const inventory = await readInventoryForRequest(projectId, afterTokenId);
  return <section className={inventoryStyles.collection} id="items" data-nft-gallery aria-labelledby="collection-heading">
    <div className={inventoryStyles.collectionHead}><div><p>CANONICAL ONCHAIN INVENTORY</p><h2 id="collection-heading">Collection</h2><span>Current ERC721 ownership · metadata from onchain tokenURI</span></div>{afterTokenId ? <Link href={`/nft/${projectId}`}>Back to start</Link> : null}</div>
    {inventory && "items" in inventory && inventory.availability === "AVAILABLE" && inventory.items.length
      ? <div className={inventoryStyles.itemGrid}>{inventory.items.map((item) => { const color = item.metadata.attributes.find((candidate) => candidate.traitType === "Color"); return <Link className={inventoryStyles.itemCard} href={`/nft/${projectId}/${item.tokenId}`} key={item.tokenId}><NftItemMedia metadata={item.metadata} alt={`${displayName} token ${item.tokenId}`} className={inventoryStyles.cardMedia} /><div className={inventoryStyles.cardIdentity}><strong>#{item.tokenId}</strong><span>{color?.value ?? displayName}</span></div><div className={inventoryStyles.cardOwner}><span>OWNER</span><code>{short(item.owner)}</code></div><small>{item.metadata.status === "READY" ? "● ONCHAIN" : "METADATA UNAVAILABLE"}</small></Link>; })}</div>
      : <p className={inventoryStyles.collectionUnavailable}>Canonical collection inventory is currently unavailable.</p>}
    {inventory && "items" in inventory && inventory.nextCursor ? <nav className={inventoryStyles.pagination} aria-label="Collection pages"><Link href={`/nft/${projectId}?afterTokenId=${inventory.nextCursor}`}>Next 24 →</Link></nav> : null}
  </section>;
}

async function OnchainIntelligence({ projectId }: { projectId: string }) {
  const result = await readOnchainForRequest(projectId);
  const onchain = result && "sourceStatus" in result ? result : null;
  return <><div><span>COLLECTION INTELLIGENCE</span><strong>{onchain?.recentActivity.length ?? "—"}</strong><small>BOUNDED ONCHAIN EVENT HISTORY</small></div></>;
}
async function MarketplaceIntelligence({ projectId }: { projectId: string }) {
  const result = await readMarketplaceForRequest(projectId);
  const marketplace = result && "provider" in result && ["AVAILABLE", "PARTIAL"].includes(result.availability) ? result : null;
  return <div><span>MARKETPLACE SIGNAL</span><strong>{marketplace?.recentProviderSales.length ?? "—"}</strong><small>BOUNDED RECENT OPENSEA REPORTS · NOT A 24H TOTAL</small></div>;
}
async function OnchainLedger({ projectId }: { projectId: string }) {
  const result = await readOnchainForRequest(projectId);
  const onchain = result && "sourceStatus" in result ? result : null;
  return <section className={styles.panel}><div className={styles.panelHead}><div><p>CANONICAL CHAIN EVIDENCE</p><h3>Recent project activity</h3></div><span>{onchain?.availability ?? "UNAVAILABLE"}</span></div>{onchain?.recentActivity.length ? <ol className={styles.feed}>{onchain.recentActivity.map((event) => <li key={`${event.transactionHash}:${event.logIndex}:${event.movementIndex}`}><div><b className={styles[event.kind.toLowerCase()]}>{event.kind}</b><span>Token #{event.tokenId} · amount {event.amount}</span></div><p>{short(event.from)} → {short(event.to)}</p><small>Block {event.blockNumber} · {short(event.transactionHash)} · unwindowed event history · market meaning not established</small></li>)}</ol> : <p className={styles.empty}>Canonical recent activity is currently unavailable.</p>}</section>;
}
async function MarketplaceLedger({ projectId }: { projectId: string }) {
  const result = await readMarketplaceForRequest(projectId);
  const marketplace = result && "provider" in result && ["AVAILABLE", "PARTIAL"].includes(result.availability) ? result : null;
  return <section className={styles.panel}><div className={styles.panelHead}><div><p>PROVIDER MARKETPLACE EVIDENCE</p><h3>Recent OpenSea reported sales</h3></div><span>{marketplace?.availability ?? "UNAVAILABLE"}</span></div>{marketplace?.recentProviderSales.length ? <ol className={styles.feed}>{marketplace.recentProviderSales.map((sale, index) => <li key={`${sale.orderHash ?? sale.transactionHash ?? sale.eventTimestamp}:${index}`}><div><b className={styles.sale}>OPENSEA REPORTED SALE</b><span>Token #{sale.tokenId} · quantity {sale.quantity}</span></div><p>{sale.paymentAsset && sale.grossAmount ? `${amount(sale.grossAmount, sale.paymentAsset.decimals)} ${sale.paymentAsset.symbol}` : "Payment evidence unavailable"}</p><small>{new Date(sale.eventTimestamp).toISOString()} · provider report · Seaport settlement not verified</small></li>)}</ol> : <p className={styles.empty}>No current provider-reported sale history is available.</p>}</section>;
}

export default async function NftProjectMarketPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ afterTokenId?: string }> }) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const identity = readRmtNftProjectIdentity(projectId);
  if (!identity) notFound();
  const afterTokenId = typeof query.afterTokenId === "string" && /^(0|[1-9]\d*)$/.test(query.afterTokenId) ? query.afterTokenId : undefined;
  const collection = identity.project.collections[0]!;
  const openSea = identity.project.links.find((link) => link.label === "OpenSea collection");
  return <main className={styles.page} data-nft-project-known-identity>
    <nav className={inventoryStyles.breadcrumb} aria-label="NFT Terminal breadcrumb"><Link href="/nft">← NFTs</Link></nav>
    <header className={styles.hero} data-nft-project-identity-rail><div><p className={styles.eyebrow}>PROJECT MARKET</p><h1>{identity.project.displayName}</h1><p className={styles.identity}>{collection.standard} · Robinhood Chain · 4663</p></div><div className={styles.projectAuthority}><span className={styles.curated}>RMT CURATED</span>{openSea ? <a href={openSea.url} target="_blank" rel="noreferrer">OpenSea ↗</a> : null}</div><a className={styles.contract} href={`${robinhoodChain.blockExplorers.default.url}/address/${collection.contractAddress}`} target="_blank" rel="noreferrer">{collection.contractAddress}</a></header>
    <nav className={styles.marketViews} aria-label="Collection market views"><a href="#items">Items</a><a href="#activity">Activity</a><a href="#holders">Holders</a><a href="#intelligence">Intelligence</a></nav>
    <section className={styles.metrics} id="holders" data-nft-market-tape aria-label={`${identity.project.displayName} project market metrics`}>
      <Suspense fallback={<><article><span>NATIVE FLOOR</span><strong>—</strong><small>Marketplace loading</small></article><article><span>24H VOLUME</span><strong>—</strong><small>Marketplace loading</small></article><article><span>RECENT REPORTS</span><strong>—</strong><small>Marketplace loading</small></article></>}><MarketplaceMetrics projectId={projectId} /></Suspense>
      <Suspense fallback={<><article><span>HOLDERS</span><strong>—</strong><small>Ownership loading</small></article><article><span>SUPPLY</span><strong>—</strong><small>Ownership loading</small></article></>}><OwnershipMetrics projectId={projectId} /></Suspense>
    </section>
    <Suspense fallback={<section className={styles.collectionSpotlight}><div className={styles.collectionHeroCopy}><span>COLLECTION SPOTLIGHT</span><h2>Canonical art is loading.</h2></div></section>}><CollectionSpotlight projectId={projectId} displayName={identity.project.displayName} /></Suspense>
    <Suspense fallback={<section className={inventoryStyles.collection} id="items" data-nft-gallery><p className={inventoryStyles.collectionUnavailable}>Canonical inventory is loading.</p></section>}><InventoryGallery projectId={projectId} displayName={identity.project.displayName} afterTokenId={afterTokenId} /></Suspense>
    <section className={styles.activityPulse} id="intelligence" aria-label="Collection intelligence"><Suspense fallback={<div><span>COLLECTION INTELLIGENCE</span><strong>—</strong><small>OWNERSHIP LOADING</small></div>}><OnchainIntelligence projectId={projectId} /></Suspense><Suspense fallback={<div><span>MARKETPLACE SIGNAL</span><strong>—</strong><small>MARKETPLACE LOADING</small></div>}><MarketplaceIntelligence projectId={projectId} /></Suspense><p>Chain activity and marketplace reports are intentionally kept as separate authorities. RMT shows both without turning provider claims into onchain facts.</p></section>
    <section className={styles.ledger} id="activity" data-nft-evidence-ledger aria-labelledby="evidence-ledger-heading"><header className={styles.ledgerHead}><p>LIVE EVIDENCE LEDGER</p><h2 id="evidence-ledger-heading">What&apos;s happening now</h2><span>Onchain movement × marketplace signal</span></header><div className={styles.columns}><Suspense fallback={<section className={styles.panel}><p className={styles.empty}>Loading canonical chain evidence.</p></section>}><OnchainLedger projectId={projectId} /></Suspense><Suspense fallback={<section className={styles.panel}><p className={styles.empty}>Loading marketplace evidence.</p></section>}><MarketplaceLedger projectId={projectId} /></Suspense></div></section>
    <section className={styles.marketplace}><div><p>MARKETPLACE</p><h2>OpenSea · Seaport 1.6</h2><span>Order identity verification and provider evidence remain separate from execution authorization.</span></div>{openSea ? <a href={openSea.url} target="_blank" rel="noreferrer">View on OpenSea ↗</a> : null}</section>
  </main>;
}
