"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PROJECT_MODULES,
  type PublicProjectRecord,
  type RequestedProjectModule
} from "../lib/creator-application";
import {
  PRIVATE_FOLLOWING_LIMIT,
  setProjectFollow,
  subscribeToFollowedProjects
} from "../lib/project-follows";
import { ipfsToHttp } from "../lib/token-metadata";
import { useProfile } from "./profile-provider";

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

function FollowedProjectMark({ project }: { project: PublicProjectRecord }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="followedProjectMark" aria-hidden="true">
      {project.logoUri && !failed
        ? <img src={ipfsToHttp(project.logoUri)} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : initials(project.name)}
    </span>
  );
}

export function FollowedProjectsHub() {
  const { configured, loading: profileLoading, user } = useProfile();
  const [projects, setProjects] = useState<PublicProjectRecord[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "live" | "unavailable">("idle");
  const [removing, setRemoving] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setProjects([]);
    setMessage("");
    if (!user) {
      setStatus("idle");
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setStatus("loading");
    void subscribeToFollowedProjects(user, (next) => {
      if (!active) return;
      setProjects(next);
      setStatus("live");
    }, () => {
      if (active) setStatus("unavailable");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (active) setStatus("unavailable");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [user]);

  const unfollow = async (project: PublicProjectRecord) => {
    if (!user || removing) return;
    setRemoving(project.slug);
    setMessage("");
    try {
      await setProjectFollow(user, project.slug, false);
      setMessage(`${project.name} was removed from your private Following list.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be removed.");
    } finally {
      setRemoving("");
    }
  };

  return (
    <section className="followedProjectsHub" aria-labelledby="followed-projects-title">
      <header>
        <div>
          <p className="eyebrow">PRIVATE FOLLOWING</p>
          <h2 id="followed-projects-title">Projects you want close</h2>
          <p>Return to approved project pages from one private workspace. Your list is visible only to you.</p>
        </div>
        {user && status === "live" && <span>{projects.length} / {PRIVATE_FOLLOWING_LIMIT}</span>}
      </header>

      {profileLoading || (user && status === "loading") ? (
        <div className="followedProjectsState"><strong>Loading your followed projects…</strong><p>Checking your private RMT profile.</p></div>
      ) : !user ? (
        <div className="followedProjectsState">
          <strong>{configured ? "Sign in to build your private project desk." : "Private following is prepared."}</strong>
          <p>{configured ? "Follow approved pages, then return here from any device." : "Profile sign-in must be configured before followed projects can sync."}</p>
        </div>
      ) : status === "unavailable" ? (
        <div className="followedProjectsState"><strong>Your private list is temporarily unavailable.</strong><p>No follow records were changed. Refresh to try again.</p></div>
      ) : projects.length === 0 ? (
        <div className="followedProjectsState">
          <strong>Your Following desk is ready.</strong>
          <p>Open any approved project page and choose Follow project to add it here.</p>
          <Link href="/">Open the Terminal →</Link>
        </div>
      ) : (
        <div className="followedProjectsGrid">
          {projects.map((project) => (
            <article key={project.slug}>
              <div className="followedProjectIdentity">
                <FollowedProjectMark project={project} />
                <div><small>{project.projectType.toUpperCase()}</small><h3>{project.name}</h3></div>
              </div>
              <p>{project.summary}</p>
              <div className="followedProjectModules">
                {PROJECT_MODULES.filter((module) => project.availableModules.includes(module)).map((module) => (
                  <span key={module}>{MODULE_LABELS[module]}</span>
                ))}
              </div>
              <div className="followedProjectActions">
                <Link href={project.tokenAddress ? `/?market=${project.tokenAddress.toLowerCase()}` : "/"}>Open in Terminal →</Link>
                <button type="button" disabled={Boolean(removing)} onClick={() => void unfollow(project)}>
                  {removing === project.slug ? "Removing…" : "Unfollow"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {message && <p className="followedProjectsMessage" role="status">{message}</p>}
    </section>
  );
}
