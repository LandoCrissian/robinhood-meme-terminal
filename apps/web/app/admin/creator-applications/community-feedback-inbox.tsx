"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  parseAdminCommunityFeedback,
  type AdminCommunityFeedback,
  type CommunityFeedbackStatus
} from "../../../lib/community-feedback";

async function feedbackRequest(user: User, body: Record<string, unknown>) {
  const token = await user.getIdToken();
  const response = await fetch("/api/admin/community/feedback", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Feedback request failed.");
  return result ?? {};
}

const NEXT: Record<CommunityFeedbackStatus, CommunityFeedbackStatus[]> = {
  submitted: ["under_review", "planned", "closed"],
  under_review: ["planned", "closed"],
  planned: ["shipped", "closed"],
  shipped: [],
  closed: []
};

export function CommunityFeedbackInbox({ admin }: { admin: User }) {
  const [feedback, setFeedback] = useState<AdminCommunityFeedback[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void feedbackRequest(admin, { operation: "list" }).then((result) => {
      if (!active) return;
      const values = Array.isArray(result.feedback) ? result.feedback : [];
      setFeedback(values.map(parseAdminCommunityFeedback).filter((value): value is AdminCommunityFeedback => Boolean(value)));
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "The feedback queue could not be loaded.");
    });
    return () => { active = false; };
  }, [admin]);

  const review = async (item: AdminCommunityFeedback, status: CommunityFeedbackStatus) => {
    const reviewNote = (notes[item.feedbackId] ?? "").trim();
    if (reviewNote.length < 5) {
      setMessage("Add a short internal note before changing feedback status.");
      return;
    }
    setBusy(item.feedbackId);
    setMessage("");
    try {
      await feedbackRequest(admin, {
        operation: "review",
        feedbackId: item.feedbackId,
        status,
        reviewNote
      });
      setFeedback((current) => current.map((candidate) => candidate.feedbackId === item.feedbackId
        ? { ...candidate, status, reviewNote }
        : candidate));
      setMessage(`Feedback moved to ${status.replace("_", " ")}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The feedback decision could not be recorded.");
    } finally {
      setBusy("");
    }
  };

  const openCount = feedback.filter((item) => item.status !== "shipped" && item.status !== "closed").length;
  return <section className="adminActivationSection" aria-labelledby="community-feedback-title">
    <header className="adminReviewHeader">
      <div><p className="eyebrow">PRODUCT SIGNAL</p><h2 id="community-feedback-title">RMT feedback</h2><p>Review private user submissions and move only the public status marker. Reporter identity and full details remain private.</p></div>
      <span>{openCount} OPEN</span>
    </header>
    <div className="adminApplicationList">
      {feedback.length === 0 && <section className="panel adminAccessState"><h2>No feedback yet</h2><p>Structured RMT Live submissions will appear here.</p></section>}
      {feedback.map((item) => <article className={`adminApplicationCard status-${item.status}`} key={item.feedbackId}>
        <header><div><span>{item.status.replace("_", " ")}</span><h2>{item.title}</h2><p>{item.category.replace("_", " ")} · {item.identityKind} · {new Date(item.createdAt).toLocaleString()}</p></div></header>
        <p className="adminApplicationSummary">{item.description}</p>
        {NEXT[item.status].length > 0 && <div className="adminReviewControls">
          <label>Private review note<textarea maxLength={240} value={notes[item.feedbackId] ?? item.reviewNote} onChange={(event) => setNotes((current) => ({ ...current, [item.feedbackId]: event.target.value }))} /></label>
          <div>{NEXT[item.status].map((status) => <button className={status === "closed" ? "adminRejectButton" : "adminApproveButton"} type="button" disabled={busy === item.feedbackId} key={status} onClick={() => void review(item, status)}>{status.replace("_", " ")}</button>)}</div>
        </div>}
        {NEXT[item.status].length === 0 && <p className="adminReviewMessage">{item.reviewNote || "Terminal status."}</p>}
      </article>)}
    </div>
    {message && <p className="adminReviewMessage" role="status">{message}</p>}
  </section>;
}
