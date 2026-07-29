"use client";

import type { User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import {
  CREATOR_RELEASE_REASON_CODES,
  type CreatorReleaseOutcome,
  type CreatorReleaseReasonCode,
  type CreatorReleaseDecision
} from "../../../lib/creator-release-decision";
import {
  recordCreatorReleaseDecision,
  subscribeToAdminReleaseDecisions,
  subscribeToAdminReleaseReviews
} from "../../../lib/creator-release-admin-cloud";
import type { CreatorReleaseReview } from "../../../lib/creator-release-review";

const REASON_LABELS: Record<CreatorReleaseReasonCode, string> = {
  preparation_complete: "Preparation complete",
  rights_or_provenance: "Rights or provenance",
  consent_or_splits: "Consent or splits",
  media_or_metadata: "Media or metadata",
  economics_or_policy: "Economics or policy",
  other: "Other"
};

export function ReleaseReviewInbox({ admin }: { admin: User }) {
  const [reviews, setReviews] = useState<CreatorReleaseReview[]>([]);
  const [decisions, setDecisions] = useState<CreatorReleaseDecision[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, CreatorReleaseReasonCode>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let active = true;
    void subscribeToAdminReleaseReviews(admin, setReviews, () => active && setMessage("Release-review snapshots are unavailable."))
      .then((cleanup) => active ? cleanups.push(cleanup) : cleanup())
      .catch(() => active && setMessage("Release-review snapshots are unavailable."));
    void subscribeToAdminReleaseDecisions(admin, setDecisions, () => active && setMessage("Release-review decisions are unavailable."))
      .then((cleanup) => active ? cleanups.push(cleanup) : cleanup())
      .catch(() => active && setMessage("Release-review decisions are unavailable."));
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [admin]);

  const decisionsByReview = useMemo(
    () => new Map(decisions.map((decision) => [decision.reviewId, decision])),
    [decisions]
  );

  const decide = async (review: CreatorReleaseReview, outcome: CreatorReleaseOutcome) => {
    const reasonCode = outcome === "preparation_ready"
      ? "preparation_complete"
      : reasons[review.reviewId] ?? "other";
    const reviewNote = notes[review.reviewId] ?? "";
    if (reviewNote.trim().length < 10) {
      setMessage("Every immutable decision requires a clear review note.");
      return;
    }
    setBusy(review.reviewId);
    setMessage("");
    try {
      await recordCreatorReleaseDecision({ admin, review, outcome, reasonCode, reviewNote });
      setMessage("Immutable preparation decision recorded. Contract execution remains disabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The decision could not be recorded.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="adminActivationSection adminReleaseReviewSection">
      <header className="adminReviewHeader">
        <div><p className="eyebrow">PRIVATE RELEASE REVIEW</p><h2>Immutable creator snapshots</h2><p>Review preparation evidence without approving minting, marketplace execution, fees, or deployment. Token-market fees remain 70% creator / 30% RMT; treasury use is a separate governed policy.</p></div>
        <span>{reviews.filter((review) => !decisionsByReview.has(review.reviewId)).length} OPEN</span>
      </header>
      <div className="adminApplicationList">
        {reviews.map((review) => {
          const decision = decisionsByReview.get(review.reviewId);
          const reviewBusy = busy === review.reviewId;
          return <article className="adminApplicationCard" key={review.reviewId}>
            <header><div><span>{decision?.outcome.replaceAll("_", " ") ?? "prepared"}</span><h2>{review.assetSnapshot.title}</h2><p>{review.projectSlug} · {review.assetSnapshot.assetType.replaceAll("_", " ")}</p></div><code>{review.reviewHash.slice(0, 12)}…{review.reviewHash.slice(-8)}</code></header>
            <dl>
              <dt>Revision</dt><dd>{review.draftRevisionHash.slice(0, 12)}…</dd>
              <dt>Consent</dt><dd>{review.acceptedConsentManifest.length} accepted receipts</dd>
              <dt>Economics</dt><dd>Simulation only · execution disabled</dd>
              <dt>Token fees</dt><dd>70% creator / 30% RMT treasury</dd>
            </dl>
            {decision ? <p className="adminReviewMessage">{REASON_LABELS[decision.reasonCode]} · {decision.reviewNote}</p> : <div className="adminReviewControls">
              <label>Reason<select value={reasons[review.reviewId] ?? "other"} onChange={(event) => setReasons((current) => ({ ...current, [review.reviewId]: event.target.value as CreatorReleaseReasonCode }))}>{CREATOR_RELEASE_REASON_CODES.filter((reason) => reason !== "preparation_complete").map((reason) => <option value={reason} key={reason}>{REASON_LABELS[reason]}</option>)}</select></label>
              <label>Immutable review note<textarea maxLength={1000} value={notes[review.reviewId] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [review.reviewId]: event.target.value }))} /></label>
              <div>
                <button className="adminApproveButton" type="button" disabled={reviewBusy} onClick={() => void decide(review, "preparation_ready")}>Preparation ready</button>
                <button type="button" disabled={reviewBusy} onClick={() => void decide(review, "changes_requested")}>Request changes</button>
                <button className="adminRejectButton" type="button" disabled={reviewBusy} onClick={() => void decide(review, "declined")}>Decline</button>
              </div>
            </div>}
          </article>;
        })}
      </div>
      {message && <p className="adminReviewMessage" role="status">{message}</p>}
    </section>
  );
}
