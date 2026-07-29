"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import {
  GAME_GENRES,
  GAME_MODES,
  GAME_PLATFORMS,
  GAME_STATUSES,
  PROJECT_MODULES,
  normalizeProjectIdentity,
  validateProjectIdentity,
  type ProjectIdentityDraft,
  type PublicProjectRecord,
  type GameGenre,
  type GameMode,
  type GamePlatform,
  type GameStatus,
  type RequestedProjectModule
} from "../lib/creator-application";
import {
  requestModuleActivation,
  publishGameUpdate,
  subscribeToModuleActivationRequests,
  subscribeToProjectAssignment,
  updateProjectIdentity
} from "../lib/creator-application-cloud";
import {
  EMPTY_GAME_UPDATE,
  GAME_UPDATE_TYPES,
  validateGameUpdate,
  type GameUpdateDraft,
  type GameUpdateType
} from "../lib/game-updates";
import type {
  ModuleActivationRequest,
  ProjectAssignment
} from "../lib/project-ownership";
import { useProfile } from "./profile-provider";

const MODULE_COPY: Record<RequestedProjectModule, { label: string; description: string }> = {
  token: { label: "Token", description: "Prepare verified token identity, market connections and trading surfaces." },
  nft: { label: "NFT collection", description: "Plan collection contracts, artwork provenance, rights and creator splits." },
  marketplace: { label: "Marketplace", description: "Plan listings, offers, settlement rules and creator-controlled market access." },
  music: { label: "Music", description: "Plan releases, licenses, collaborator splits and collectible media." },
  game: { label: "Game showcase", description: "Publish playable demos, trailers, platform availability and development progress." }
};

const PLATFORM_LABELS: Record<GamePlatform, string> = {
  web: "Web",
  windows: "Windows",
  macos: "macOS",
  ios: "iOS",
  android: "Android",
  console: "Console",
  vr: "VR"
};

const GENRE_LABELS: Record<GameGenre, string> = {
  action: "Action",
  adventure: "Adventure",
  arcade: "Arcade",
  card: "Card",
  casual: "Casual",
  fighting: "Fighting",
  puzzle: "Puzzle",
  racing: "Racing",
  rpg: "RPG",
  simulation: "Simulation",
  sports: "Sports",
  strategy: "Strategy",
  other: "Other"
};

const MODE_LABELS: Record<GameMode, string> = {
  "single-player": "Single player",
  multiplayer: "Multiplayer",
  "co-op": "Co-op",
  competitive: "Competitive",
  mmo: "MMO"
};

const UPDATE_TYPE_LABELS: Record<GameUpdateType, string> = {
  development: "Development update",
  milestone: "Milestone",
  playtest: "Playtest",
  release: "Release"
};

function requestLabel(request: ModuleActivationRequest | undefined) {
  if (!request) return "Request activation review";
  if (request.status === "requested") return "Review requested";
  if (request.status === "reviewing") return "RMT reviewing";
  if (request.status === "ready") return "Ready for setup";
  return "Request declined";
}

export function ProjectCreatorControls({ project }: { project: PublicProjectRecord }) {
  const slug = project.slug;
  const { loading: profileLoading, user } = useProfile();
  const [assignment, setAssignment] = useState<ProjectAssignment | null>(null);
  const [requests, setRequests] = useState<Partial<Record<RequestedProjectModule, ModuleActivationRequest>>>({});
  const [ownershipChecked, setOwnershipChecked] = useState(false);
  const [busyModule, setBusyModule] = useState<RequestedProjectModule | null>(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [publishingUpdate, setPublishingUpdate] = useState(false);
  const [gameUpdate, setGameUpdate] = useState<GameUpdateDraft>(EMPTY_GAME_UPDATE);
  const [updateMessage, setUpdateMessage] = useState("");
  const [message, setMessage] = useState("");
  const [identity, setIdentity] = useState<ProjectIdentityDraft>(() => normalizeProjectIdentity(project));
  const isGaming = project.projectType === "gaming" || project.availableModules.includes("game");

  useEffect(() => {
    setIdentity(normalizeProjectIdentity(project));
  }, [project]);

  useEffect(() => {
    setAssignment(null);
    setRequests({});
    setOwnershipChecked(false);
    setMessage("");
    if (!user) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToProjectAssignment(user, slug, (next) => {
      if (!active) return;
      setAssignment(next);
      setOwnershipChecked(true);
    }, () => {
      if (!active) return;
      setAssignment(null);
      setOwnershipChecked(true);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (!active) return;
      setAssignment(null);
      setOwnershipChecked(true);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [slug, user]);

  useEffect(() => {
    if (!user || !assignment) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToModuleActivationRequests(user, slug, (next) => {
      if (active) setRequests(next);
    }, () => {
      if (active) setMessage("RMT could not load the private module request status.");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (active) setMessage("RMT could not load the private module request status.");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [assignment, slug, user]);

  const requestActivation = async (module: RequestedProjectModule) => {
    if (!user || !assignment || requests[module]) return;
    setBusyModule(module);
    setMessage("");
    try {
      await requestModuleActivation(user, slug, module);
      setMessage(`${MODULE_COPY[module].label} activation review requested. No fee or transaction was created.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The activation request could not be saved.");
    } finally {
      setBusyModule(null);
    }
  };

  const saveIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !assignment) return;
    const validationError = validateProjectIdentity(identity);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setSavingIdentity(true);
    setMessage("");
    try {
      await updateProjectIdentity(user, project, identity);
      setMessage("Project identity saved. The public directory and project page update automatically.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project identity could not be saved.");
    } finally {
      setSavingIdentity(false);
    }
  };

  const toggleGamePlatform = (platform: GamePlatform) => {
    setIdentity((current) => ({
      ...current,
      gamePlatforms: current.gamePlatforms.includes(platform)
        ? current.gamePlatforms.filter((candidate) => candidate !== platform)
        : [...current.gamePlatforms, platform]
    }));
  };

  const toggleGameMode = (mode: GameMode) => {
    setIdentity((current) => ({
      ...current,
      gameModes: current.gameModes.includes(mode)
        ? current.gameModes.filter((candidate) => candidate !== mode)
        : [...current.gameModes, mode]
    }));
  };

  const submitGameUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !assignment || !isGaming) return;
    const validationError = validateGameUpdate(gameUpdate);
    if (validationError) {
      setUpdateMessage(validationError);
      return;
    }
    setPublishingUpdate(true);
    setUpdateMessage("");
    try {
      await publishGameUpdate(user, project, gameUpdate);
      setGameUpdate(EMPTY_GAME_UPDATE);
      setUpdateMessage("Development update published to the public game page.");
    } catch (error) {
      setUpdateMessage(error instanceof Error ? error.message : "The development update could not be published.");
    } finally {
      setPublishingUpdate(false);
    }
  };

  if (profileLoading) return null;
  if (!user) {
    return (
      <section className="panel creatorControlPrompt">
        <div><p className="eyebrow">CREATOR WORKSPACE</p><h2>Assigned creator controls</h2><p>The approved project owner can sign in to privately request module activation review.</p></div>
        <Link href="/profile">Open Profile →</Link>
      </section>
    );
  }
  if (!ownershipChecked || !assignment) return null;

  return (
    <section className="panel creatorControlPanel" id="creator-studio" aria-labelledby="creator-control-title">
      <header>
        <div><p className="eyebrow">RMT CREATOR STUDIO</p><h2 id="creator-control-title">Manage project identity and capabilities</h2><p>This profile is assigned to the project. Presentation updates are public; module requests begin a separate RMT review and do not deploy contracts, charge fees or grant wallet authority.</p></div>
        <span>OWNER VERIFIED</span>
      </header>
      <form className="creatorIdentityEditor" onSubmit={saveIdentity}>
        <div className="creatorIdentityHeading"><div><strong>Public project identity</strong><p>Use HTTPS or IPFS images. Logos and banners are displayed with no-referrer protection; SVG files are rejected.</p></div><span>LIVE PREVIEW DATA</span></div>
        <div className="creatorIdentityFields">
          <label>Project name<input maxLength={80} value={identity.name} onChange={(event) => setIdentity((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Website<input maxLength={256} inputMode="url" placeholder="https://" value={identity.website} onChange={(event) => setIdentity((current) => ({ ...current, website: event.target.value }))} /></label>
          <label className="creatorIdentityWide">Description<textarea maxLength={600} value={identity.summary} onChange={(event) => setIdentity((current) => ({ ...current, summary: event.target.value }))} /></label>
          <label>X profile<input maxLength={256} inputMode="url" placeholder="https://x.com/" value={identity.xProfile} onChange={(event) => setIdentity((current) => ({ ...current, xProfile: event.target.value }))} /></label>
          <label>Logo image<input maxLength={512} inputMode="url" placeholder="https:// or ipfs://" value={identity.logoUri} onChange={(event) => setIdentity((current) => ({ ...current, logoUri: event.target.value }))} /></label>
          <label className="creatorIdentityWide">Banner image<input maxLength={512} inputMode="url" placeholder="https:// or ipfs://" value={identity.bannerUri} onChange={(event) => setIdentity((current) => ({ ...current, bannerUri: event.target.value }))} /></label>
          {isGaming && (
            <>
              <label>Game status<select value={identity.gameStatus || "development"} onChange={(event) => setIdentity((current) => ({ ...current, gameStatus: event.target.value as GameStatus }))}>{GAME_STATUSES.map((status) => <option value={status} key={status}>{status.replace("_", " ")}</option>)}</select></label>
              <label>Primary genre<select value={identity.gameGenre} onChange={(event) => setIdentity((current) => ({ ...current, gameGenre: event.target.value as GameGenre | "" }))}><option value="">Not specified</option>{GAME_GENRES.map((genre) => <option value={genre} key={genre}>{GENRE_LABELS[genre]}</option>)}</select></label>
              <label>Release date<input type="date" min="2000-01-01" max="2100-12-31" value={identity.gameReleaseDate} onChange={(event) => setIdentity((current) => ({ ...current, gameReleaseDate: event.target.value }))} /></label>
              <label>Playable game or store link<input maxLength={256} inputMode="url" placeholder="https://" value={identity.gameUrl} onChange={(event) => setIdentity((current) => ({ ...current, gameUrl: event.target.value }))} /></label>
              <label className="creatorIdentityWide">Trailer or gameplay link<input maxLength={256} inputMode="url" placeholder="https://" value={identity.trailerUrl} onChange={(event) => setIdentity((current) => ({ ...current, trailerUrl: event.target.value }))} /></label>
              <fieldset className="creatorGamePlatforms creatorIdentityWide"><legend>Available platforms</legend><div>{GAME_PLATFORMS.map((platform) => <label className={identity.gamePlatforms.includes(platform) ? "selected" : ""} key={platform}><input type="checkbox" checked={identity.gamePlatforms.includes(platform)} onChange={() => toggleGamePlatform(platform)} /><span>{PLATFORM_LABELS[platform]}</span></label>)}</div></fieldset>
              <fieldset className="creatorGamePlatforms creatorIdentityWide"><legend>Play modes</legend><div>{GAME_MODES.map((mode) => <label className={identity.gameModes.includes(mode) ? "selected" : ""} key={mode}><input type="checkbox" checked={identity.gameModes.includes(mode)} onChange={() => toggleGameMode(mode)} /><span>{MODE_LABELS[mode]}</span></label>)}</div></fieldset>
              <label className="creatorIdentityWide">Screenshot gallery<textarea maxLength={3077} placeholder={"One HTTPS or IPFS image URL per line\nUp to 6 images"} value={identity.gameMediaUris.join("\n")} onChange={(event) => setIdentity((current) => ({ ...current, gameMediaUris: event.target.value.split(/\r?\n/).slice(0, 7) }))} /><small>Up to six JPG, PNG, WebP or GIF images. SVG files are not accepted.</small></label>
            </>
          )}
        </div>
        <button type="submit" disabled={savingIdentity}>{savingIdentity ? "Saving identity…" : "Save public identity"}</button>
      </form>
      {isGaming && (
        <form className="creatorGameUpdateEditor" onSubmit={submitGameUpdate}>
          <div className="creatorIdentityHeading">
            <div><strong>Publish a development update</strong><p>Share a milestone, playtest or release with players following the public game page.</p></div>
            <span>CREATOR AUTHORED</span>
          </div>
          <div className="creatorGameUpdateFields">
            <label>Update type<select value={gameUpdate.type} onChange={(event) => setGameUpdate((current) => ({ ...current, type: event.target.value as GameUpdateType }))}>{GAME_UPDATE_TYPES.map((type) => <option value={type} key={type}>{UPDATE_TYPE_LABELS[type]}</option>)}</select></label>
            <label>Version or build<input maxLength={24} placeholder="Optional · v0.4.2" value={gameUpdate.version} onChange={(event) => setGameUpdate((current) => ({ ...current, version: event.target.value }))} /></label>
            <label className="creatorIdentityWide">Title<input maxLength={80} placeholder="What changed?" value={gameUpdate.title} onChange={(event) => setGameUpdate((current) => ({ ...current, title: event.target.value }))} /></label>
            <label className="creatorIdentityWide">Details<textarea maxLength={600} placeholder="Explain the milestone, playtest or release in plain language." value={gameUpdate.body} onChange={(event) => setGameUpdate((current) => ({ ...current, body: event.target.value }))} /></label>
            <label>Update link<input maxLength={256} inputMode="url" placeholder="Optional · https://" value={gameUpdate.link} onChange={(event) => setGameUpdate((current) => ({ ...current, link: event.target.value }))} /></label>
            <label>Artwork or screenshot<input maxLength={512} inputMode="url" placeholder="Optional · https:// or ipfs://" value={gameUpdate.imageUri} onChange={(event) => setGameUpdate((current) => ({ ...current, imageUri: event.target.value }))} /></label>
          </div>
          <button type="submit" disabled={publishingUpdate}>{publishingUpdate ? "Publishing update…" : "Publish development update"}</button>
          <p>Updates become public immediately under the assigned creator identity. External links and files remain creator-supplied.</p>
          {updateMessage && <p className="creatorControlMessage" role="status">{updateMessage}</p>}
        </form>
      )}
      <div className="creatorCapabilityHeading"><strong>Optional project modules</strong><span>SEPARATE REVIEW</span></div>
      <div className="creatorControlGrid">
        {PROJECT_MODULES.filter((module) => assignment.allowedModules.includes(module)).map((module) => {
          const request = requests[module];
          return (
            <article className={request ? `request-${request.status}` : ""} key={module}>
              <div><strong>{MODULE_COPY[module].label}</strong><span>{request ? request.status.toUpperCase() : "AVAILABLE"}</span></div>
              <p>{MODULE_COPY[module].description}</p>
              {request?.reviewNote && <small className="creatorModuleReviewNote">{request.reviewNote}</small>}
              <button
                type="button"
                disabled={Boolean(request) || busyModule === module}
                onClick={() => void requestActivation(module)}
              >
                {busyModule === module ? "Saving request…" : requestLabel(request)}
              </button>
            </article>
          );
        })}
      </div>
      <p className="creatorControlBoundary">Activation pricing, contract configuration and transaction details will be shown for explicit approval only after review. Nothing is automatic.</p>
      {message && <p className="creatorControlMessage" role="status">{message}</p>}
    </section>
  );
}
