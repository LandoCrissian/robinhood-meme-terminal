"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  PROJECT_MODULES,
  type RequestedProjectModule
} from "../lib/creator-application";
import {
  requestModuleActivation,
  subscribeToModuleActivationRequests,
  subscribeToProjectAssignment
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

export function ProjectCreatorControls({ slug }: { slug: string }) {
  const { loading: profileLoading, user } = useProfile();
  const [assignment, setAssignment] = useState<ProjectAssignment | null>(null);
  const [requests, setRequests] = useState<Partial<Record<RequestedProjectModule, ModuleActivationRequest>>>({});
  const [ownershipChecked, setOwnershipChecked] = useState(false);
  const [busyModule, setBusyModule] = useState<RequestedProjectModule | null>(null);
  const [message, setMessage] = useState("");

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
        <div><p className="eyebrow">PRIVATE CREATOR WORKSPACE</p><h2 id="creator-control-title">Manage project capabilities</h2><p>This profile is assigned to the project. Requests begin an RMT review only; they do not deploy contracts, charge fees or grant wallet authority.</p></div>
        <span>OWNER VERIFIED</span>
      </header>
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
