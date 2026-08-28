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

  return <main className={styles.page}>
    <nav className={inventoryStyles.breadcrumb} aria-label="NFT Terminal breadcrumb"><Link href="/nft">← NFTs</Link></nav>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>PROJECT MARKET</p><h1>{model.project.displayName}</h1><p className={styles.identity}>{collection.standard} · Robinhood Chain · 4663</p></div>
      <div className={styles.projectAuthority}><span className={styles.curated}>RMT CURATED</span>{openSea ? <a href={openSea.url} target="_blank" rel="noreferrer">OpenSea ↗</a> : null}</div>
      <a className={styles.contract} href={`${robinhoodChain.blockExplorers.default.url}/address/${collection.contractAddress}`} target="_blank" rel="noreferrer">{collection.contractAddress}</a>
    </header>

    <section className={styles.metrics} aria-label={`${model.project.displayName} project market metrics`}>
      <article><span>HOLDERS</span><strong>{onchain?.holderCount ?? "Data unavailable"}</strong><small>{onchain?.completeness === "COMPLETE" ? "Canonical current ownership" : "Awaiting complete canonical history"}</small></article>
      <article><span>NFTS IN CIRCULATION</span><strong>{onchain?.circulatingTokenCount ?? "Data unavailable"}</strong><small>Current ERC721 ownership rows, not totalSupply</small></article>
      <article><span>LOWEST OPENSEA LISTING</span><strong>{listing ? `${amount(listing.grossAmount, listing.paymentAsset.decimals)} ${listing.paymentAsset.symbol}` : "Data unavailable"}</strong><small>{listing ? "Fresh normalized OpenSea evidence · not execution verified" : marketplace?.availabilityReason === "STALE" ? "Fresh exact-order evidence unavailable" : "No current qualifying evidence"}</small></article>
      <article><span>OPENSEA REPORTED 24H VOLUME</span><strong>{marketplace?.volume24hByPaymentAsset.length ? marketplace.volume24hByPaymentAsset.map((entry) => `${amount(entry.grossAmount, entry.paymentAsset.decimals)} ${entry.paymentAsset.symbol}`).join(" · ") : "Data unavailable"}</strong><small>Grouped by exact payment asset · settlement not verified</small></article>
    </section>

    <section className={inventoryStyles.collection} aria-labelledby="collection-heading">
      <div className={inventoryStyles.collectionHead}><div><p>CANONICAL ONCHAIN INVENTORY</p><h2 id="collection-heading">Collection</h2><span>Current ERC721 ownership · metadata from onchain tokenURI</span></div>
        {afterTokenId ? <Link href={`/nft/${model.project.projectId}`}>Back to start</Link> : null}
      </div>
      {inventory && "items" in inventory && inventory.availability === "AVAILABLE" && inventory.items.length > 0
        ? <div className={inventoryStyles.itemGrid}>{inventory.items.map((item) => <Link className={inventoryStyles.itemCard} href={`/nft/${model.project.projectId}/${item.tokenId}`} key={item.tokenId}>
            <NftItemMedia metadata={item.metadata} alt={`${model.project.displayName} token ${item.tokenId}`} className={inventoryStyles.cardMedia} />
            <div><strong>#{item.tokenId}</strong><span>{short(item.owner)}</span></div>
            <small>{item.metadata.status === "READY" ? "ONCHAIN" : "METADATA UNAVAILABLE"}</small>
          </Link>)}</div>
        : <p className={inventoryStyles.collectionUnavailable}>Canonical collection inventory is currently unavailable.</p>}
      {inventory && "items" in inventory && inventory.nextCursor
        ? <nav className={inventoryStyles.pagination} aria-label="Collection pages"><Link href={`/nft/${model.project.projectId}?afterTokenId=${inventory.nextCursor}`}>Next 24 →</Link></nav>
        : null}
    </section>

    <div className={styles.columns}>
      <section className={styles.panel}><div className={styles.panelHead}><div><p>CANONICAL CHAIN EVIDENCE</p><h2>Recent project activity</h2></div><span>{onchain?.availability ?? "UNAVAILABLE"}</span></div>
        {onchain?.recentActivity.length ? <ol className={styles.feed}>{onchain.recentActivity.map((event) => <li key={`${event.transactionHash}:${event.logIndex}:${event.movementIndex}`}><div><b className={styles[event.kind.toLowerCase()]}>{event.kind}</b><span>Token #{event.tokenId} · amount {event.amount}</span></div><p>{short(event.from)} → {short(event.to)}</p><small>Block {event.blockNumber} · {short(event.transactionHash)} · market meaning not established</small></li>)}</ol> : <p className={styles.empty}>Canonical recent activity is currently unavailable.</p>}
      </section>

      <section className={styles.panel}><div className={styles.panelHead}><div><p>PROVIDER MARKETPLACE EVIDENCE</p><h2>Recent OpenSea reported sales</h2></div><span>{marketplace?.availability ?? "UNAVAILABLE"}</span></div>
        {marketplace?.recentProviderSales.length ? <ol className={styles.feed}>{marketplace.recentProviderSales.map((sale, index) => <li key={`${sale.orderHash ?? sale.transactionHash ?? sale.eventTimestamp}:${index}`}><div><b className={styles.sale}>OPENSEA REPORTED SALE</b><span>Token #{sale.tokenId} · quantity {sale.quantity}</span></div><p>{sale.paymentAsset && sale.grossAmount ? `${amount(sale.grossAmount, sale.paymentAsset.decimals)} ${sale.paymentAsset.symbol}` : "Payment evidence unavailable"}</p><small>Provider report · Seaport settlement not verified</small></li>)}</ol> : <p className={styles.empty}>No recent provider-reported sales are available.</p>}
      </section>
    </div>

    <section className={styles.marketplace}><div><p>MARKETPLACE</p><h2>OpenSea · Seaport 1.6</h2><span>Order identity verification and provider evidence remain separate from execution authorization.</span></div>{openSea ? <a href={openSea.url} target="_blank" rel="noreferrer">View on OpenSea ↗</a> : null}</section>
  </main>;
}
