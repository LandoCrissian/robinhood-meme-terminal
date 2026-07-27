"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import {
  PROJECT_MODULES,
  normalizeProjectIdentity,
  validateProjectIdentity,
  type ProjectIdentityDraft,
  type PublicProjectRecord,
  type RequestedProjectModule
} from "../lib/creator-application";
import {
  requestModuleActivation,
  subscribeToModuleActivationRequests,
  subscribeToProjectAssignment,
  updateProjectIdentity
} from "../lib/creator-application-cloud";
import type {
  ModuleActivationRequest,
  ProjectAssignment
} from "../lib/project-ownership";
import { useProfile } from "./profile-provider";

const MODULE_COPY: Record<RequestedProjectModule, { label: string; description: string }> = {
  token: { label: "Token", description: "Prepare verified token identity, market connections and trading surfaces." },
  nft: { label: "NFT collection", description: "Plan collection contracts, artwork provenance, rights and creator splits." },
  marketplace: { label: "Marketplace", description: "Plan listings, offers, settlement rules and creator-controlled market access." },
  music: { label: "Music", description: "Plan releases, licenses, collaborator splits and collectible media." }
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
  const [message, setMessage] = useState("");
  const [identity, setIdentity] = useState<ProjectIdentityDraft>(() => normalizeProjectIdentity(project));

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
    <section className="panel creatorControlPanel" aria-labelledby="creator-control-title">
      <header>
        <div><p className="eyebrow">PRIVATE CREATOR WORKSPACE</p><h2 id="creator-control-title">Manage project identity and capabilities</h2><p>This profile is assigned to the project. Presentation updates are public; module requests begin a separate RMT review and do not deploy contracts, charge fees or grant wallet authority.</p></div>
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
        </div>
        <button type="submit" disabled={savingIdentity}>{savingIdentity ? "Saving identity…" : "Save public identity"}</button>
      </form>
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
