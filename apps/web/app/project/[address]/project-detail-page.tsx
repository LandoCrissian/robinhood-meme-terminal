"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { useReadContract } from "wagmi";
import { activeChain, activeNetworkLabel } from "../../../lib/network";
import { RewardVaultPanel } from "../../reward-vault-panel";
import { MarketPanel } from "../../market-panel";
import { TokenShareActions } from "../../token-share-actions";
import { WatchlistButton } from "../../watchlist-button";
import { ipfsToHttp, resolveTokenMetadata, type TokenMetadata } from "../../../lib/token-metadata";
import { useLaunchRecord, type LaunchRecordHint } from "../../../lib/use-launch-record";
import { buildVerifiedTokenProject } from "../../../lib/project-page";
import { ProjectModuleGrid } from "../../project-module-grid";

const tokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "metadataURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

const fallbackAddress = "0x0000000000000000000000000000000000000000" as const;

function shortAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function ProjectDetailPage() {
  const params = useParams<{ address: string }>();
  const searchParams = useSearchParams();
  const tokenAddress: Address | null = params.address && isAddress(params.address) ? getAddress(params.address) : null;
  const address = tokenAddress ?? fallbackAddress;
  const enabled = Boolean(tokenAddress);
  const common = { address, abi: tokenAbi, chainId: activeChain.id, query: { enabled } } as const;
  const nameRead = useReadContract({ ...common, functionName: "name" });
  const symbolRead = useReadContract({ ...common, functionName: "symbol" });
  const supplyRead = useReadContract({ ...common, functionName: "totalSupply" });
  const creatorRead = useReadContract({ ...common, functionName: "creator" });
  const metadataRead = useReadContract({ ...common, functionName: "metadataURI" });
  const launchIdParam = searchParams.get("launch");
  const sideParam = searchParams.get("side");
  const toolParam = searchParams.get("tool");
  const initialMode = sideParam === "sell" ? "sell" : sideParam === "buy" ? "buy" : undefined;
  const initialDetail = toolParam === "risk" ? "risk" : toolParam === "activity" ? "activity" : undefined;
  const launchHint = launchIdParam && /^\d+$/.test(launchIdParam) ? { launchId: launchIdParam, token: address } : undefined;
  const launchRecord = useLaunchRecord(address, launchHint);
  const [metadata, setMetadata] = useState<TokenMetadata | null>(null);
  const [infoTab, setInfoTab] = useState<"overview" | "rewards" | "about">("overview");
  const verifiedMetadataURI = launchRecord.data && launchRecord.data.metadataURI === metadataRead.data
    ? launchRecord.data.metadataURI
    : null;

  useEffect(() => {
    let active = true;
    setMetadata(null);
    if (verifiedMetadataURI) void resolveTokenMetadata(verifiedMetadataURI).then((value) => { if (active) setMetadata(value); });
    return () => { active = false; };
  }, [verifiedMetadataURI]);

  useEffect(() => {
    const resolvedLaunchId = launchRecord.data?.launchId.toString();
    if (!resolvedLaunchId || launchIdParam === resolvedLaunchId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("launch", resolvedLaunchId);
    window.history.replaceState(window.history.state, "", url);
  }, [launchIdParam, launchRecord.data?.launchId]);

  if (!tokenAddress) return <main className="detailPage"><Link href="/explore">← Explore</Link><section className="panel"><h1>Invalid project identity</h1><p>This project route requires a valid verified RMT token address.</p></section></main>;

  const reads = [nameRead, symbolRead, supplyRead, creatorRead, metadataRead];
  if (reads.some((read) => read.isLoading) || launchRecord.isPending || launchRecord.isFetching) return <main className="detailPage"><Link href="/explore">← Explore</Link><section className="panel"><h1>Verifying RMT project…</h1><p>Checking the active factory launch record before showing the project or its trading controls.</p></section></main>;
  if (launchRecord.error || (launchRecord.isSuccess && !launchRecord.data)) return <main className="detailPage"><Link href="/explore">← Explore</Link><section className="panel"><p className="eyebrow">ORIGIN NOT VERIFIED</p><h1>Not a verified RMT-native project</h1><p>RMT could not prove that this token came from the currently active V6 factory. No verified project identity or trading controls are shown.</p></section></main>;
  if (reads.some((read) => read.error) || nameRead.data === undefined || symbolRead.data === undefined || supplyRead.data === undefined || creatorRead.data === undefined || metadataRead.data === undefined) return <main className="detailPage"><Link href="/explore">← Explore</Link><section className="panel"><h1>Project could not be verified</h1><p>The address may not be an RMT fixed-supply token on {activeNetworkLabel}.</p></section></main>;

  const launch = launchRecord.data;
  if (!launch) return <main className="detailPage"><Link href="/explore">← Explore</Link><section className="panel"><p className="eyebrow">ORIGIN UNAVAILABLE</p><h1>Project origin could not be verified</h1><p>The active factory record is temporarily unavailable. Project and trading details remain hidden until verification succeeds.</p></section></main>;

  const identityMatches = launch.token === tokenAddress
    && launch.creator === creatorRead.data
    && launch.name === nameRead.data
    && launch.symbol === symbolRead.data
    && launch.metadataURI === metadataRead.data
    && supplyRead.data === 1_000_000_000n * 10n ** 18n;
  if (!identityMatches) return <main className="detailPage"><Link href="/explore">← Explore</Link><section className="panel"><p className="eyebrow">IDENTITY MISMATCH</p><h1>Project identity could not be verified</h1><p>The token contract does not match its active-factory launch record. No verified project identity or trading controls are shown.</p></section></main>;

  const explorer = `${activeChain.blockExplorers.default.url}/address/${tokenAddress}`;
  const project = buildVerifiedTokenProject({
    chainId: activeChain.id,
    token: tokenAddress,
    creator: creatorRead.data,
    officialMigration: launch.officialMigration
  });
  const verifiedLaunchHint: LaunchRecordHint = {
    launchId: launch.launchId.toString(),
    token: tokenAddress,
    blockNumber: launch.blockNumber.toString(),
    transactionHash: launch.transactionHash ?? undefined
  };

  return (
    <main className="detailPage">
      <div className="detailNav"><Link href="/explore">← Back to RMT projects</Link><span>PROJECT PAGE · V{project.schemaVersion}</span></div>
      <section className="tokenHero panel">
        <div className="coin largeCoin tokenArtwork">{metadata?.image ? <img src={ipfsToHttp(metadata.image)} alt={`${nameRead.data} artwork`} /> : symbolRead.data.slice(0, 2)}</div>
        <div className="tokenHeroCopy"><div className="tokenOriginLine"><p className="eyebrow">{project.official ? "OFFICIAL RMT · PROJECT VERIFIED" : "RMT V6 · PROJECT VERIFIED"}</p><span>Live on {activeNetworkLabel}</span></div><h1>{nameRead.data}</h1><p className="tokenSymbol">${symbolRead.data}</p>{metadata?.description && <p className="tokenDescription">{metadata.description}</p>}<div className="tokenHeroActions"><WatchlistButton address={tokenAddress} name={nameRead.data} symbol={symbolRead.data} image={metadata?.image} launchId={launch.launchId.toString()} compactLabel /><TokenShareActions address={tokenAddress} name={nameRead.data} symbol={symbolRead.data} launchId={launch.launchId.toString()} /></div></div>
      </section>
      <ProjectModuleGrid project={project} />
      <section className="projectTerminalTools" id="project-terminal" aria-labelledby="project-terminal-heading">
        <header>
          <div><p className="eyebrow">RMT-NATIVE TOOLKIT</p><h2 id="project-terminal-heading">Project Terminal</h2></div>
          <span>ONE VERIFIED MARKET</span>
        </header>
        <nav aria-label={`${nameRead.data} terminal tools`}>
          <Link className="tradeTool buy" href={`?launch=${launch.launchId.toString()}&side=buy#trade`}>Buy</Link>
          <Link className="tradeTool sell" href={`?launch=${launch.launchId.toString()}&side=sell#trade`}>Sell</Link>
          <Link href={`?launch=${launch.launchId.toString()}#market-chart`}>Chart</Link>
          <Link href={`?launch=${launch.launchId.toString()}&tool=activity#market-evidence`}>Activity</Link>
          <Link href={`?launch=${launch.launchId.toString()}&tool=risk#market-evidence`}>Creator risk</Link>
          <a href={explorer} target="_blank" rel="noreferrer">Contract ↗</a>
        </nav>
      </section>
      <MarketPanel tokenAddress={tokenAddress} symbol={symbolRead.data} totalSupply={supplyRead.data} creator={creatorRead.data} initialMode={initialMode} initialDetail={initialDetail} launchHint={verifiedLaunchHint} />
      <section className="panel tokenInfoPanel">
        <div className="tokenInfoTabs" role="tablist" aria-label="Token information"><button type="button" role="tab" aria-selected={infoTab === "overview"} className={infoTab === "overview" ? "active" : ""} onClick={() => setInfoTab("overview")}>Overview</button><button type="button" role="tab" aria-selected={infoTab === "rewards"} className={infoTab === "rewards" ? "active" : ""} onClick={() => setInfoTab("rewards")}>Graduation & rewards</button><button type="button" role="tab" aria-selected={infoTab === "about"} className={infoTab === "about" ? "active" : ""} onClick={() => setInfoTab("about")}>About</button></div>
        {infoTab === "overview" && <div className="tokenInfoPane overviewPane"><section><p className="eyebrow">TOKEN RULES</p><h2>Fixed and transparent</h2><div className="safetyList compactSafetyList"><span>✓ Fixed supply</span><span>✓ No mint</span><span>✓ No blacklist</span><span>✓ No transfer tax</span><span>✓ No upgrade proxy</span></div></section><section><p className="eyebrow">ONCHAIN DATA</p><h2>Contract details</h2><dl><dt>Protocol origin</dt><dd>RMT V6 launch #{launch.launchId.toString()}</dd><dt>Total supply</dt><dd>{Number(formatUnits(supplyRead.data, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd><dt>Original launch creator</dt><dd title={creatorRead.data}>{shortAddress(creatorRead.data)}</dd><dt>Token contract</dt><dd title={tokenAddress}>{shortAddress(tokenAddress)}</dd></dl><a className="explorerLink" href={explorer} target="_blank" rel="noreferrer">Open verified token ↗</a></section></div>}
        {infoTab === "rewards" && <div className="tokenInfoPane rewardsPane"><RewardVaultPanel tokenAddress={tokenAddress} symbol={symbolRead.data} launchHint={verifiedLaunchHint} /></div>}
        {infoTab === "about" && <div className="tokenInfoPane aboutPane"><section><p className="eyebrow">PROJECT</p><h2>{nameRead.data}</h2><p>{metadata?.description || "No project description was included in this token’s permanent launch metadata."}</p>{metadata && (metadata.website || metadata.x || metadata.telegram) && <div className="socialLinks">{metadata.website && <a href={metadata.website} target="_blank" rel="noopener noreferrer">Website ↗</a>}{metadata.x && <a href={metadata.x} target="_blank" rel="noopener noreferrer">X ↗</a>}{metadata.telegram && <a href={metadata.telegram} target="_blank" rel="noopener noreferrer">Telegram ↗</a>}</div>}</section><section className="metadataPanel"><p className="eyebrow">METADATA</p><h2>Permanent launch record</h2><div className="metadataStatus"><span>{metadataRead.data.startsWith("ipfs://") ? "IPFS content address" : "Onchain launch record"}</span><code>{metadataRead.data}</code></div></section></div>}
      </section>
    </main>
  );
}
