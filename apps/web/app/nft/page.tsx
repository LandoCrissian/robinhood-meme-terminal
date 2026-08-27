import type { Metadata } from "next";
import Link from "next/link";
import { formatUnits } from "viem";
import {
  readRmtNftTerminalCatalog,
  type RmtNftTerminalCatalogView,
  type RmtNftTerminalProjectCard,
} from "../../lib/server/nft-terminal-catalog";
import { NftItemMedia } from "./_components/nft-item-media";
import styles from "./nft-terminal.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RMT NFT Terminal | Robinhood Chain",
  description: "RMT-curated NFT Project Markets on Robinhood Chain, with canonical ownership, collection activity, and marketplace evidence.",
  alternates: { canonical: "/nft" },
};

const views: readonly { value: RmtNftTerminalCatalogView; label: string; href: string }[] = [
  { value: "active", label: "ACTIVE", href: "/nft" },
  { value: "recent", label: "RECENTLY ADDED", href: "/nft?view=recent" },
  { value: "collections", label: "COLLECTIONS", href: "/nft?view=collections" },
];

function selectedView(value: string | string[] | undefined): RmtNftTerminalCatalogView {
  return value === "recent" || value === "collections" ? value : "active";
}

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function amount(value: string, decimals: number) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = formatted.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "") : whole;
}

function ProjectCard({ project }: { project: RmtNftTerminalProjectCard }) {
  const readModel = project.market && "project" in project.market ? project.market : null;
  const onchain = readModel && "sourceStatus" in readModel.onchain ? readModel.onchain : null;
  const marketplace = readModel && "provider" in readModel.marketplace ? readModel.marketplace : null;
  const listing = marketplace?.lowestNormalizedListing ?? null;
  const inventory = project.inventoryPreview && "items" in project.inventoryPreview
    && project.inventoryPreview.availability === "AVAILABLE" ? project.inventoryPreview.items : [];
  const collection = project.collections[0]!;

  return <article className={styles.projectCard} aria-label={`${project.displayName} RMT-curated NFT project`}>
    <div className={styles.cardIdentity}>
      <span className={styles.curated}>RMT CURATED</span>
      <p>Robinhood Chain · {collection.standard ?? "Standard unavailable"}</p>
      <h2><Link href={`/nft/${project.projectId}`}>{project.displayName}</Link></h2>
      <code title={collection.contractAddress}>{short(collection.contractAddress)}</code>
    </div>

    <div className={styles.preview} aria-label={`${project.displayName} canonical inventory preview`}>
      {inventory.length > 0 ? inventory.map((item) => <Link href={`/nft/${project.projectId}/${item.tokenId}`} key={item.tokenId} aria-label={`View ${project.displayName} token ${item.tokenId}`}>
        <NftItemMedia metadata={item.metadata} alt={`${project.displayName} token ${item.tokenId}`} className={styles.previewImage} />
        <span>#{item.tokenId}</span>
      </Link>) : <div className={styles.previewUnavailable}>Canonical inventory preview unavailable</div>}
    </div>

    <dl className={styles.metrics}>
      <div><dt>Holders</dt><dd>{onchain?.holderCount ?? "Data unavailable"}</dd></div>
      <div><dt>NFTs in circulation</dt><dd>{onchain?.circulatingTokenCount ?? "Data unavailable"}</dd></div>
      <div><dt>Lowest OpenSea listing</dt><dd>{listing ? `${amount(listing.grossAmount, listing.paymentAsset.decimals)} ${listing.paymentAsset.symbol}` : "Data unavailable"}</dd></div>
      <div><dt>OpenSea reported 24h volume</dt><dd>{marketplace?.volume24hByPaymentAsset.length
        ? marketplace.volume24hByPaymentAsset.map((entry) => `${amount(entry.grossAmount, entry.paymentAsset.decimals)} ${entry.paymentAsset.symbol}`).join(" · ")
        : "Data unavailable"}</dd></div>
    </dl>
    <Link className={styles.openProject} href={`/nft/${project.projectId}`}>Open Project Market <span aria-hidden="true">→</span></Link>
  </article>;
}

export default async function NftTerminalCatalogPage({ searchParams }: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const query = await searchParams;
  const view = selectedView(query.view);
  const catalog = await readRmtNftTerminalCatalog(view);

  return <main className={styles.page}>
    <header className={styles.hero}>
      <p>RMT NFT TERMINAL</p>
      <h1>Project Markets on Robinhood Chain</h1>
      <span>Discover RMT-curated NFT projects using canonical ownership, collection activity, and marketplace evidence.</span>
    </header>

    <nav className={styles.views} aria-label="NFT catalog views">
      {views.map((item) => <Link href={item.href} key={item.value} aria-current={view === item.value ? "page" : undefined}>{item.label}</Link>)}
    </nav>

    {view === "collections" ? <section className={styles.collectionList} aria-label="Active RMT NFT collections">
      {catalog.collections.map((collection) => <article key={`${collection.projectId}:${collection.contractAddress}`}>
        <div><span>RMT CURATED COLLECTION</span><h2><Link href={`/nft/${collection.projectId}`}>{collection.displayName}</Link></h2></div>
        <p>Robinhood Chain · {collection.standard ?? "Standard unavailable"}</p>
        <code>{collection.contractAddress}</code>
        <small>Registry verification: {collection.verificationStatus}</small>
      </article>)}
    </section> : <section className={styles.projectGrid} aria-label={`${view === "recent" ? "Recently added" : "Active"} RMT NFT projects`}>
      {catalog.projects.map((project) => <ProjectCard project={project} key={project.projectId} />)}
    </section>}
  </main>;
}
