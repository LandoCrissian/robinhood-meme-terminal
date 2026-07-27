"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  PROJECT_MODULES,
  type PublicProjectRecord,
  type RequestedProjectModule
} from "../lib/creator-application";
import { subscribeToPublicProjects } from "../lib/creator-application-cloud";
import { OFFICIAL_RMT_V6_TOKEN } from "../lib/project-page";

const MODULE_LABELS: Record<RequestedProjectModule, string> = {
  token: "Token",
  nft: "NFT",
  marketplace: "Market",
  music: "Music"
};

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function publishedTime(value: unknown) {
  return value && typeof value === "object" && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function"
    ? (value as { toMillis: () => number }).toMillis()
    : 0;
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

  return (
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
            <div className="approvedDirectoryMark">{initials(project.name)}</div>
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
  );
}
