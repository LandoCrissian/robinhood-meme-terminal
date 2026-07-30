"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  parseAdminCommunityReport,
  type AdminCommunityReport
} from "../../../lib/community-moderation";

async function moderationRequest(user: User, body: Record<string, unknown>) {
  const token = await user.getIdToken();
  const response = await fetch("/api/admin/community/moderation", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Moderation request failed.");
  return result ?? {};
}

export function CommunityModerationInbox({ admin }: { admin: User }) {
  const [reports, setReports] = useState<AdminCommunityReport[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setMessage("");
    try {
      const result = await moderationRequest(admin, { operation: "list" });
      const values = Array.isArray(result.reports) ? result.reports : [];
      setReports(values.map(parseAdminCommunityReport).filter((value): value is AdminCommunityReport => Boolean(value)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The moderation queue could not be loaded.");
    }
  };

  useEffect(() => {
    void load();
  // The Firebase User instance is stable for the signed-in session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  const review = async (
    report: AdminCommunityReport,
    action: "dismiss" | "hide",
    restrictionMinutes: 0 | 60 | 1_440
  ) => {
    const reviewNote = (notes[report.reportId] ?? "").trim();
    if (reviewNote.length < 5) {
      setMessage("Add a short review note before recording the decision.");
      return;
    }
    setBusy(report.reportId);
    setBusyAction(`${action}:${restrictionMinutes}`);
    setMessage("");
    try {
      await moderationRequest(admin, {
        operation: "review",
        reportId: report.reportId,
        action,
        restrictionMinutes,
        reviewNote
      });
      setReports((current) => current.filter((item) => item.reportId !== report.reportId));
      setMessage(action === "dismiss" ? "Report dismissed with an audit record." : "Message hidden and action recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The moderation action could not be recorded.");
    } finally {
      setBusy("");
      setBusyAction("");
    }
  };

  return <section className="adminActivationSection" aria-labelledby="community-moderation-title">
    <header className="adminReviewHeader">
      <div><p className="eyebrow">RMT LIVE SAFETY</p><h2 id="community-moderation-title">Community reports</h2><p>Review private reports. Hiding removes the message from public queries; restrictions affect posting only and never wallets, profiles, rankings, or trading.</p></div>
      <span>{reports.length} PENDING</span>
    </header>
    {message && <p className="adminReviewMessage" role="status" aria-live="polite">{message}</p>}
    <div className="adminApplicationList">
      {reports.length === 0 && <section className="panel adminAccessState"><h2>No pending reports</h2><p>The private moderation queue is clear.</p></section>}
      {reports.map((report) => <article className="adminApplicationCard" key={report.reportId}>
        <header><div><span>{report.reason.replace("_", " ")}</span><h2>{report.authorLabel}</h2><p>{new Date(report.createdAt).toLocaleString()}</p></div></header>
        <p className="adminApplicationSummary">{report.messageBody}</p>
        <div className="adminReviewControls">
          <label>Private review note<textarea maxLength={240} value={notes[report.reportId] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [report.reportId]: event.target.value }))} /></label>
          <div>
            <button type="button" disabled={busy === report.reportId} onClick={() => void review(report, "dismiss", 0)}>{busy === report.reportId && busyAction === "dismiss:0" ? "Dismissing…" : "Dismiss report"}</button>
            <button className="adminRejectButton" type="button" disabled={busy === report.reportId} onClick={() => void review(report, "hide", 0)}>{busy === report.reportId && busyAction === "hide:0" ? "Hiding…" : "Hide message"}</button>
            <button className="adminRejectButton" type="button" disabled={busy === report.reportId} onClick={() => void review(report, "hide", 60)}>{busy === report.reportId && busyAction === "hide:60" ? "Recording restriction…" : "Hide + restrict 1h"}</button>
            <button className="adminRejectButton" type="button" disabled={busy === report.reportId} onClick={() => void review(report, "hide", 1_440)}>{busy === report.reportId && busyAction === "hide:1440" ? "Recording restriction…" : "Hide + restrict 24h"}</button>
          </div>
        </div>
      </article>)}
    </div>
  </section>;
}
