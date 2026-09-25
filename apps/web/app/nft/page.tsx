import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense } from "react";
import { formatEther, formatUnits } from "viem";
import {
  readRmtNftMintRadar,
  type RmtMintRadarCandidate,
  type RmtMintRadarResponse,
} from "../../lib/server/nft-mint-radar";
import {
  readRmtNftTerminalCatalog,
  type RmtNftTerminalCatalog,
  type RmtNftTerminalCatalogView,
  type RmtNftTerminalCollectionCard,
  type RmtNftTerminalProjectCard,
} from "../../lib/server/nft-terminal-catalog";
import { NftItemMedia } from "./_components/nft-item-media";
import { NftMintExecutionRecovery } from "./_components/nft-mint-execution-recovery";
import { NftMintReadiness } from "./_components/nft-mint-readiness";
import styles from "./nft-terminal.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RMT NFT Markets | Robinhood Chain",
  description: "Compact Robinhood Chain NFT markets with canonical ownership, mint schedules, and separately attributed marketplace evidence.",
  alternates: { canonical: "/nft" },
};

const readMintRadarForRequest = cache(readRmtNftMintRadar);

const views: readonly { value: RmtNftTerminalCatalogView; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "new", label: "New" },
  { value: "minting", label: "Minting" },
  { value: "trending", label: "Trending" },
  { value: "watching", label: "Watching" },
];

function selectedView(value: string | string[] | undefined): RmtNftTerminalCatalogView {
  return typeof value === "string" && views.some((view) => view.value === value)
    ? value as RmtNftTerminalCatalogView
    : "active";
}

function boundedSearch(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) : "";
}

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function amount(value: string, decimals: number) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = formatted.split(".");
  return fraction ? `${whole}.${fraction.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "") : whole;
}

function nativePrice(value: string | null) {
  if (value === null) return "—";
  const [whole, fraction = ""] = formatEther(BigInt(value)).split(".");
  const boundedFraction = fraction.slice(0, 5).replace(/0+$/, "");
  return `${boundedFraction ? `${whole}.${boundedFraction}` : whole} ETH`;
}

function verifiedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function utcTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(value));
}

function projectReadModel(project: RmtNftTerminalProjectCard | undefined) {
  return project?.market && "project" in project.market ? project.market : null;
}

function isTrendingProject(project: RmtNftTerminalProjectCard) {
  const model = projectReadModel(project);
  const onchain = model && "sourceStatus" in model.onchain ? model.onchain : null;
  const marketplace = model && "provider" in model.marketplace ? model.marketplace : null;
  return Boolean(onchain?.recentActivity.length
    || marketplace?.recentProviderSales.length
    || marketplace?.volume24hByPaymentAsset.some((entry) => BigInt(entry.grossAmount) > 0n));
}

function viewHref(view: RmtNftTerminalCatalogView) {
  return view === "active" ? "/nft" : `/nft?view=${view}`;
}

async function MintingTabCount() {
  const radar = await readMintRadarForRequest();
  if (radar.status !== "READY" && radar.status !== "STALE") return null;
  return <span>{radar.live.length}</span>;
}

function CatalogTabs({ catalog, view }: { catalog: RmtNftTerminalCatalog; view: RmtNftTerminalCatalogView }) {
  const counts: Partial<Record<RmtNftTerminalCatalogView, number>> = {
    active: catalog.projects.length,
    new: catalog.newCollections.length,
    trending: catalog.projects.filter(isTrendingProject).length,
    watching: catalog.watchingCollections.length,
  };
  return <nav className={styles.views} aria-label="NFT market views">
    {views.map((item) => <Link href={viewHref(item.value)} key={item.value} aria-current={view === item.value ? "page" : undefined}>
      <strong>{item.label}</strong>
      {item.value === "minting" && view === "minting"
        ? <Suspense fallback={null}><MintingTabCount /></Suspense>
        : item.value !== "minting" ? <span>{counts[item.value]}</span> : null}
    </Link>)}
  </nav>;
}

function collectionMatches(collection: RmtNftTerminalCollectionCard, query: string) {
  const normalized = query.toLowerCase();
  return collection.displayName.toLowerCase().includes(normalized)
    || collection.projectId.includes(normalized)
    || collection.contractAddress.toLowerCase().includes(normalized);
}

function CollectionRow({ collection, project }: {
  collection: RmtNftTerminalCollectionCard;
  project?: RmtNftTerminalProjectCard;
}) {
  const model = projectReadModel(project);
  const onchain = model && "sourceStatus" in model.onchain ? model.onchain : null;
  const marketplace = model && "provider" in model.marketplace ? model.marketplace : null;
  const listing = marketplace?.lowestNormalizedListing ?? null;
  const inventory = project?.inventoryPreview && "items" in project.inventoryPreview ? project.inventoryPreview : null;
  const artwork = inventory?.availability === "AVAILABLE" ? inventory.items[0] : null;
  const ownershipState = onchain?.sourceStatus === "SYNCED" ? "AVAILABLE"
    : onchain?.sourceStatus === "BACKFILLING" || inventory?.availability === "PARTIAL" ? "BACKFILLING" : "UNAVAILABLE";
  const status = collection.projectStatus === "ACTIVE" ? "RMT Active" : "Watching";
  const volume = marketplace?.volume24hByPaymentAsset.length
    ? marketplace.volume24hByPaymentAsset.map((entry) => `${amount(entry.grossAmount, entry.paymentAsset.decimals)} ${entry.paymentAsset.symbol}`).join(" · ")
    : "—";
  const row = <article className={styles.collectionRow} data-nft-collection-row data-nft-collection-status={collection.projectStatus} data-ownership-state={ownershipState}>
    <div className={styles.collectionAvatar} data-rmt-registration-frame>
      {artwork ? <NftItemMedia metadata={artwork.metadata} alt={`${collection.displayName} canonical collection artwork`} className={styles.collectionAvatarMedia} />
        : <span aria-label="Canonical artwork unavailable">◇</span>}
    </div>
    <div className={styles.collectionMain}>
      <div className={styles.collectionName}><h2>{collection.displayName}</h2><span className={collection.projectStatus === "ACTIVE" ? styles.activeChip : styles.watchingChip}>{status}</span></div>
      <p>{collection.standard ?? "Standard unavailable"} · {collection.projectStatus === "ACTIVE" ? "Robinhood Chain" : "Discovery only"}</p>
      <div className={styles.collectionEvidence}>
        {onchain?.holderCount !== null && onchain?.holderCount !== undefined ? <span>{onchain.holderCount} holders</span> : null}
        {onchain?.circulatingTokenCount !== null && onchain?.circulatingTokenCount !== undefined ? <span>{onchain.circulatingTokenCount} NFTs</span> : null}
        {ownershipState === "BACKFILLING" ? <span>Ownership backfilling</span> : null}
        {ownershipState === "UNAVAILABLE" ? <span>Ownership unavailable</span> : null}
        <span>Verified {verifiedDate(collection.verifiedAt)}</span>
      </div>
      <code title={collection.contractAddress}>{short(collection.contractAddress)}</code>
    </div>
    <dl className={styles.collectionMetrics}>
      <div><dt>Floor</dt><dd>{listing ? `${amount(listing.grossAmount, listing.paymentAsset.decimals)} ${listing.paymentAsset.symbol}` : "—"}</dd></div>
      <div><dt>24h volume</dt><dd>{volume}</dd></div>
    </dl>
    <span className={styles.rowAction}>{collection.projectStatus === "ACTIVE" ? "Open market →" : "Watching"}</span>
  </article>;
  return collection.projectStatus === "ACTIVE"
    ? <Link className={styles.collectionRowLink} href={`/nft/${collection.projectId}`}>{row}</Link>
    : <div className={styles.collectionRowLink}>{row}</div>;
}

function CompactEmpty({ title, detail }: { title: string; detail?: string }) {
  return <section className={styles.compactEmpty} data-nft-empty-state><strong>{title}</strong>{detail ? <span>{detail}</span> : null}</section>;
}

function CollectionRows({ collections, catalog, empty }: {
  collections: readonly RmtNftTerminalCollectionCard[];
  catalog: RmtNftTerminalCatalog;
  empty: string;
}) {
  return collections.length > 0 ? <div className={styles.collectionRows}>
    {collections.map((collection) => <CollectionRow
      collection={collection}
      project={catalog.projects.find((project) => project.projectId === collection.projectId)}
      key={`${collection.projectId}:${collection.contractAddress}`}
    />)}
  </div> : <CompactEmpty title={empty} />;
}

function RadarRow({ candidate }: { candidate: RmtMintRadarCandidate }) {
  const access = candidate.ccff00Access;
  const accessLabel = access.status === "VERIFIED_COMMUNITY_GATE" ? "#CCFF00 ACCESS · VERIFIED"
    : access.status === "HOLDER_MATCHES_DETECTED" ? `CCFF00 HOLDERS DETECTED · ${access.holderMatches.matchingHolderCount ?? 0}`
      : access.status === "PROVIDER_REPORTED" ? "CCFF00 ACCESS · REPORTED"
        : access.status === "CONNECTED_WALLET_ELIGIBLE" ? "CCFF00 ACCESS · ELIGIBLE"
          : null;
  return <article className={styles.mintRow} data-radar-candidate data-radar-state={candidate.state} data-radar-admission={candidate.rmtAdmission} data-radar-chain={candidate.chainId} data-ccff00-access={access.status}>
    <div className={styles.mintAvatar} aria-hidden="true">◇</div>
    <div className={styles.collectionMain}>
      <div className={styles.collectionName}><h2>{candidate.collectionName}</h2><span className={styles.mintingChip}>Minting</span></div>
      <p>{candidate.stage?.label ?? "Verified stage"} · {candidate.contractEvidence.standard}</p>
      <div className={styles.collectionEvidence}>
        <span>{candidate.stage ? `Ends ${utcTime(candidate.stage.endTime)}` : "Schedule verified"}</span>
        {accessLabel ? <span className={styles.ccff00Access}>{accessLabel}</span> : null}
      </div>
      <code title={candidate.collectionAddress ?? undefined}>{candidate.collectionAddress ? short(candidate.collectionAddress) : "Contract not established"}</code>
    </div>
    <dl className={styles.collectionMetrics}><div><dt>Mint price</dt><dd>{nativePrice(candidate.stage?.nativePriceWei ?? null)}</dd></div><div><dt>Wallet max</dt><dd>{candidate.stage?.maxPerWallet ?? "—"}</dd></div></dl>
    <div className={styles.mintAction}>{candidate.state === "LIVE_NOW" ? <NftMintReadiness candidateId={candidate.candidateId} /> : null}<small>Discovery only · not RMT admission</small></div>
  </article>;
}

async function MintingSurface({ query }: { query: string }) {
  const radar: RmtMintRadarResponse = await readMintRadarForRequest();
  const liveCandidates = radar.status === "READY" || radar.status === "STALE" ? radar.live : [];
  const normalized = query.toLowerCase();
  const live = normalized ? liveCandidates.filter((candidate) => candidate.collectionName.toLowerCase().includes(normalized)
    || candidate.collectionAddress?.toLowerCase().includes(normalized)) : liveCandidates;
  return <section data-nft-mint-radar data-radar-state={radar.status} aria-label="Verified live NFT mints">
    {live.length > 0 ? <div className={styles.collectionRows}>{live.map((candidate) => <RadarRow candidate={candidate} key={candidate.candidateId} />)}</div>
      : <CompactEmpty title="No verified live mints" detail={radar.status === "UNAVAILABLE"
        ? "Mint schedule evidence is unavailable. Active collections remain available."
        : normalized ? "No verified live mint matches this search."
          : "RMT will show live Robinhood Chain mint schedules here when their evidence is established."} />}
  </section>;
}

function MintingFallback() {
  return <section className={styles.compactEmpty} data-nft-mint-radar-loading><strong>Checking verified mint schedules</strong></section>;
}

function SearchResults({ query, catalog }: { query: string; catalog: RmtNftTerminalCatalog }) {
  const collections = catalog.newCollections.filter((collection) => collectionMatches(collection, query));
  const normalizedTokenId = query.replace(/^#/, "");
  const items = /^\d+$/.test(normalizedTokenId) ? catalog.projects.flatMap((project) => {
    const inventory = project.inventoryPreview && "items" in project.inventoryPreview
      && project.inventoryPreview.availability === "AVAILABLE" ? project.inventoryPreview.items : [];
    return inventory.filter((item) => item.tokenId === normalizedTokenId).map((item) => ({ project, item }));
  }) : [];
  return <section data-nft-search-results aria-label={`NFT search results for ${query}`}>
    <div className={styles.resultSummary}><strong>Search results</strong><span>{collections.length + items.length} found</span></div>
    {collections.length > 0 ? <CollectionRows collections={collections} catalog={catalog} empty="No authoritative collection result found" /> : null}
    {collections.length === 0 && items.length === 0 ? <CompactEmpty title="No authoritative NFT result found" /> : null}
    {items.length > 0 ? <div className={styles.itemResults}>{items.map(({ project, item }) => <Link href={`/nft/${project.projectId}/${item.tokenId}`} key={`${project.projectId}:${item.tokenId}`} data-nft-search-item>
      <NftItemMedia metadata={item.metadata} alt={`${project.displayName} token ${item.tokenId}`} className={styles.searchItemMedia} />
      <span><strong>{project.displayName} #{item.tokenId}</strong><small>Indexed NFT · canonical owner available</small></span><em>Open item →</em>
    </Link>)}</div> : null}
  </section>;
}

export default async function NftTerminalCatalogPage({ searchParams }: {
  searchParams: Promise<{ view?: string | string[]; q?: string | string[] }>;
}) {
  const query = await searchParams;
  const view = selectedView(query.view);
  const search = boundedSearch(query.q);
  const catalog = await readRmtNftTerminalCatalog(view);
  const trendingProjects = catalog.projects.filter(isTrendingProject);
  const trendingCollections = catalog.collections.filter((collection) => trendingProjects.some((project) => project.projectId === collection.projectId));

  return <main className={styles.page}>
    <header className={styles.terminalHeading}>
      <div><h1>NFTs</h1><p>Robinhood Chain NFT Markets</p></div>
      <span><i aria-hidden="true" /> {catalog.projects.length} ACTIVE · {catalog.watchingCollections.length} WATCHING</span>
    </header>

    <CatalogTabs catalog={catalog} view={view} />

    <form className={styles.search} action="/nft" role="search">
      {view !== "active" ? <input type="hidden" name="view" value={view} /> : null}
      <label htmlFor="nft-market-search">Search collection, contract or NFT</label>
      <div><span aria-hidden="true">⌕</span><input id="nft-market-search" name="q" defaultValue={search} maxLength={120} autoComplete="off" placeholder="Search collection, contract or NFT"/><button type="submit">Search</button></div>
    </form>

    <NftMintExecutionRecovery />

    <div className={styles.catalogMeta}><strong>{search ? `Results for “${search}”` : views.find((item) => item.value === view)?.label}</strong><span>Robinhood Chain · 4663 · read-only NFT markets</span></div>

    {view === "minting" ? <Suspense fallback={<MintingFallback />}><MintingSurface query={search} /></Suspense>
      : search ? <SearchResults query={search} catalog={catalog} />
        : view === "watching" ? <CollectionRows collections={catalog.watchingCollections} catalog={catalog} empty="No verified collections are currently being watched" />
          : view === "new" ? <CollectionRows collections={catalog.newCollections} catalog={catalog} empty="No recently verified collections" />
            : view === "trending" ? <CollectionRows collections={trendingCollections} catalog={catalog} empty="No collections have authoritative trending evidence" />
              : <CollectionRows collections={catalog.collections} catalog={catalog} empty="No active RMT NFT markets" />}

    <footer className={styles.authorityNote}>Ownership and marketplace evidence remain separate. Watching is discovery-only. NFT execution is disabled.</footer>
  </main>;
}
