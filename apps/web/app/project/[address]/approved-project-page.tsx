"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PROJECT_MODULES,
  parsePublicProject,
  type PublicProjectRecord,
  type RequestedProjectModule
} from "../../../lib/creator-application";
import { getFirebaseClient } from "../../../lib/firebase-client";
import { ipfsToHttp } from "../../../lib/token-metadata";
import { GameReleaseUpdates } from "../../game-release-updates";
import { ProjectAudienceControls } from "../../project-audience-controls";
import { ProjectCreatorControls } from "../../project-creator-controls";

const MODULE_COPY: Record<RequestedProjectModule, { label: string; description: string }> = {
  token: { label: "Token", description: "Project token identity and a future connection to RMT market discovery and trading." },
  nft: { label: "NFT collection", description: "Creator-controlled collections, AI-art provenance, editions, licenses and collaborator splits." },
  marketplace: { label: "Marketplace", description: "Optional listings, offers and settlement after reviewed creator activation." },
  music: { label: "Music", description: "Optional releases for artists and AI-music creators with explicit rights and splits." },
  game: { label: "Game showcase", description: "Playable demos, trailers, platform discovery and transparent development milestones." }
};

function releaseDateLabel(value: string) {
  if (!value) return "To be announced";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

export function ApprovedProjectPage({ slug }: { slug: string }) {
  const [project, setProject] = useState<PublicProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [failedLogo, setFailedLogo] = useState("");
  const [failedBanner, setFailedBanner] = useState("");
  const [failedGameMedia, setFailedGameMedia] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void getFirebaseClient().then((client) => {
      if (!client) throw new Error("Firebase is not configured.");
      const reference = client.firestoreApi.doc(client.db, "projects", slug);
      unsubscribe = client.firestoreApi.onSnapshot(reference, (snapshot) => {
        if (!active) return;
        const parsed = snapshot.exists() ? parsePublicProject(snapshot.data()) : null;
        setProject(parsed);
        setFailed(!parsed);
        setLoading(false);
      }, () => {
        if (!active) return;
        setFailed(true);
        setLoading(false);
      });
    }).catch(() => {
      if (!active) return;
      setFailed(true);
      setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [slug]);

  if (loading) return <main className="detailPage"><Link href="/explore">← Explore</Link><section className="panel projectProfileState"><h1>Loading approved project…</h1></section></main>;
  if (failed || !project) return <main className="detailPage"><Link href="/explore">← Explore</Link><section className="panel projectProfileState"><p className="eyebrow">NOT PUBLISHED</p><h1>Project page unavailable</h1><p>This page is not approved, is no longer public, or could not be verified.</p></section></main>;

  const initials = project.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const gameEnabled = project.projectType === "gaming" || project.availableModules.includes("game");

  return (
    <main className="detailPage approvedProjectPage">
      <div className="detailNav"><Link href="/explore">← Back to Explore</Link><span>APPROVED PROJECT · V{project.schemaVersion}</span></div>
      {project.bannerUri && failedBanner !== project.bannerUri && (
        <div className="approvedProjectBanner">
          <img
            src={ipfsToHttp(project.bannerUri)}
            alt={`${project.name} banner`}
            referrerPolicy="no-referrer"
            onError={() => setFailedBanner(project.bannerUri)}
          />
        </div>
      )}
      <section className="panel approvedProjectHero">
        <div className="approvedProjectMark" aria-hidden="true">
          {project.logoUri && failedLogo !== project.logoUri
            ? <img
                src={ipfsToHttp(project.logoUri)}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setFailedLogo(project.logoUri)}
              />
            : initials}
        </div>
        <div>
          <div className="tokenOriginLine"><p className="eyebrow">RMT PAGE · REVIEW APPROVED</p><span>{project.projectType} project</span></div>
          <h1>{project.name}</h1>
          <p>{project.summary}</p>
          <div className="approvedProjectLinks">
            {project.website && <a href={project.website} target="_blank" rel="noreferrer">Website ↗</a>}
            {project.xProfile && <a href={project.xProfile} target="_blank" rel="noreferrer">X ↗</a>}
          </div>
          <ProjectAudienceControls projectSlug={project.slug} />
        </div>
      </section>

      {gameEnabled && (
        <>
        <section className="panel approvedGameShowcase" aria-labelledby="game-showcase-title">
          <header>
            <div><p className="eyebrow">GAME CREATOR SHOWCASE</p><h2 id="game-showcase-title">{project.name}</h2><p>A dedicated home for the game, its current development state and where players can experience it.</p></div>
            <span>{(project.gameStatus || "development").toUpperCase()}</span>
          </header>
          <div className="approvedGamePlatforms">
            {project.gamePlatforms.length
              ? project.gamePlatforms.map((platform) => <span key={platform}>{platform.toUpperCase()}</span>)
              : <span>PLATFORMS COMING SOON</span>}
          </div>
          <dl className="approvedGameDetails">
            <div><dt>Genre</dt><dd>{project.gameGenre ? project.gameGenre.toUpperCase() : "NOT SPECIFIED"}</dd></div>
            <div><dt>Release</dt><dd>{releaseDateLabel(project.gameReleaseDate)}</dd></div>
            <div><dt>Play modes</dt><dd>{project.gameModes.length ? project.gameModes.map((mode) => mode.toUpperCase()).join(" · ") : "NOT SPECIFIED"}</dd></div>
          </dl>
          <div className="approvedGameActions">
            {project.gameUrl && <a href={project.gameUrl} target="_blank" rel="noopener noreferrer">Play or view game ↗</a>}
            {project.trailerUrl && <a href={project.trailerUrl} target="_blank" rel="noopener noreferrer">Watch trailer ↗</a>}
            {!project.gameUrl && !project.trailerUrl && <p>The creator has not published a playable build or trailer yet.</p>}
          </div>
          {project.gameMediaUris.length > 0 && (
            <div className="approvedGameGallery">
              <div><p className="eyebrow">GAMEPLAY GALLERY</p><h3>Inside {project.name}</h3></div>
              <div>
                {project.gameMediaUris.filter((uri) => !failedGameMedia.includes(uri)).map((uri, index) => (
                  <img
                    src={ipfsToHttp(uri)}
                    alt={`${project.name} gameplay screenshot ${index + 1}`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    onError={() => setFailedGameMedia((current) => [...current, uri])}
                    key={uri}
                  />
                ))}
              </div>
            </div>
          )}
          <small>External builds and stores are creator-supplied. RMT page approval is not a security review of downloadable software.</small>
        </section>
        <GameReleaseUpdates projectSlug={project.slug} projectName={project.name} />
        </>
      )}

      {project.tokenAddress && (
        <section className="panel approvedProjectToken">
          <div><p className="eyebrow">DECLARED TOKEN</p><h2>Project-supplied contract</h2></div>
          <code>{project.tokenAddress}</code>
          <p>This address was supplied during project review. Page approval is not a contract audit, RMT-native origin claim, or safety guarantee.</p>
        </section>
      )}

      <section className="panel projectModulePanel" aria-labelledby="approved-project-modules">
        <header>
          <div><p className="eyebrow">PROJECT ECOSYSTEM</p><h2 id="approved-project-modules">Creator-selected capabilities</h2><p>These modules were selected during review. Approval creates the page only; activation remains separate.</p></div>
          <span>NO MODULE FEES CHARGED</span>
        </header>
        <div className="projectModuleGrid">
          {PROJECT_MODULES.map((module) => {
            const available = project.availableModules.includes(module);
            return <article className={`projectModuleCard ${available ? "available" : "planned"}`} key={module}><div><span>{available ? "AVAILABLE" : "NOT REQUESTED"}</span><strong>{MODULE_COPY[module].label}</strong></div><p>{MODULE_COPY[module].description}</p><small>{available ? "Creator activation not live yet" : "Can be requested in a later review"}</small></article>;
          })}
        </div>
        <p className="projectControlBoundary">No module is activated by page approval. Future activation will require the assigned creator, a disclosed one-time fee, and an explicit transaction where applicable.</p>
      </section>
      <ProjectCreatorControls project={project} />
    </main>
  );
}
