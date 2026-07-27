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

const MODULE_COPY: Record<RequestedProjectModule, { label: string; description: string }> = {
  token: { label: "Token", description: "Project token identity and a future connection to RMT market discovery and trading." },
  nft: { label: "NFT collection", description: "Creator-controlled collections, AI-art provenance, editions, licenses and collaborator splits." },
  marketplace: { label: "Marketplace", description: "Optional listings, offers and settlement after reviewed creator activation." },
  music: { label: "Music", description: "Optional releases for artists and AI-music creators with explicit rights and splits." }
};

export function ApprovedProjectPage({ slug }: { slug: string }) {
  const [project, setProject] = useState<PublicProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

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

  return (
    <main className="detailPage approvedProjectPage">
      <div className="detailNav"><Link href="/explore">← Back to Explore</Link><span>APPROVED PROJECT · V{project.schemaVersion}</span></div>
      <section className="panel approvedProjectHero">
        <div className="approvedProjectMark" aria-hidden="true">{initials}</div>
        <div>
          <div className="tokenOriginLine"><p className="eyebrow">RMT PAGE · REVIEW APPROVED</p><span>{project.projectType} project</span></div>
          <h1>{project.name}</h1>
          <p>{project.summary}</p>
          <div className="approvedProjectLinks">
            {project.website && <a href={project.website} target="_blank" rel="noreferrer">Website ↗</a>}
            {project.xProfile && <a href={project.xProfile} target="_blank" rel="noreferrer">X ↗</a>}
          </div>
        </div>
      </section>

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
    </main>
  );
}
