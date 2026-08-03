"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  parseAdminCommunityMessage,
  type AdminCommunityMessage
} from "../../../lib/community-moderation";

const REASONS = [
  ["test_cleanup", "Test cleanup"],
  ["spam", "Spam"],
  ["scam", "Scam"],
  ["harassment", "Harassment"],
  ["unsafe_link", "Unsafe link"],
  ["private_information", "Private information"],
  ["other", "Other"]
] as const;

async function messageRequest(user: User, body: Record<string, unknown>) {
  const token = await user.getIdToken();
  const response = await fetch("/api/admin/community/moderation", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Message moderation request failed.");
  return result ?? {};
}

export function CommunityMessageManager({ admin }: { admin: User }) {
  const [messages, setMessages] = useState<AdminCommunityMessage[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    setNotice("");
    try {
      const result = await messageRequest(admin, { operation: "list_messages", roomId: "global" });
      const values = Array.isArray(result.messages) ? result.messages : [];
      setMessages(values.map(parseAdminCommunityMessage).filter((value): value is AdminCommunityMessage => Boolean(value)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Recent RMT Live messages could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  // The Firebase User instance is stable for the signed-in session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  const hide = async (message: AdminCommunityMessage) => {
    const reason = reasons[message.messageId] ?? "";
    if (!reason) {
      setNotice("Choose a removal reason before hiding a message.");
      return;
    }
    setBusy(message.messageId);
    setNotice("");
    try {
      await messageRequest(admin, {
        operation: "hide_message",
        roomId: message.roomId,
        messageId: message.messageId,
        reason
      });
      setMessages((current) => current.filter((item) => item.messageId !== message.messageId));
      setNotice("Message removed from RMT Live. A private moderation record was retained.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The message could not be hidden.");
    } finally {
      setBusy("");
    }
  };

  return <section className="adminActivationSection adminMessageManager" id="live-messages" aria-labelledby="live-messages-title">
    <header className="adminReviewHeader">
      <div>
        <p className="eyebrow">RMT LIVE CONTROL</p>
        <h2 id="live-messages-title">Live messages</h2>
        <p>Review the latest public posts directly. Hiding removes a message from RMT Live immediately and keeps a private, expiring audit record.</p>
      </div>
      <div className="adminHeaderActions">
        <span>{messages.length} VISIBLE</span>
        <button type="button" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button>
      </div>
    </header>
    {notice && <p className="adminReviewMessage" role="status" aria-live="polite">{notice}</p>}
    <div className="adminApplicationList">
      {!loading && messages.length === 0 && <section className="panel adminAccessState"><h2>No visible messages</h2><p>RMT Live is currently clear.</p></section>}
      {messages.map((message) => <article className="adminApplicationCard adminMessageCard" key={message.messageId}>
        <header>
          <div>
            <span>{message.authorKind}</span>
            <h2>{message.authorLabel}{message.authorHandle ? ` · @${message.authorHandle}` : ""}</h2>
            <p>{new Date(message.createdAt).toLocaleString()} · {message.roomId}</p>
          </div>
        </header>
        <p className="adminApplicationSummary">{message.messageBody}</p>
        <div className="adminMessageControls">
          <label>
            Removal reason
            <select value={reasons[message.messageId] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [message.messageId]: event.target.value }))}>
              <option value="">Choose a reason</option>
              {REASONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <button className="adminRejectButton" type="button" disabled={busy === message.messageId || !(reasons[message.messageId] ?? "")} onClick={() => void hide(message)}>
            {busy === message.messageId ? "Removing…" : "Hide from RMT Live"}
          </button>
        </div>
      </article>)}
    </div>
  </section>;
}
