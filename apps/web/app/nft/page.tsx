import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatEther, formatUnits } from "viem";
import {
  readRmtNftMintRadar,
  type RmtMintRadarCandidate,
  type RmtMintRadarFeedStatus,
} from "../../lib/server/nft-mint-radar";
import {
  readRmtNftTerminalCatalog,
  type RmtNftTerminalCatalogView,
  type RmtNftTerminalProjectCard,
} from "../../lib/server/nft-terminal-catalog";
import { NftItemMedia } from "./_components/nft-item-media";
import { NftMintExecutionRecovery } from "./_components/nft-mint-execution-recovery";
import { NftMintReadiness } from "./_components/nft-mint-readiness";
import styles from "./nft-terminal.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RMT NFT Terminal | Robinhood Chain",
  description: "RMT-curated NFT Project Markets on Robinhood Chain, with canonical ownership, collection activity, and marketplace evidence.",
  alternates: { canonical: "/nft" },
};

const views: readonly { value: RmtNftTerminalCatalogView; label: string; href: string }[] = [
  { value: "active", label: "Active", href: "/nft" },
  { value: "recent", label: "Recently Added", href: "/nft?view=recent" },
  { value: "collections", label: "Collections", href: "/nft?view=collections" },
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

function utcTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(value));
}

function nativePrice(value: string | null) {
  if (value === null) return "Price not reported";
  const [whole, fraction = ""] = formatEther(BigInt(value)).split(".");
  const boundedFraction = fraction.slice(0, 5).replace(/0+$/, "");
  return `${boundedFraction ? `${whole}.${boundedFraction}` : whole} ETH`;
}

function feedMessage(status: RmtMintRadarFeedStatus, asOf: string | null) {
  if (status === "UNAVAILABLE") return "Schedule evidence could not be established. Active RMT collections remain available.";
  if (status === "STALE") return `Last known schedule evidence · ${asOf ? utcTime(asOf) : "time unavailable"}`;
  if (status === "EMPTY") return "OpenSea returned no qualifying Robinhood Chain drops.";
  return "Robinhood Chain · OpenSea schedule evidence · Fresh ≤ 90 sec";
}

function RadarCard({ candidate }: { candidate: RmtMintRadarCandidate }) {
  const onchain = candidate.contractEvidence.status === "ONCHAIN_VERIFIED_CONTRACT";
  const activity = candidate.mintActivity.status === "ONCHAIN_MINT_ACTIVITY";
  const access = candidate.ccff00Access;
  const accessLabel = access.status === "VERIFIED_COMMUNITY_GATE" ? "#CCFF00 ACCESS · VERIFIED"
    : access.status === "HOLDER_MATCHES_DETECTED" ? `CCFF00 HOLDERS DETECTED · ${access.holderMatches.matchingHolderCount ?? 0}`
      : access.status === "PROVIDER_REPORTED" ? "CCFF00 ACCESS · REPORTED"
        : access.status === "CONNECTED_WALLET_ELIGIBLE" ? "CCFF00 ACCESS · ELIGIBLE"
          : null;
  return <article className={styles.radarCard} data-radar-candidate data-radar-state={candidate.state} data-radar-admission={candidate.rmtAdmission} data-radar-chain={candidate.chainId} data-ccff00-access={access.status}>
    <div className={styles.radarIdentity}>
      <span>{candidate.state === "LIVE_NOW" ? "LIVE NOW" : candidate.state === "UPCOMING" ? "UPCOMING" : "RECENTLY MINTED"}</span>
      <h3>{candidate.collectionName}</h3>
      <p>{candidate.stage?.label ?? "Stage not reported"} · {candidate.contractEvidence.standard}</p>
    </div>
    <dl className={styles.radarFacts}>
      <div><dt>{candidate.state === "RECENTLY_MINTED" ? "Observed stage" : "Starts"}</dt><dd>{candidate.stage ? utcTime(candidate.stage.startTime) : "Not reported"}</dd></div>
      <div><dt>Mint price</dt><dd>{nativePrice(candidate.stage?.nativePriceWei ?? null)}</dd></div>
    </dl>
    <div className={styles.radarEvidence} aria-label="Mint Radar evidence">
      <span>Schedule · OpenSea</span>
      {onchain ? <span>Contract · Onchain</span> : null}
      {activity ? <span>Mint Activity · Onchain</span> : null}
      {accessLabel ? <span className={styles.ccff00Access}>{accessLabel}</span> : null}
    </div>
    <div className={styles.radarFoot}>
      <code title={candidate.collectionAddress ?? undefined}>{candidate.collectionAddress ? short(candidate.collectionAddress) : "Contract not established"}</code>
      <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">OpenSea evidence</a>
    </div>
    {candidate.state === "LIVE_NOW" ? <NftMintReadiness candidateId={candidate.candidateId} /> : null}
    <small className={styles.discoveryOnly}>Detected · Not RMT admitted</small>
  </article>;
}

function RadarGroup({ title, candidates, className }: { title: string; candidates: readonly RmtMintRadarCandidate[]; className: string }) {
  return <section className={`${styles.radarGroup} ${className}`} aria-label={`${title} Robinhood Chain NFT mints`}>
    <header><h2>{title}</h2><span>{candidates.length}</span></header>
    {candidates.length > 0 ? <div className={styles.radarRail}>{candidates.map((candidate) => <RadarCard candidate={candidate} key={candidate.candidateId} />)}</div>
      : <p className={styles.radarEmpty}>No qualifying candidates in the latest established feed.</p>}
  </section>;
}

async function MintRadarSurface() {
  const radar = await readRmtNftMintRadar();
  return <>
    <section className={styles.radarHeading} data-nft-mint-radar data-radar-state={radar.status}>
      <div><span>DISCOVERY · NOT ADMISSION</span><h2>Mint Radar</h2></div>
      <p>{feedMessage(radar.status, radar.asOf)}</p>
    </section>
    <RadarGroup title="Live Now" candidates={radar.live} className={styles.liveRadar} />
    <RadarGroup title="Upcoming" candidates={radar.upcoming} className={styles.upcomingRadar} />
    <RadarGroup title="Recently Minted" candidates={radar.recent} className={styles.recentRadar} />
  </>;
}

function MintRadarFallback() {
  return <section className={styles.radarHeading} data-nft-mint-radar-loading>
    <div><span>DISCOVERY · NOT ADMISSION</span><h2>Mint Radar</h2></div>
    <p>Establishing bounded schedule evidence. Active RMT collections remain available.</p>
  </section>;
}

function ProjectCard({ project }: { project: RmtNftTerminalProjectCard }) {
  const readModel = project.market && "project" in project.market ? project.market : null;
  const onchain = readModel && "sourceStatus" in readModel.onchain ? readModel.onchain : null;
  const marketplace = readModel && "provider" in readModel.marketplace ? readModel.marketplace : null;
  const listing = marketplace?.lowestNormalizedListing ?? null;
  const inventory = project.inventoryPreview && "items" in project.inventoryPreview
    && project.inventoryPreview.availability === "AVAILABLE" ? project.inventoryPreview.items : [];
  const collection = project.collections[0]!;

  return <article className={styles.projectCard} data-nft-project-stage aria-label={`${project.displayName} RMT-curated NFT project`}>
    <div className={styles.cardIdentity}>
      <div className={styles.projectStatus}><span className={styles.curated}>RMT CURATED</span><i aria-hidden="true" /> ACTIVE</div>
      <h2><Link href={`/nft/${project.projectId}`}>{project.displayName}</Link></h2>
      <p>{collection.standard ?? "Standard unavailable"} · Robinhood Chain · 4663</p>
      <code title={collection.contractAddress}>{short(collection.contractAddress)}</code>
    </div>

    <div className={styles.artField}>
      <div className={styles.artFieldLabel}><span>CANONICAL ART</span><small>ONCHAIN INVENTORY</small></div>
      <div className={styles.preview} aria-label={`${project.displayName} canonical inventory preview`}>
        {inventory.length > 0 ? inventory.map((item) => <Link href={`/nft/${project.projectId}/${item.tokenId}`} key={item.tokenId} aria-label={`View ${project.displayName} token ${item.tokenId}`} data-rmt-registration-frame>
          <NftItemMedia metadata={item.metadata} alt={`${project.displayName} token ${item.tokenId}`} className={styles.previewImage} />
          <span>#{item.tokenId}</span>
        </Link>) : <div className={styles.previewUnavailable}><span>MEDIA</span><strong>UNAVAILABLE</strong><small>CANONICAL IDENTITY PRESERVED</small></div>}
      </div>
    </div>

    <div className={styles.marketSignal} data-nft-market-tape>
      <span>MARKET SIGNAL</span>
      <dl className={styles.metrics}>
        <div><dt>Holders</dt><dd>{onchain?.holderCount ?? "Data unavailable"}</dd></div>
        <div><dt>NFTs in circulation</dt><dd>{onchain?.circulatingTokenCount ?? "Data unavailable"}</dd></div>
        <div><dt>Lowest OpenSea listing</dt><dd>{listing ? `${amount(listing.grossAmount, listing.paymentAsset.decimals)} ${listing.paymentAsset.symbol}` : "Data unavailable"}</dd></div>
        <div><dt>OpenSea reported 24h volume</dt><dd>{marketplace?.volume24hByPaymentAsset.length
          ? marketplace.volume24hByPaymentAsset.map((entry) => `${amount(entry.grossAmount, entry.paymentAsset.decimals)} ${entry.paymentAsset.symbol}`).join(" · ")
          : "Data unavailable"}</dd></div>
      </dl>
    </div>
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
    <header className={styles.terminalHeading}>
      <div><h1>NFTs</h1><p>Robinhood Chain</p></div>
      <span><i aria-hidden="true" /> {catalog.projects.length} ACTIVE</span>
    </header>

    <nav className={styles.views} aria-label="NFT catalog views">
      {views.map((item) => <Link href={item.href} key={item.value} aria-current={view === item.value ? "page" : undefined}>{item.label}</Link>)}
    </nav>

    <p className={styles.scopeNote}>Discover Robinhood Chain mints, then enter RMT-curated Project Markets with canonical ownership and marketplace evidence.</p>

    <NftMintExecutionRecovery />

    {view === "active" ? <>
      <div className={styles.catalogFlow}>
        <Suspense fallback={<MintRadarFallback />}><MintRadarSurface /></Suspense>
        <section className={styles.activeCollections} aria-label="Active RMT NFT projects">
          <header className={styles.activeHeading}><div><span>RMT DIRECTORY</span><h2>Active Collections</h2></div><p>Admission is independent from Mint Radar discovery.</p></header>
          <div className={styles.projectGrid}>{catalog.projects.map((project) => <ProjectCard project={project} key={project.projectId} />)}</div>
        </section>
      </div>
    </> : view === "collections" ? <section className={styles.collectionList} aria-label="Active RMT NFT collections">
      {catalog.collections.map((collection) => <article key={`${collection.projectId}:${collection.contractAddress}`}>
        <div><span>RMT CURATED COLLECTION</span><h2><Link href={`/nft/${collection.projectId}`}>{collection.displayName}</Link></h2></div>
        <p>{collection.standard ?? "Standard unavailable"} · Robinhood Chain</p>
        <code>{collection.contractAddress}</code>
        <small>Registry verification: {collection.verificationStatus}</small>
      </article>)}
    </section> : <section className={styles.projectGrid} aria-label="Recently added RMT NFT projects">
      {catalog.projects.map((project) => <ProjectCard project={project} key={project.projectId} />)}
    </section>}
  </main>;
}
