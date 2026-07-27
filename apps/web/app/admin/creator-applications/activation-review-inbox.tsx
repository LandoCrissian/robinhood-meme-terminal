"use client";

import type { User } from "firebase/auth";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  reviewModuleActivationRequest,
  subscribeToAdminModuleActivationRequests,
  type AdminModuleActivationRequest
} from "../../../lib/creator-application-cloud";
import type { ModuleActivationRequestStatus } from "../../../lib/project-ownership";

const MODULE_LABELS = {
  token: "Token",
  nft: "NFT collection",
  marketplace: "Marketplace",
  music: "Music"
} as const;

function requestKey(request: AdminModuleActivationRequest) {
  return `${request.projectSlug}:${request.module}`;
}

export function ActivationReviewInbox({ admin }: { admin: User }) {
  const [requests, setRequests] = useState<AdminModuleActivationRequest[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    void subscribeToAdminModuleActivationRequests(admin, (next) => {
      if (!active) return;
      setRequests(next);
      setNotes((current) => {
        const copy = { ...current };
        for (const request of next) copy[requestKey(request)] ??= request.reviewNote ?? "";
        return copy;
      });
      setLoading(false);
    }, () => {
      if (!active) return;
      setMessage("The private activation review queue could not be loaded.");
      setLoading(false);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch((error) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : "The private activation review queue could not be loaded.");
      setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [admin]);

  const activeCount = useMemo(
    () => requests.filter((request) => request.status === "requested" || request.status === "reviewing").length,
    [requests]
  );

  const review = async (
    request: AdminModuleActivationRequest,
    status: Exclude<ModuleActivationRequestStatus, "requested">
  ) => {
    const key = requestKey(request);
    const note = notes[key] ?? "";
    if (status !== "reviewing" && note.trim().length < 10) {
      setMessage("Ready and declined decisions require a clear private review note.");
      return;
    }
    setBusyKey(key);
    setMessage("");
    try {
      await reviewModuleActivationRequest({ admin, request, status, reviewNote: note });
      setMessage(`${request.projectSlug} · ${MODULE_LABELS[request.module]} moved to ${status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The module review decision could not be saved.");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <section className="adminActivationSection" aria-labelledby="activation-review-title">
      <header className="adminReviewHeader">
        <div><p className="eyebrow">PRIVATE MODULE OPERATIONS</p><h2 id="activation-review-title">Activation reviews</h2><p>Process creator requests without deploying contracts or collecting fees. “Ready” means the request may proceed to explicit configuration—not that a module is live.</p></div>
        <span>{activeCount} ACTIVE</span>
      </header>

      {loading ? (
        <section className="panel adminAccessState"><h2>Loading activation requests…</h2></section>
      ) : requests.length === 0 ? (
        <section className="panel adminAccessState"><h2>No activation requests yet</h2><p>Creator module requests will appear here after an approved project owner submits one.</p></section>
      ) : (
        <div className="adminActivationGrid">
          {requests.map((request) => {
            const key = requestKey(request);
            const busy = busyKey === key;
            return (
              <article className={`adminActivationCard request-${request.status}`} key={key}>
                <header>
                  <div><span>{request.status}</span><h3>{MODULE_LABELS[request.module]}</h3><p>{request.projectSlug}</p></div>
                  <Link href={`/project/${request.projectSlug}`}>Project page ↗</Link>
                </header>
                <label>Private review note<textarea maxLength={600} disabled={request.status === "ready" || request.status === "declined"} value={notes[key] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [key]: event.target.value }))} placeholder="Configuration requirements, rights checks, or reason for decision" /></label>
                {request.status === "requested" && (
                  <button type="button" disabled={busy} onClick={() => void review(request, "reviewing")}>Begin review</button>
                )}
                {request.status === "reviewing" && (
                  <div><button className="adminApproveButton" type="button" disabled={busy} onClick={() => void review(request, "ready")}>Mark ready</button><button className="adminRejectButton" type="button" disabled={busy} onClick={() => void review(request, "declined")}>Decline</button></div>
                )}
                {(request.status === "ready" || request.status === "declined") && <p>{request.reviewNote || "Decision saved."}</p>}
              </article>
            );
          })}
        </div>
      )}
      {message && <p className="adminReviewMessage" role="status">{message}</p>}
    </section>
  );
}
