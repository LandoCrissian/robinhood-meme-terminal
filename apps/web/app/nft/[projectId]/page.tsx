import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatUnits } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import Link from "next/link";
import { readRmtNftProjectInventory, readRmtNftProjectMarket } from "../../../lib/server/nft-project-market";
import { NftItemMedia } from "../_components/nft-item-media";
import styles from "./project-market.module.css";
import inventoryStyles from "./inventory.module.css";

export const dynamic = "force-dynamic";

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function amount(value: string, decimals: number) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = formatted.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "") : whole;
}

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }): Promise<Metadata> {
  const { projectId } = await params;
  return projectId.toLowerCase() === "ccff00"
    ? { title: "CCFF00 NFT Project Market | RMT", description: "RMT-curated CCFF00 NFT activity, ownership and OpenSea market evidence on Robinhood Chain." }
    : { robots: { index: false, follow: false } };
}

export default async function NftProjectMarketPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ afterTokenId?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const afterTokenId = typeof query.afterTokenId === "string" && /^(0|[1-9]\d*)$/.test(query.afterTokenId) ? query.afterTokenId : undefined;
  const [model, inventory] = await Promise.all([
    readRmtNftProjectMarket(projectId),
    readRmtNftProjectInventory(projectId, { afterTokenId, limit: 24 }),
  ]);
  if (!model) notFound();
  const collection = model.project.collections[0]!;
  const onchain = "sourceStatus" in model.onchain ? model.onchain : null;
  const marketplace = "provider" in model.marketplace ? model.marketplace : null;
  const listing = marketplace?.lowestNormalizedListing ?? null;
  const openSea = model.project.links.find((link) => link.label === "OpenSea collection");
  const featured = inventory && "items" in inventory && inventory.availability === "AVAILABLE" ? inventory.items.slice(0, 3) : [];

  return <main className={styles.page}>
    <nav className={inventoryStyles.breadcrumb} aria-label="NFT Terminal breadcrumb"><Link href="/nft">← NFTs</Link></nav>
    <header className={styles.hero} data-nft-project-identity-rail>
      <div><p className={styles.eyebrow}>PROJECT MARKET</p><h1>{model.project.displayName}</h1><p className={styles.identity}>{collection.standard} · Robinhood Chain · 4663</p></div>
      <div className={styles.projectAuthority}><span className={styles.curated}>RMT CURATED</span>{openSea ? <a href={openSea.url} target="_blank" rel="noreferrer">OpenSea ↗</a> : null}</div>
      <a className={styles.contract} href={`${robinhoodChain.blockExplorers.default.url}/address/${collection.contractAddress}`} target="_blank" rel="noreferrer">{collection.contractAddress}</a>
    </header>

    <nav className={styles.marketViews} aria-label="Collection market views">
      <a href="#items">Items</a>
      <a href="#activity">Activity</a>
      <a href="#holders">Holders</a>
      <a href="#intelligence">Intelligence</a>
    </nav>

    <section className={styles.metrics} id="holders" data-nft-market-tape aria-label={`${model.project.displayName} project market metrics`}>
      <article><span>FLOOR</span><strong>{listing ? `${amount(listing.grossAmount, listing.paymentAsset.decimals)} ${listing.paymentAsset.symbol}` : "—"}</strong><small>{listing ? "OpenSea provider evidence · not execution verified" : "Marketplace evidence unavailable"}</small></article>
      <article><span>24H VOLUME</span><strong>{marketplace?.volume24hByPaymentAsset.length ? marketplace.volume24hByPaymentAsset.map((entry) => `${amount(entry.grossAmount, entry.paymentAsset.decimals)} ${entry.paymentAsset.symbol}`).join(" · ") : "—"}</strong><small>Provider-reported · grouped by exact payment asset</small></article>
      <article><span>24H SALES</span><strong>{marketplace ? marketplace.recentProviderSales.length : "—"}</strong><small>{marketplace ? "Recent provider reports" : "Marketplace evidence unavailable"}</small></article>
      <article><span>HOLDERS</span><strong>{onchain?.holderCount ?? "—"}</strong><small>{onchain?.completeness === "COMPLETE" ? "Canonical current ownership" : onchain?.sourceStatus === "BACKFILLING" ? "Ownership backfilling" : "Ownership unavailable"}</small></article>
      <article><span>SUPPLY</span><strong>{onchain?.circulatingTokenCount ?? "—"}</strong><small>Current canonical ownership rows</small></article>
    </section>

    <section className={styles.collectionSpotlight} aria-label={`${model.project.displayName} collection spotlight`}>
      <div className={styles.collectionHeroCopy}>
        <span>COLLECTION SPOTLIGHT</span>
        <h2>Canonical art. Current ownership.</h2>
        <p>Onchain tokenURI inventory and ownership remain canonical. Marketplace evidence is shown separately.</p>
      </div>
      <div className={styles.heroArt}>
        {featured.length ? featured.map((item, index) => <Link href={`/nft/${model.project.projectId}/${item.tokenId}`} key={item.tokenId} className={styles[`heroArt${index + 1}`]}>
          <NftItemMedia metadata={item.metadata} alt={`${model.project.displayName} token ${item.tokenId}`} className={styles.heroArtMedia} />
          <span>#{item.tokenId}</span>
        </Link>) : <div className={styles.heroArtUnavailable}>CANONICAL ART<br/>AWAITING INDEXER</div>}
      </div>
    </section>

    <section className={inventoryStyles.collection} id="items" data-nft-gallery aria-labelledby="collection-heading">
      <div className={inventoryStyles.collectionHead}><div><p>CANONICAL ONCHAIN INVENTORY</p><h2 id="collection-heading">Collection</h2><span>Current ERC721 ownership · metadata from onchain tokenURI</span></div>
        {afterTokenId ? <Link href={`/nft/${model.project.projectId}`}>Back to start</Link> : null}
      </div>
      {inventory && "items" in inventory && inventory.availability === "AVAILABLE" && inventory.items.length > 0
        ? <div className={inventoryStyles.itemGrid}>{inventory.items.map((item) => {
            const color = item.metadata.attributes.find((candidate) => candidate.traitType === "Color");
            return <Link className={inventoryStyles.itemCard} href={`/nft/${model.project.projectId}/${item.tokenId}`} key={item.tokenId}>
              <NftItemMedia metadata={item.metadata} alt={`${model.project.displayName} token ${item.tokenId}`} className={inventoryStyles.cardMedia} />
              <div className={inventoryStyles.cardIdentity}><strong>#{item.tokenId}</strong><span>{color?.value ?? "CCFF00"}</span></div>
              <div className={inventoryStyles.cardOwner}><span>OWNER</span><code>{short(item.owner)}</code></div>
              <small>{item.metadata.status === "READY" ? "● ONCHAIN" : "METADATA UNAVAILABLE"}</small>
            </Link>;
          })}</div>
        : <p className={inventoryStyles.collectionUnavailable}>Canonical collection inventory is currently unavailable.</p>}
      {inventory && "items" in inventory && inventory.nextCursor
        ? <nav className={inventoryStyles.pagination} aria-label="Collection pages"><Link href={`/nft/${model.project.projectId}?afterTokenId=${inventory.nextCursor}`}>Next 24 →</Link></nav>
        : null}
    </section>

    <section className={styles.activityPulse} id="intelligence" aria-label="Collection intelligence">
      <div><span>COLLECTION INTELLIGENCE</span><strong>{onchain?.recentActivity.length ?? 0}</strong><small>RECENT ONCHAIN EVENTS</small></div>
      <div><span>MARKETPLACE SIGNAL</span><strong>{marketplace?.recentProviderSales.length ?? 0}</strong><small>RECENT OPENSEA REPORTS</small></div>
      <p>Chain activity and marketplace reports are intentionally kept as separate authorities. RMT shows both without turning provider claims into onchain facts.</p>
    </section>

    <section className={styles.ledger} id="activity" data-nft-evidence-ledger aria-labelledby="evidence-ledger-heading">
      <header className={styles.ledgerHead}><p>LIVE EVIDENCE LEDGER</p><h2 id="evidence-ledger-heading">What&apos;s happening now</h2><span>Onchain movement × marketplace signal</span></header>
      <div className={styles.columns}>
        <section className={styles.panel}><div className={styles.panelHead}><div><p>CANONICAL CHAIN EVIDENCE</p><h3>Recent project activity</h3></div><span>{onchain?.availability ?? "UNAVAILABLE"}</span></div>
          {onchain?.recentActivity.length ? <ol className={styles.feed}>{onchain.recentActivity.map((event) => <li key={`${event.transactionHash}:${event.logIndex}:${event.movementIndex}`}><div><b className={styles[event.kind.toLowerCase()]}>{event.kind}</b><span>Token #{event.tokenId} · amount {event.amount}</span></div><p>{short(event.from)} → {short(event.to)}</p><small>Block {event.blockNumber} · {short(event.transactionHash)} · market meaning not established</small></li>)}</ol> : <p className={styles.empty}>Canonical recent activity is currently unavailable.</p>}
        </section>

        <section className={styles.panel}><div className={styles.panelHead}><div><p>PROVIDER MARKETPLACE EVIDENCE</p><h3>Recent OpenSea reported sales</h3></div><span>{marketplace?.availability ?? "UNAVAILABLE"}</span></div>
          {marketplace?.recentProviderSales.length ? <ol className={styles.feed}>{marketplace.recentProviderSales.map((sale, index) => <li key={`${sale.orderHash ?? sale.transactionHash ?? sale.eventTimestamp}:${index}`}><div><b className={styles.sale}>OPENSEA REPORTED SALE</b><span>Token #{sale.tokenId} · quantity {sale.quantity}</span></div><p>{sale.paymentAsset && sale.grossAmount ? `${amount(sale.grossAmount, sale.paymentAsset.decimals)} ${sale.paymentAsset.symbol}` : "Payment evidence unavailable"}</p><small>Provider report · Seaport settlement not verified</small></li>)}</ol> : <p className={styles.empty}>No recent provider-reported sales are available.</p>}
        </section>
      </div>
    </section>

    <section className={styles.marketplace}><div><p>MARKETPLACE</p><h2>OpenSea · Seaport 1.6</h2><span>Order identity verification and provider evidence remain separate from execution authorization.</span></div>{openSea ? <a href={openSea.url} target="_blank" rel="noreferrer">View on OpenSea ↗</a> : null}</section>
  </main>;
}
