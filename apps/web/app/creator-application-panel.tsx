"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  EMPTY_CREATOR_APPLICATION,
  PROJECT_MODULES,
  PROJECT_TYPES,
  validateCreatorApplication,
  type CreatorApplication,
  type CreatorApplicationDraft,
  type RequestedProjectModule
} from "../lib/creator-application";
import {
  submitCreatorApplication,
  subscribeToCreatorApplication
} from "../lib/creator-application-cloud";
import { useProfile } from "./profile-provider";

const TYPE_LABELS = {
  token: "Token project",
  art: "Art creator",
  music: "Music creator",
  gaming: "Game creator",
  community: "Community project",
  other: "Other"
} as const;

const MODULE_LABELS = {
  token: "Token",
  nft: "NFT collection",
  marketplace: "Marketplace",
  music: "Music",
  game: "Game showcase"
} as const;

function applicationDraft(application: CreatorApplication): CreatorApplicationDraft {
  return {
    projectName: application.projectName,
    summary: application.summary,
    projectType: application.projectType,
    website: application.website,
    xProfile: application.xProfile,
    tokenAddress: application.tokenAddress,
    requestedModules: application.requestedModules,
    ownershipConfirmed: application.ownershipConfirmed,
    termsAccepted: application.termsAccepted
  };
}

function statusCopy(application: CreatorApplication) {
  if (application.status === "approved") return "Approved and published";
  if (application.status === "needs_changes") return "Update requested";
  if (application.status === "rejected") return "Not approved";
  return "Private review";
}

export function CreatorApplicationPanel() {
  const { configured, user } = useProfile();
  const [application, setApplication] = useState<CreatorApplication | null>(null);
  const [draft, setDraft] = useState<CreatorApplicationDraft>(EMPTY_CREATOR_APPLICATION);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setApplication(null);
    setDraft(EMPTY_CREATOR_APPLICATION);
    setMessage("");
    if (!user) {
      setLoading(false);
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    void subscribeToCreatorApplication(user, (next) => {
      if (!active) return;
      setApplication(next);
      if (next?.status === "needs_changes") setDraft(applicationDraft(next));
      setLoading(false);
    }, () => {
      if (!active) return;
      setMessage("RMT could not load your application status.");
      setLoading(false);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch((error) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : "RMT could not load your application status.");
      setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [user]);

  const toggleModule = (module: RequestedProjectModule) => {
    setDraft((current) => ({
      ...current,
      requestedModules: current.requestedModules.includes(module)
        ? current.requestedModules.filter((candidate) => candidate !== module)
        : [...current.requestedModules, module]
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      setMessage("Sign in to your RMT profile before applying.");
      return;
    }
    const validation = validateCreatorApplication(draft);
    if (validation) {
      setMessage(validation);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await submitCreatorApplication(user, draft);
      setMessage("Application submitted privately for RMT review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Application could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  const locked = application && application.status !== "needs_changes";

  return (
    <section className="creatorApplicationSection" aria-labelledby="creator-application-title">
      <header className="creatorApplicationHeader">
        <div>
          <p className="eyebrow">PROJECT ACCESS</p>
          <h2 id="creator-application-title">Apply for an RMT project page</h2>
          <p>Projects, artists, musicians, game developers and communities can apply. A token is optional unless you request the Token module.</p>
        </div>
        <span>REVIEW REQUIRED</span>
      </header>

      {!configured ? (
        <div className="creatorApplicationState"><strong>Firebase setup required</strong><p>Project applications remain closed until secure profile storage is configured.</p></div>
      ) : !user ? (
        <div className="creatorApplicationState"><strong>Sign in to apply</strong><p>Use Google or any email provider in the profile control above. Applications are private and never grant wallet or transaction access.</p></div>
      ) : loading ? (
        <div className="creatorApplicationState"><strong>Loading application status…</strong></div>
      ) : application?.status === "approved" && application.projectSlug ? (
        <div className="creatorStudioDashboard">
          <header>
            <div><p className="eyebrow">RMT CREATOR STUDIO</p><h3>{application.projectName}</h3><p>Your approved page, public identity editor, audience tools and module requests now live in one owner workspace.</p></div>
            <span>PAGE LIVE</span>
          </header>
          <div className="creatorStudioPulse" aria-label="Creator Studio overview">
            <div><small>PAGE</small><strong>APPROVED</strong><span>Public and discoverable</span></div>
            <div><small>MODULE LANES</small><strong>{application.requestedModules.length}</strong><span>Review-gated capabilities</span></div>
            <div><small>TOKEN</small><strong>{application.tokenAddress ? "LINKED" : "OPTIONAL"}</strong><span>{application.tokenAddress ? "Declared during review" : "No token required"}</span></div>
          </div>
          <div className="creatorStudioModules" aria-label="Approved project module lanes">
            {application.requestedModules.map((module) => <span key={module}>{MODULE_LABELS[module]}</span>)}
          </div>
          <nav aria-label={`${application.projectName} creator actions`}>
            <Link className="creatorStudioPrimary" href={`/project/${application.projectSlug}#creator-studio`}>Open Creator Studio →</Link>
            <Link href={`/project/${application.projectSlug}`}>View public page</Link>
          </nav>
          <p className="creatorStudioBoundary">Page editing never grants wallet authority. Module review does not deploy a contract, charge a fee or activate a marketplace automatically.</p>
        </div>
      ) : locked ? (
        <div className={`creatorApplicationState application-${application.status}`}>
          <div><span>{statusCopy(application)}</span><strong>{application.projectName}</strong></div>
          {application.reviewNote && <p>{application.reviewNote}</p>}
          <p>{application.status === "pending"
              ? "Only you and the RMT review account can see this application."
              : "This submission is closed. Contact RMT if material information has changed."}</p>
        </div>
      ) : (
        <form className="creatorApplicationForm" onSubmit={submit}>
          {application?.status === "needs_changes" && (
            <div className="applicationReviewNote"><strong>RMT requested an update</strong><p>{application.reviewNote || "Review the information below and resubmit."}</p></div>
          )}
          <div className="creatorApplicationFields">
            <label>Project or creator name<input required minLength={2} maxLength={80} value={draft.projectName} onChange={(event) => setDraft({ ...draft, projectName: event.target.value })} /></label>
            <label>Project type<select value={draft.projectType} onChange={(event) => setDraft({ ...draft, projectType: event.target.value as CreatorApplicationDraft["projectType"] })}>{PROJECT_TYPES.map((type) => <option value={type} key={type}>{TYPE_LABELS[type]}</option>)}</select></label>
            <label className="applicationWideField">What are you building?<textarea required minLength={40} maxLength={600} placeholder="Explain the product, community or creative work, who it serves, and what you want to activate on RMT." value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
            <label>Website · optional<input inputMode="url" maxLength={256} placeholder="https://" value={draft.website} onChange={(event) => setDraft({ ...draft, website: event.target.value })} /></label>
            <label>X profile · optional<input inputMode="url" maxLength={256} placeholder="https://x.com/…" value={draft.xProfile} onChange={(event) => setDraft({ ...draft, xProfile: event.target.value })} /></label>
            <label className="applicationWideField">Token contract · required only for Token<input maxLength={42} placeholder="0x…" value={draft.tokenAddress} onChange={(event) => setDraft({ ...draft, tokenAddress: event.target.value })} /></label>
          </div>

          <fieldset className="applicationModuleChoices">
            <legend>Requested project modules</legend>
            <div>{PROJECT_MODULES.map((module) => <label className={draft.requestedModules.includes(module) ? "selected" : ""} key={module}><input type="checkbox" checked={draft.requestedModules.includes(module)} onChange={() => toggleModule(module)} /><strong>{MODULE_LABELS[module]}</strong><span>{module === "token" ? "Verified market identity and trading" : module === "game" ? "Playable links, trailers and platform discovery" : "Optional creator-controlled activation"}</span></label>)}</div>
          </fieldset>

          <div className="applicationConfirmations">
            <label><input type="checkbox" checked={draft.ownershipConfirmed} onChange={(event) => setDraft({ ...draft, ownershipConfirmed: event.target.checked })} /><span>I am authorized to represent this project and submit its public information.</span></label>
            <label><input type="checkbox" checked={draft.termsAccepted} onChange={(event) => setDraft({ ...draft, termsAccepted: event.target.checked })} /><span>I understand approval is discretionary, does not imply endorsement, and does not activate contracts or fees.</span></label>
          </div>

          <div className="creatorApplicationSubmit">
            <button type="submit" disabled={busy}>{busy ? "Submitting…" : application ? "Resubmit for review" : "Submit private application"}</button>
            <p>One application per verified profile. Pending submissions cannot be edited.</p>
          </div>
        </form>
      )}
      {message && <p className="creatorApplicationMessage" role="status">{message}</p>}
    </section>
  );
}
