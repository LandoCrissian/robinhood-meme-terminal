"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import {
  recordCreatorMediaTakedownDecision,
  subscribeToAdminCreatorMediaLifecycle
} from "../../../lib/creator-media-lifecycle-admin-cloud";
import type { CreatorMediaAvailabilityStatus } from "../../../lib/creator-media-availability";
import {
  type CreatorMediaTakedownDecision,
  type CreatorMediaTakedownOutcome,
  type CreatorMediaTakedownRequest
} from "../../../lib/creator-media-takedown";

export function CreatorMediaLifecycleInbox({ admin }: { admin: User }) {
  const [requests, setRequests] = useState<CreatorMediaTakedownRequest[]>([]);
  const [decisions, setDecisions] = useState<CreatorMediaTakedownDecision[]>([]);
  const [availability, setAvailability] = useState<CreatorMediaAvailabilityStatus[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToAdminCreatorMediaLifecycle(admin, (next) => {
      if (!active) return;
      setRequests(next.requests);
      setDecisions(next.decisions);
      setAvailability(next.availability);
    }, () => {
      if (active) setMessage("Provider lifecycle records are temporarily unavailable.");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => {
      if (active) setMessage("Provider lifecycle records are temporarily unavailable.");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [admin]);

  const decisionsByRequest = useMemo(
    () => new Map(decisions.map((decision) => [decision.requestId, decision])),
    [decisions]
  );
  const availabilityByReceipt = useMemo(
    () => new Map(availability.map((status) => [status.receiptId, status])),
    [availability]
  );

  const decide = async (requestId: string, outcome: CreatorMediaTakedownOutcome) => {
    const reviewNote = notes[requestId] ?? "";
    if (reviewNote.trim().length < 10) {
      setMessage("Every immutable lifecycle decision requires a clear review note.");
      return;
    }
    setBusy(requestId);
    setMessage("");
    try {
      await recordCreatorMediaTakedownDecision({ admin, requestId, outcome, reviewNote });
      setMessage("Immutable lifecycle decision recorded. Provider deletion remains disabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The lifecycle decision could not be recorded.");
    } finally {
      setBusy("");
    }
  };

  const attention = availability.filter((status) => status.overallState !== "healthy");
  return (
    <section className="adminActivationSection adminMediaLifecycleSection">
      <header className="adminReviewHeader">
        <div>
          <p className="eyebrow">PRIVATE PROVIDER OPERATIONS</p>
          <h2>Media availability + takedown review</h2>
          <p>Monitor RMT&apos;s Pinata record and bounded public retrieval. Review creator requests without claiming IPFS erasure or automatically deleting provider files.</p>
        </div>
        <span>{requests.filter((request) => !decisionsByRequest.has(request.requestId)).length} OPEN · {attention.length} ATTENTION</span>
      </header>
      <div className="adminApplicationList">
        {requests.map((request) => {
          const decision = decisionsByRequest.get(request.requestId);
          const status = availabilityByReceipt.get(request.receiptId);
          const requestBusy = busy === request.requestId;
          return <article className="adminApplicationCard" key={request.requestId}>
            <header>
              <div>
                <span>{decision?.outcome.replaceAll("_", " ") ?? "awaiting review"}</span>
                <h2>{request.projectSlug}</h2>
                <p>{request.reasonCode.replaceAll("_", " ")} · asset {request.assetId}</p>
              </div>
              <code>{request.requestHash.slice(0, 12)}…{request.requestHash.slice(-8)}</code>
            </header>
            <p className="adminApplicationSummary">{request.requestNote}</p>
            <dl>
              <dt>Provider action</dt><dd>Unpin RMT provider copy</dd>
              <dt>Erasure</dt><dd>Not guaranteed; IPFS content may remain elsewhere</dd>
              <dt>Latest check</dt><dd>{status
                ? `${status.overallState} · provider ${status.providerState} · gateway ${status.gatewayState}`
                : "Awaiting first scheduled check"}</dd>
              <dt>Execution</dt><dd>Disabled</dd>
            </dl>
            {decision
              ? <p className="adminReviewMessage">{decision.reviewNote} · No provider deletion executed.</p>
              : <div className="adminReviewControls">
                <label>Immutable review note<textarea maxLength={1_000} value={notes[request.requestId] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [request.requestId]: event.target.value }))} /></label>
                <div>
                  <button className="adminApproveButton" type="button" disabled={requestBusy} onClick={() => void decide(request.requestId, "approved_for_future_execution")}>Approve policy request</button>
                  <button className="adminRejectButton" type="button" disabled={requestBusy} onClick={() => void decide(request.requestId, "rejected")}>Reject request</button>
                </div>
              </div>}
          </article>;
        })}
        {requests.length === 0 && <section className="panel adminAccessState"><h2>No takedown requests</h2><p>The daily availability monitor remains separate from creator requests.</p></section>}
      </div>
      {attention.length > 0 && <div className="adminApplicationList adminMediaAttentionList">
        {attention.map((status) => <article className="adminApplicationCard" key={status.receiptId}>
          <header><div><span>{status.overallState}</span><h2>{status.projectSlug}</h2><p>Receipt {status.receiptId.slice(0, 12)}…</p></div><code>{status.observationHash.slice(0, 12)}…</code></header>
          <dl>
            <dt>Provider</dt><dd>{status.providerState}</dd>
            <dt>Gateway</dt><dd>{status.gatewayState}</dd>
            <dt>Failures</dt><dd>{status.consecutiveFailures} consecutive observations</dd>
            <dt>Evidence</dt><dd>{status.checksPassed}/{status.checksAttempted} checks passed · {status.failureCode || "none"}</dd>
          </dl>
        </article>)}
      </div>}
      {message && <p className="adminReviewMessage" role="status">{message}</p>}
    </section>
  );
}
