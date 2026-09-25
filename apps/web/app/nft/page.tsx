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
  hasCurrentNftTrendingEvidence,
  resolveExactRmtNftItemSearch,
  type RmtNftTerminalCatalog,
  type RmtNftTerminalCatalogView,
  type RmtNftTerminalCollectionCard,
} from "../../lib/server/nft-terminal-catalog";
import {
  readRmtNftItem,
  readRmtNftProjectInventory,
  readRmtNftProjectMarketplace,
  readRmtNftProjectOnchain,
} from "../../lib/server/nft-project-market";
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
const readInventoryForRequest = cache((projectId: string) => readRmtNftProjectInventory(projectId, { limit: 4 }));
const readOnchainForRequest = cache(readRmtNftProjectOnchain);
const readMarketplaceForRequest = cache(readRmtNftProjectMarketplace);
const readItemForRequest = cache(readRmtNftItem);

const views: readonly { value: RmtNftTerminalCatalogView; label: string }[] = [
  { value: "active", label: "Active" }, { value: "new", label: "New" },
  { value: "minting", label: "Minting" }, { value: "trending", label: "Trending" },
  { value: "watching", label: "Watching" },
];

function selectedView(value: string | string[] | undefined): RmtNftTerminalCatalogView {
  return typeof value === "string" && views.some((view) => view.value === value) ? value as RmtNftTerminalCatalogView : "active";
}
function boundedSearch(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) : "";
}
function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function amount(value: string, decimals: number) {
  const [whole, fraction = ""] = formatUnits(BigInt(value), decimals).split(".");
  return fraction ? `${whole}.${fraction.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "") : whole;
}
function nativePrice(value: string | null) {
  if (value === null) return "—";
  const [whole, fraction = ""] = formatEther(BigInt(value)).split(".");
  const boundedFraction = fraction.slice(0, 5).replace(/0+$/, "");
  return `${boundedFraction ? `${whole}.${boundedFraction}` : whole} ETH`;
}
function evidenceDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
function utcTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
}
function viewHref(view: RmtNftTerminalCatalogView) { return view === "active" ? "/nft" : `/nft?view=${view}`; }
function collectionMatches(collection: RmtNftTerminalCollectionCard, query: string) {
  const normalized = query.toLowerCase();
  return collection.displayName.toLowerCase().includes(normalized) || collection.projectId.includes(normalized)
    || collection.contractAddress.toLowerCase().includes(normalized);
}

async function TrendingTabCount({ catalog }: { catalog: RmtNftTerminalCatalog }) {
  const evidence = await Promise.all(catalog.projects.map((project) => readMarketplaceForRequest(project.projectId)));
  return <span>{evidence.filter((value) => value && "provider" in value && hasCurrentNftTrendingEvidence(value)).length}</span>;
}
async function MintingTabCount() {
  const radar = await readMintRadarForRequest();
  return radar.status === "READY" || radar.status === "STALE" ? <span>{radar.live.length}</span> : null;
}
function CatalogTabs({ catalog, view }: { catalog: RmtNftTerminalCatalog; view: RmtNftTerminalCatalogView }) {
  const counts: Partial<Record<RmtNftTerminalCatalogView, number>> = {
    active: catalog.projects.length, new: catalog.newCollections.length, watching: catalog.watchingCollections.length,
  };
  return <nav className={styles.views} aria-label="NFT market views">{views.map((item) => <Link href={viewHref(item.value)} key={item.value} aria-current={view === item.value ? "page" : undefined}>
    <strong>{item.label}</strong>
    {item.value === "minting" ? <Suspense fallback={null}><MintingTabCount /></Suspense>
      : item.value === "trending" ? <Suspense fallback={null}><TrendingTabCount catalog={catalog} /></Suspense>
        : <span>{counts[item.value]}</span>}
  </Link>)}</nav>;
}

async function CollectionArtwork({ collection }: { collection: RmtNftTerminalCollectionCard }) {
  if (collection.projectStatus !== "ACTIVE") return <span aria-label="Canonical artwork unavailable">◇</span>;
  const inventory = await readInventoryForRequest(collection.projectId);
  const artwork = inventory && "items" in inventory && inventory.availability === "AVAILABLE" ? inventory.items[0] : null;
  return artwork ? <NftItemMedia metadata={artwork.metadata} alt={`${collection.displayName} canonical collection artwork`} className={styles.collectionAvatarMedia} />
    : <span aria-label="Canonical artwork unavailable">◇</span>;
}
async function CollectionOwnership({ collection }: { collection: RmtNftTerminalCollectionCard }) {
  if (collection.projectStatus !== "ACTIVE") return <span data-ownership-state="UNAVAILABLE">Ownership unavailable</span>;
  const result = await readOnchainForRequest(collection.projectId);
  const onchain = result && "sourceStatus" in result ? result : null;
  if (!onchain) return <span data-ownership-state="UNAVAILABLE">Ownership unavailable</span>;
  return <>
    {onchain.holderCount !== null ? <span data-ownership-state="AVAILABLE">{onchain.holderCount} holders</span> : null}
    {onchain.circulatingTokenCount !== null ? <span>{onchain.circulatingTokenCount} NFTs</span> : null}
    {onchain.sourceStatus === "BACKFILLING" ? <span data-ownership-state="BACKFILLING">Ownership backfilling</span> : null}
    {onchain.sourceStatus === "ERROR" ? <span data-ownership-state="UNAVAILABLE">Ownership unavailable</span> : null}
  </>;
}
async function CollectionMarketMetrics({ collection }: { collection: RmtNftTerminalCollectionCard }) {
  if (collection.projectStatus !== "ACTIVE") return <><div><dt>Native floor</dt><dd>—</dd></div><div><dt>24h volume</dt><dd>—</dd></div></>;
  const result = await readMarketplaceForRequest(collection.projectId);
  const marketplace = result && "provider" in result ? result : null;
  const listing = marketplace?.lowestNormalizedListing ?? null;
  const volume = marketplace?.volume24hByPaymentAsset.length
    ? marketplace.volume24hByPaymentAsset.map((entry) => `${amount(entry.grossAmount, entry.paymentAsset.decimals)} ${entry.paymentAsset.symbol}`).join(" · ") : "—";
  return <>
    <div data-nft-marketplace-evidence={marketplace?.availability ?? "UNAVAILABLE"}><dt>Native floor</dt><dd>{listing ? `${amount(listing.grossAmount, listing.paymentAsset.decimals)} ${listing.paymentAsset.symbol}` : "—"}</dd></div>
    <div><dt>24h volume</dt><dd>{volume}</dd></div>
  </>;
}
function CollectionRow({ collection }: { collection: RmtNftTerminalCollectionCard }) {
  const status = collection.projectStatus === "ACTIVE" ? "RMT Active" : "Watching";
  const row = <article className={styles.collectionRow} data-nft-collection-row data-nft-known-identity data-nft-collection-status={collection.projectStatus}>
    <div className={styles.collectionAvatar} data-rmt-registration-frame><Suspense fallback={<span aria-label="Canonical artwork loading">◇</span>}><CollectionArtwork collection={collection} /></Suspense></div>
    <div className={styles.collectionMain}>
      <div className={styles.collectionName}><h2>{collection.displayName}</h2><span className={collection.projectStatus === "ACTIVE" ? styles.activeChip : styles.watchingChip}>{status}</span></div>
      <p>{collection.standard ?? "Standard unavailable"} · {collection.projectStatus === "ACTIVE" ? "Robinhood Chain" : "Discovery only"}</p>
      <div className={styles.collectionEvidence}>
        <Suspense fallback={<span data-ownership-state="LOADING">Ownership loading</span>}><CollectionOwnership collection={collection} /></Suspense>
        {collection.newEvidence ? <span data-new-evidence={collection.newEvidence.authority}>Technical verification {evidenceDate(collection.newEvidence.observedAt)}</span> : null}
      </div>
      <code title={collection.contractAddress}>{short(collection.contractAddress)}</code>
    </div>
    <dl className={styles.collectionMetrics}><Suspense fallback={<><div><dt>Native floor</dt><dd>—</dd></div><div><dt>24h volume</dt><dd>—</dd></div></>}><CollectionMarketMetrics collection={collection} /></Suspense></dl>
    <span className={styles.rowAction}>{collection.projectStatus === "ACTIVE" ? "Open market →" : "Watching"}</span>
  </article>;
  return collection.projectStatus === "ACTIVE" ? <Link className={styles.collectionRowLink} href={`/nft/${collection.projectId}`}>{row}</Link> : <div className={styles.collectionRowLink}>{row}</div>;
}
function CompactEmpty({ title, detail }: { title: string; detail?: string }) {
  return <section className={styles.compactEmpty} data-nft-empty-state><strong>{title}</strong>{detail ? <span>{detail}</span> : null}</section>;
}
function CollectionRows({ collections, empty }: { collections: readonly RmtNftTerminalCollectionCard[]; empty: string }) {
  return collections.length ? <div className={styles.collectionRows}>{collections.map((collection) => <CollectionRow collection={collection} key={`${collection.projectId}:${collection.contractAddress}`} />)}</div>
    : <CompactEmpty title={empty} />;
}

function RadarRow({ candidate }: { candidate: RmtMintRadarCandidate }) {
  const access = candidate.ccff00Access;
  const accessLabel = access.status === "VERIFIED_COMMUNITY_GATE" ? "#CCFF00 ACCESS · VERIFIED"
    : access.status === "HOLDER_MATCHES_DETECTED" ? `CCFF00 HOLDERS DETECTED · ${access.holderMatches.matchingHolderCount ?? 0}`
      : access.status === "PROVIDER_REPORTED" ? "CCFF00 ACCESS · REPORTED" : access.status === "CONNECTED_WALLET_ELIGIBLE" ? "CCFF00 ACCESS · ELIGIBLE" : null;
  return <article className={styles.mintRow} data-radar-candidate data-radar-state={candidate.state} data-radar-admission={candidate.rmtAdmission} data-radar-chain={candidate.chainId} data-ccff00-access={access.status}>
    <div className={styles.mintAvatar} aria-hidden="true">◇</div><div className={styles.collectionMain}>
      <div className={styles.collectionName}><h2>{candidate.collectionName}</h2><span className={styles.mintingChip}>Minting</span></div>
      <p>{candidate.stage?.label ?? "Verified stage"} · {candidate.contractEvidence.standard}</p><div className={styles.collectionEvidence}>
        <span>{candidate.stage ? `Ends ${utcTime(candidate.stage.endTime)}` : "Schedule verified"}</span>{accessLabel ? <span className={styles.ccff00Access}>{accessLabel}</span> : null}
      </div><code title={candidate.collectionAddress ?? undefined}>{candidate.collectionAddress ? short(candidate.collectionAddress) : "Contract not established"}</code>
    </div><dl className={styles.collectionMetrics}><div><dt>Mint price</dt><dd>{nativePrice(candidate.stage?.nativePriceWei ?? null)}</dd></div><div><dt>Wallet max</dt><dd>{candidate.stage?.maxPerWallet ?? "—"}</dd></div></dl>
    <div className={styles.mintAction}>{candidate.state === "LIVE_NOW" ? <NftMintReadiness candidateId={candidate.candidateId} /> : null}<small>Discovery only · not RMT admission</small></div>
  </article>;
}
async function MintingSurface({ query }: { query: string }) {
  const radar: RmtMintRadarResponse = await readMintRadarForRequest();
  const candidates = radar.status === "READY" || radar.status === "STALE" ? radar.live : [];
  const normalized = query.toLowerCase();
  const live = normalized ? candidates.filter((candidate) => candidate.collectionName.toLowerCase().includes(normalized) || candidate.collectionAddress?.toLowerCase().includes(normalized)) : candidates;
  return <section data-nft-mint-radar data-radar-state={radar.status} aria-label="Verified live NFT mints">{live.length
    ? <div className={styles.collectionRows}>{live.map((candidate) => <RadarRow candidate={candidate} key={candidate.candidateId} />)}</div>
    : <CompactEmpty title="No verified live mints" detail={radar.status === "UNAVAILABLE" ? "Mint schedule evidence is unavailable. Active collections remain available." : normalized ? "No verified live mint matches this search." : "RMT will show live Robinhood Chain mint schedules here when their evidence is established."} />}
    <p className={styles.radarProvenance}>Mint Radar · OpenSea schedule evidence + independent SeaDrop verification · {radar.status}{radar.status === "STALE" ? " · stale evidence shown explicitly" : ""}</p>
  </section>;
}

async function ExactItemResults({ query, catalog }: { query: string; catalog: RmtNftTerminalCatalog }) {
  const result = await resolveExactRmtNftItemSearch(query, catalog.projects, readItemForRequest);
  if (result.status === "NOT_APPLICABLE") return null;
  if (result.status === "CONFIRMED") return <div className={styles.itemResults} data-nft-item-lookup="CONFIRMED">{result.matches.map(({ project, item }) => <Link href={`/nft/${project.projectId}/${item.tokenId}`} key={`${project.projectId}:${item.tokenId}`} data-nft-search-item>
    <NftItemMedia metadata={item.metadata} alt={`${project.displayName} token ${item.tokenId}`} className={styles.searchItemMedia} />
    <span><strong>{project.displayName} #{item.tokenId}</strong><small>Exact indexed NFT · canonical identity confirmed</small></span><em>Open item →</em>
  </Link>)}</div>;
  return result.status === "UNAVAILABLE" ? <section data-nft-item-lookup="UNAVAILABLE"><CompactEmpty title="NFT lookup temporarily unavailable" detail="Collection results remain available." /></section>
    : <section data-nft-item-lookup="NOT_FOUND"><CompactEmpty title="NFT item not found" /></section>;
}
function SearchResults({ query, catalog }: { query: string; catalog: RmtNftTerminalCatalog }) {
  const collections = [...catalog.newCollections, ...catalog.collections].filter((collection, index, all) =>
    all.findIndex((candidate) => candidate.projectId === collection.projectId && candidate.contractAddress === collection.contractAddress) === index)
    .filter((collection) => collectionMatches(collection, query));
  return <section data-nft-search-results aria-label={`NFT search results for ${query}`}>
    <div className={styles.resultSummary}><strong>Search results</strong><span>{collections.length} collection matches</span></div>
    {collections.length ? <CollectionRows collections={collections} empty="No authoritative collection result found" /> : null}
    <Suspense fallback={<section data-nft-item-lookup="LOADING"><CompactEmpty title="Checking exact NFT identity" /></section>}><ExactItemResults query={query} catalog={catalog} /></Suspense>
    {!collections.length && !/^(?:(?:[a-z0-9-]+)\s*)?#?(?:0|[1-9]\d*)$/i.test(query) ? <CompactEmpty title="No authoritative NFT result found" /> : null}
  </section>;
}
async function TrendingSurface({ catalog }: { catalog: RmtNftTerminalCatalog }) {
  const entries = await Promise.all(catalog.collections.map(async (collection) => ({ collection, evidence: await readMarketplaceForRequest(collection.projectId) })));
  return <CollectionRows collections={entries.filter(({ evidence }) => evidence && "provider" in evidence && hasCurrentNftTrendingEvidence(evidence)).map(({ collection }) => collection)} empty="No collections have current authoritative trending evidence" />;
}

export default async function NftTerminalCatalogPage({ searchParams }: { searchParams: Promise<{ view?: string | string[]; q?: string | string[] }> }) {
  const query = await searchParams;
  const view = selectedView(query.view);
  const search = boundedSearch(query.q);
  const catalog = readRmtNftTerminalCatalog(view);
  return <main className={styles.page}>
    <header className={styles.terminalHeading}><div><h1>NFTs</h1><p>Robinhood Chain NFT Markets</p></div><span><i aria-hidden="true" /> {catalog.projects.length} ACTIVE · {catalog.watchingCollections.length} WATCHING</span></header>
    <CatalogTabs catalog={catalog} view={view} />
    <form className={styles.search} action="/nft" role="search">{view !== "active" ? <input type="hidden" name="view" value={view} /> : null}<label htmlFor="nft-market-search">Search collection, contract or NFT</label><div><span aria-hidden="true">⌕</span><input id="nft-market-search" name="q" defaultValue={search} maxLength={120} autoComplete="off" placeholder="Search collection, contract or NFT"/><button type="submit">Search</button></div></form>
    <NftMintExecutionRecovery />
    <div className={styles.catalogMeta}><strong>{search ? `Results for “${search}”` : views.find((item) => item.value === view)?.label}</strong><span>Robinhood Chain · 4663 · read-only NFT markets</span></div>
    {view === "minting" ? <Suspense fallback={<section className={styles.compactEmpty} data-nft-mint-radar-loading><strong>Checking verified mint schedules</strong></section>}><MintingSurface query={search} /></Suspense>
      : search ? <SearchResults query={search} catalog={catalog} />
        : view === "watching" ? <CollectionRows collections={catalog.watchingCollections} empty="No verified collections are currently being watched" />
          : view === "new" ? <CollectionRows collections={catalog.newCollections} empty="No recently technically verified collections" />
            : view === "trending" ? <Suspense fallback={<CompactEmpty title="Checking current marketplace activity" />}><TrendingSurface catalog={catalog} /></Suspense>
              : <CollectionRows collections={catalog.collections} empty="No active RMT NFT markets" />}
    <footer className={styles.authorityNote}>Ownership and marketplace evidence remain separate. Watching is discovery-only. NFT execution is disabled.</footer>
  </main>;
}
