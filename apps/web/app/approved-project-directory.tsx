"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  GAME_PLATFORMS,
  GAME_STATUSES,
  PROJECT_MODULES,
  type GamePlatform,
  type GameStatus,
  type PublicProjectRecord,
  type RequestedProjectModule
} from "../lib/creator-application";
import { subscribeToPublicProjects } from "../lib/creator-application-cloud";
import { filterGameProjects, sortGameProjects } from "../lib/game-discovery";
import { OFFICIAL_RMT_V6_TOKEN } from "../lib/project-page";
import { ipfsToHttp } from "../lib/token-metadata";

const MODULE_LABELS: Record<RequestedProjectModule, string> = {
  token: "Token",
  nft: "NFT",
  marketplace: "Market",
  music: "Music",
  game: "Game"
};

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function ProjectDirectoryMark({ project }: { project: PublicProjectRecord }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="approvedDirectoryMark">
      {project.logoUri && !failed
        ? <img src={ipfsToHttp(project.logoUri)} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : initials(project.name)}
    </div>
  );
}

function GameDirectoryCard({ project }: { project: PublicProjectRecord }) {
  const [failedBanner, setFailedBanner] = useState(false);
  const status = project.gameStatus || "development";
  return (
    <article className="gameDirectoryCard">
      <div className="gameDirectoryArtwork">
        {project.bannerUri && !failedBanner
          ? <img src={ipfsToHttp(project.bannerUri)} alt="" referrerPolicy="no-referrer" onError={() => setFailedBanner(true)} />
          : <div className="gameDirectoryFallback" aria-hidden="true">{initials(project.name)}</div>}
        <span>{status.toUpperCase()}</span>
      </div>
      <div className="gameDirectoryBody">
        <div className="gameDirectoryIdentity"><ProjectDirectoryMark project={project} /><div><p>REVIEW-APPROVED GAME{project.gameGenre ? ` · ${project.gameGenre.toUpperCase()}` : ""}</p><h3>{project.name}</h3></div></div>
        <p className="gameDirectorySummary">{project.summary}</p>
        <div className="gameDirectoryPlatforms">
          {project.gamePlatforms.length
            ? project.gamePlatforms.slice(0, 5).map((platform) => <span key={platform}>{platform.toUpperCase()}</span>)
            : <span>PLATFORMS COMING SOON</span>}
        </div>
        <div className={`gameDirectoryActions ${project.gameUrl ? "" : "single"}`}>
          <Link href={`/project/${project.slug}`}>Game page →</Link>
          {project.gameUrl && <a href={project.gameUrl} target="_blank" rel="noopener noreferrer">Play or view ↗</a>}
        </div>
      </div>
    </article>
  );
}

function publishedTime(value: unknown) {
  return value && typeof value === "object" && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function"
    ? (value as { toMillis: () => number }).toMillis()
    : 0;
}

export function GameDirectorySection({ projects }: { projects: PublicProjectRecord[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<GameStatus | "all">("all");
  const [platformFilter, setPlatformFilter] = useState<GamePlatform | "all">("all");
  const filteredProjects = useMemo(() => filterGameProjects(projects, {
    query,
    status: statusFilter,
    platform: platformFilter
  }), [platformFilter, projects, query, statusFilter]);
  const filtersActive = Boolean(query.trim()) || statusFilter !== "all" || platformFilter !== "all";
  const resetFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setPlatformFilter("all");
  };

  return (
    <section className="panel gameDirectory" aria-labelledby="game-directory-title">
      <header className="approvedDirectoryHeader gameDirectoryHeader">
        <div>
          <p className="eyebrow">RMT GAMES</p>
          <h2 id="game-directory-title">Play, follow and discover creator-built worlds</h2>
          <p>Approved game pages bring playable builds, trailers, platforms and development progress into one place. A token is optional.</p>
        </div>
        <span>{filtersActive ? `${filteredProjects.length} / ` : ""}{projects.length} GAME{projects.length === 1 ? "" : "S"}</span>
      </header>
      {projects.length > 0 && (
        <div className="gameDirectoryFilters" role="search" aria-label="Filter approved games">
          <label><span>Search games</span><input type="search" placeholder="Title, genre or mode" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as GameStatus | "all")}><option value="all">All statuses</option>{GAME_STATUSES.map((gameStatus) => <option value={gameStatus} key={gameStatus}>{gameStatus === "development" ? "In development" : gameStatus[0].toUpperCase() + gameStatus.slice(1)}</option>)}</select></label>
          <label><span>Platform</span><select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as GamePlatform | "all")}><option value="all">All platforms</option>{GAME_PLATFORMS.map((platform) => <option value={platform} key={platform}>{platform === "macos" ? "macOS" : platform === "ios" ? "iOS" : platform[0].toUpperCase() + platform.slice(1)}</option>)}</select></label>
          {filtersActive && <button type="button" onClick={resetFilters}>Reset filters</button>}
        </div>
      )}
      {projects.length > 0 && filteredProjects.length > 0
        ? <div className="gameDirectoryGrid">{filteredProjects.map((project) => <GameDirectoryCard project={project} key={project.slug} />)}</div>
        : projects.length > 0
          ? <div className="gameDirectoryEmpty gameDirectoryNoResults"><div><strong>No approved games match those filters.</strong><p>Try another title, status or platform.</p></div><button type="button" onClick={resetFilters}>Show all games</button></div>
          : <div className="gameDirectoryEmpty">
              <div><strong>The showcase is open for its first reviewed games.</strong><p>Independent studios and gaming creators can apply without launching a token.</p></div>
              <Link href="/profile">Apply through Profile →</Link>
            </div>}
      <p className="gameDirectoryDisclosure">External games and stores are creator-supplied. RMT page approval verifies page access, not downloadable software or game economics.</p>
    </section>
  );
}

export function ApprovedProjectDirectory() {
  const [projects, setProjects] = useState<PublicProjectRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToPublicProjects((next) => {
      if (!active) return;
      setProjects(next);
      setStatus("live");
    }, () => {
      if (!active) return;
      setStatus("unavailable");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (!active) return;
      setStatus("unavailable");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const visibleProjects = useMemo(() => projects
    .filter((project) => project.tokenAddress.toLowerCase() !== OFFICIAL_RMT_V6_TOKEN.toLowerCase())
    .sort((left, right) => publishedTime(right.publishedAt) - publishedTime(left.publishedAt)
      || left.name.localeCompare(right.name)), [projects]);
  const gamingProjects = useMemo(() => sortGameProjects([...visibleProjects]), [visibleProjects]);

  return (
    <>
    <GameDirectorySection projects={gamingProjects} />
    <section className="panel approvedDirectory" aria-labelledby="approved-directory-title">
      <header className="approvedDirectoryHeader">
        <div>
          <p className="eyebrow">RMT PROJECT DIRECTORY</p>
          <h2 id="approved-directory-title">Projects building with RMT</h2>
          <p>Official RMT infrastructure and review-approved community pages. Review approval is identity and page access—not a contract audit or endorsement.</p>
        </div>
        <span>{1 + visibleProjects.length} PROJECT{visibleProjects.length === 0 ? "" : "S"}</span>
      </header>

      <div className="approvedProjectGrid">
        <Link className="approvedDirectoryCard official" href={`/project/${OFFICIAL_RMT_V6_TOKEN}`}>
          <div className="approvedDirectoryMark"><img src="/brand/rmt-master-logo.png" alt="" /></div>
          <div className="approvedDirectoryIdentity">
            <span>OFFICIAL RMT · FACTORY VERIFIED</span>
            <h3>Robinhood Meme Terminal</h3>
            <p>RMT&apos;s live protocol identity, verified token contract and current onchain project modules.</p>
          </div>
          <div className="approvedDirectoryModules"><span>Token</span><span>Protocol</span><span>Trading</span></div>
          <strong>Open project →</strong>
        </Link>

        {visibleProjects.map((project) => (
          <Link className="approvedDirectoryCard" href={`/project/${project.slug}`} key={project.slug}>
            <ProjectDirectoryMark project={project} />
            <div className="approvedDirectoryIdentity">
              <span>REVIEW APPROVED · {project.projectType.toUpperCase()}</span>
              <h3>{project.name}</h3>
              <p>{project.summary}</p>
            </div>
            <div className="approvedDirectoryModules">
              {PROJECT_MODULES.filter((module) => project.availableModules.includes(module))
                .map((module) => <span key={module}>{MODULE_LABELS[module]}</span>)}
            </div>
            <strong>View project →</strong>
          </Link>
        ))}

        {status === "loading" && (
          <div className="approvedDirectoryCard directoryPlaceholder">
            <div className="approvedDirectoryIdentity"><span>SYNCING DIRECTORY</span><h3>Loading approved project pages</h3><p>RMT is checking the public project registry. Private application data is never included here.</p></div>
          </div>
        )}
        {status === "unavailable" && (
          <div className="approvedDirectoryCard directoryPlaceholder">
            <div className="approvedDirectoryIdentity"><span>DIRECTORY DELAYED</span><h3>Community pages temporarily unavailable</h3><p>The verified RMT project remains accessible while the public directory reconnects.</p></div>
          </div>
        )}
        {status === "live" && visibleProjects.length === 0 && (
          <Link className="approvedDirectoryCard directoryPlaceholder" href="/profile">
            <div className="approvedDirectoryIdentity"><span>CREATOR ACCESS</span><h3>Build your project home on RMT</h3><p>Projects, artists, musicians and communities can apply for a reviewed page from their private profile.</p></div>
            <strong>Apply through Profile →</strong>
          </Link>
        )}
      </div>
    </section>
    </>
  );
}
