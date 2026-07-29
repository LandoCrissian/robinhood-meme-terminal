"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RMT_ADMIN_EMAIL, normalizeProjectSlug } from "../../../lib/creator-application";
import {
  reviewCreatorApplication,
  subscribeToAdminApplications,
  type AdminCreatorApplication
} from "../../../lib/creator-application-cloud";
import { useProfile } from "../../profile-provider";
import { ActivationReviewInbox } from "./activation-review-inbox";
import { ReleaseReviewInbox } from "./release-review-inbox";

type ReviewDraft = { note: string; slug: string };

export default function CreatorApplicationAdminPage() {
  const { configured, loading: profileLoading, user } = useProfile();
  const [applications, setApplications] = useState<AdminCreatorApplication[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const isAdmin = Boolean(user?.emailVerified && user.email?.toLowerCase() === RMT_ADMIN_EMAIL);

  useEffect(() => {
    setApplications([]);
    setMessage("");
    if (!user || !isAdmin) {
      setLoading(false);
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    void subscribeToAdminApplications(user, (next) => {
      if (!active) return;
      setApplications(next);
      setDrafts((current) => {
        const copy = { ...current };
        for (const application of next) {
          copy[application.userId] ??= {
            note: application.reviewNote ?? "",
            slug: application.projectSlug || normalizeProjectSlug(application.projectName)
          };
        }
        return copy;
      });
      setLoading(false);
    }, () => {
      if (!active) return;
      setMessage("The private review queue could not be loaded.");
      setLoading(false);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch((error) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : "The private review queue could not be loaded.");
      setLoading(false);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [isAdmin, user]);

  const pendingCount = useMemo(
    () => applications.filter((application) => application.status === "pending").length,
    [applications]
  );

  const updateDraft = (userId: string, update: Partial<ReviewDraft>) => {
    setDrafts((current) => ({
      ...current,
      [userId]: { ...(current[userId] ?? { note: "", slug: "" }), ...update }
    }));
  };

  const review = async (
    application: AdminCreatorApplication,
    status: "approved" | "needs_changes" | "rejected"
  ) => {
    if (!user || !isAdmin) return;
    const draft = drafts[application.userId] ?? { note: "", slug: "" };
    if (status !== "approved" && draft.note.trim().length < 10) {
      setMessage("Needs-changes and rejection decisions require a clear review note.");
      return;
    }
    setBusyId(application.userId);
    setMessage("");
    try {
      await reviewCreatorApplication({
        admin: user,
        application,
        status,
        reviewNote: draft.note,
        projectSlug: draft.slug
      });
      setMessage(status === "approved"
        ? `${application.projectName} is approved and public.`
        : `${application.projectName} was updated to ${status.replace("_", " ")}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The review decision could not be saved.");
    } finally {
      setBusyId("");
    }
  };

  if (!configured) return <main className="adminReviewPage"><section className="panel adminAccessState"><h1>Firebase is not configured</h1><p>The creator review queue remains closed.</p></section></main>;
  if (profileLoading) return <main className="adminReviewPage"><section className="panel adminAccessState"><h1>Checking administrator access…</h1></section></main>;
  if (!user || !isAdmin) return <main className="adminReviewPage"><section className="panel adminAccessState"><p className="eyebrow">PRIVATE RMT OPERATIONS</p><h1>Administrator access required</h1><p>Sign in through Profile with the verified RMT review account.</p><Link href="/profile">Open Profile →</Link></section></main>;

  return (
    <main className="adminReviewPage">
      <header className="adminReviewHeader">
        <div><p className="eyebrow">PRIVATE RMT OPERATIONS</p><h1>Creator applications</h1><p>Review private submissions. Approval publishes the project page and privately assigns its creator workspace; it does not deploy contracts, charge fees, or grant wallet authority.</p></div>
        <span>{pendingCount} PENDING</span>
      </header>

      {loading ? <section className="panel adminAccessState"><h2>Loading private queue…</h2></section> : (
        <div className="adminApplicationList">
          {applications.length === 0 && <section className="panel adminAccessState"><h2>No applications yet</h2><p>New verified-profile submissions will appear here.</p></section>}
          {applications.map((application) => {
            const draft = drafts[application.userId] ?? { note: "", slug: "" };
            const busy = busyId === application.userId;
            return (
              <article className={`adminApplicationCard status-${application.status}`} key={application.userId}>
                <header>
                  <div><span>{application.status.replace("_", " ")}</span><h2>{application.projectName}</h2><p>{application.projectType} · {application.contactEmail}</p></div>
                  {application.projectSlug && <Link href={`/project/${application.projectSlug}`}>Public page ↗</Link>}
                </header>
                <p className="adminApplicationSummary">{application.summary}</p>
                <dl>
                  <dt>Modules</dt><dd>{application.requestedModules.join(", ")}</dd>
                  <dt>Token</dt><dd>{application.tokenAddress || "Not requested"}</dd>
                  <dt>Website</dt><dd>{application.website ? <a href={application.website} target="_blank" rel="noreferrer">Open ↗</a> : "Not supplied"}</dd>
                  <dt>X</dt><dd>{application.xProfile ? <a href={application.xProfile} target="_blank" rel="noreferrer">Open ↗</a> : "Not supplied"}</dd>
                </dl>

                {application.status === "pending" && (
                  <div className="adminReviewControls">
                    <label>Public page slug<input value={draft.slug} maxLength={48} onChange={(event) => updateDraft(application.userId, { slug: normalizeProjectSlug(event.target.value) })} /></label>
                    <label>Review note<textarea maxLength={600} placeholder="Decision context or requested changes" value={draft.note} onChange={(event) => updateDraft(application.userId, { note: event.target.value })} /></label>
                    <div>
                      <button className="adminApproveButton" type="button" disabled={busy} onClick={() => void review(application, "approved")}>Approve & publish</button>
                      <button type="button" disabled={busy} onClick={() => void review(application, "needs_changes")}>Request changes</button>
                      <button className="adminRejectButton" type="button" disabled={busy} onClick={() => void review(application, "rejected")}>Reject</button>
                    </div>
                  </div>
                )}
                {application.status === "needs_changes" && (
                  <p className="adminReviewMessage">Waiting for the creator to resubmit the requested changes.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
      {message && <p className="adminReviewMessage" role="status">{message}</p>}
      <ActivationReviewInbox admin={user} />
      <ReleaseReviewInbox admin={user} />
    </main>
  );
}
