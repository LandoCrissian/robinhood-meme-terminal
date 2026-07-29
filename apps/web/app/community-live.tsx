"use client";

import { useEffect, useRef, useState } from "react";
import { GLOBAL_COMMUNITY_ROOM, type CommunityMessage } from "../lib/community";
import {
  COMMUNITY_REPORT_REASONS,
  type CommunityReportReason
} from "../lib/community-moderation";
import {
  COMMUNITY_FEEDBACK_CATEGORIES,
  type PublicCommunityFeedbackStatus,
  type CommunityFeedbackCategory
} from "../lib/community-feedback";
import {
  forgetCommunityFeedbackReceipt,
  readCommunityFeedbackReceiptIds,
  rememberCommunityFeedbackReceipt
} from "../lib/community-feedback-receipts";
import {
  ensureCommunityIdentity,
  postCommunityMessage,
  reportCommunityMessage,
  startCommunityPresence,
  submitCommunityFeedback,
  subscribeToCommunityFeedbackStatuses,
  subscribeToCommunityMessages
} from "../lib/community-cloud";

export function CommunityLive() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "feedback" | "updates">("chat");
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<number | null>(null);
  const [presenceCapped, setPresenceCapped] = useState(false);
  const [reportingId, setReportingId] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<CommunityFeedbackCategory>("bug");
  const [feedbackTitle, setFeedbackTitle] = useState("");
  const [feedbackDescription, setFeedbackDescription] = useState("");
  const [feedbackIds, setFeedbackIds] = useState<string[]>([]);
  const [feedbackStatuses, setFeedbackStatuses] = useState<PublicCommunityFeedbackStatus[]>([]);
  const stream = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFeedbackIds(readCommunityFeedbackReceiptIds());
  }, []);

  useEffect(() => {
    if (!open || view !== "updates" || feedbackIds.length === 0) {
      setFeedbackStatuses([]);
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToCommunityFeedbackStatuses(feedbackIds, (next) => {
      if (active) setFeedbackStatuses(next);
    }, () => {
      if (active) setMessage("Feedback updates are temporarily unavailable.");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "Feedback updates are unavailable.");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [feedbackIds, open, view]);

  useEffect(() => {
    if (!open || view !== "chat") return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeToCommunityMessages(GLOBAL_COMMUNITY_ROOM, (next) => {
      if (active) setMessages(next);
    }, () => {
      if (active) setMessage("RMT Live messages are temporarily unavailable.");
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "RMT Live is unavailable.");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [open, view]);

  useEffect(() => {
    if (!open) {
      setOnline(null);
      setPresenceCapped(false);
      return;
    }
    return startCommunityPresence(
      GLOBAL_COMMUNITY_ROOM,
      (count, capped) => {
        setOnline(count);
        setPresenceCapped(capped);
      },
      () => setOnline(null)
    );
  }, [open]);

  useEffect(() => {
    if (open) stream.current?.scrollTo({ top: stream.current.scrollHeight });
  }, [messages, open]);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await postCommunityMessage(body);
      setBody("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Message could not be posted.");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setMessage("");
    try {
      const user = await ensureCommunityIdentity();
      setMessage(user.isAnonymous ? "Guest identity ready." : "Member identity ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Community identity is unavailable.");
    } finally {
      setBusy(false);
    }
  };

  const report = async (messageId: string, reason: CommunityReportReason) => {
    if (reportBusy) return;
    setReportBusy(true);
    setMessage("");
    try {
      await reportCommunityMessage(messageId, reason);
      setReportingId("");
      setMessage("Report received. RMT will review it privately.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The report could not be recorded.");
    } finally {
      setReportBusy(false);
    }
  };

  const submitFeedback = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const feedbackId = await submitCommunityFeedback({
        category: feedbackCategory,
        title: feedbackTitle,
        description: feedbackDescription
      });
      setFeedbackIds(rememberCommunityFeedbackReceipt(feedbackId));
      setFeedbackTitle("");
      setFeedbackDescription("");
      setMessage(`Feedback received · ${feedbackId.slice(0, 8).toUpperCase()} · track it in Updates`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Feedback could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={`communityLive${open ? " open" : ""}`} aria-label="RMT Live community">
      <button className="communityLiveLauncher" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span aria-hidden="true">◌</span><b>Live</b>
      </button>
      {open && <section className="communityLivePanel">
        <header>
          <div><small>RMT COMMUNITY</small><strong>Live lounge</strong></div>
          <span title="Approximate number active in RMT Live during the last few minutes">
            {online === null ? "Presence unavailable" : `${presenceCapped ? "1K+" : `~${online}`} online`}
          </span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close RMT Live">×</button>
        </header>
        <div className="communityLiveNotice">Public room · guests are labeled · never share recovery words, private keys, or untrusted links.</div>
        <nav className="communityLiveViews" aria-label="RMT Live views">
          <button type="button" aria-current={view === "chat" ? "page" : undefined} onClick={() => { setView("chat"); setMessage(""); }}>Chat</button>
          <button type="button" aria-current={view === "feedback" ? "page" : undefined} onClick={() => { setView("feedback"); setMessage(""); }}>Feedback</button>
          <button type="button" aria-current={view === "updates" ? "page" : undefined} onClick={() => { setView("updates"); setMessage(""); }}>Updates</button>
        </nav>
        {view === "chat" && <><div className="communityLiveStream" ref={stream}>
          {messages.length === 0 && <div className="communityLiveEmpty"><strong>Start the conversation</strong><span>RMT Live is prepared locally and will open after secure Firebase activation.</span></div>}
          {messages.map((item) => <article key={item.messageId}>
            <header><strong>{item.authorLabel}</strong><span className={`kind-${item.authorKind}`}>{item.authorKind}</span>{item.authorHandle && <small>@{item.authorHandle}</small>}<button type="button" onClick={() => setReportingId((current) => current === item.messageId ? "" : item.messageId)}>Report</button></header>
            <p>{item.body}</p>
            {reportingId === item.messageId && <div className="communityReportReasons" aria-label="Report reason">
              <span>Why are you reporting this?</span>
              {COMMUNITY_REPORT_REASONS.map((reason) => <button type="button" disabled={reportBusy} key={reason} onClick={() => void report(item.messageId, reason)}>{reason.replace("_", " ")}</button>)}
            </div>}
          </article>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <textarea value={body} maxLength={500} placeholder="Join the conversation…" onChange={(event) => setBody(event.target.value)} />
          <div><button type="button" disabled={busy} onClick={() => void join()}>Join as guest</button><span>{body.length}/500</span><button type="submit" disabled={busy || body.trim().length < 2}>Send</button></div>
        </form></>}
        {view === "feedback" && <form className="communityFeedbackForm" onSubmit={(event) => { event.preventDefault(); void submitFeedback(); }}>
          <div className="communityFeedbackIntro"><strong>Help shape RMT</strong><span>Send a focused issue or idea directly to the private RMT review queue.</span></div>
          <label>Category<select value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value as CommunityFeedbackCategory)}>{COMMUNITY_FEEDBACK_CATEGORIES.map((category) => <option value={category} key={category}>{category.replace("_", " ")}</option>)}</select></label>
          <label>Title<input value={feedbackTitle} maxLength={80} placeholder="What should we fix or improve?" onChange={(event) => setFeedbackTitle(event.target.value)} /></label>
          <label>Details<textarea value={feedbackDescription} maxLength={1_000} placeholder="What happened, what did you expect, and which device or screen were you using?" onChange={(event) => setFeedbackDescription(event.target.value)} /></label>
          <div><span>{feedbackDescription.length}/1000</span><button type="submit" disabled={busy || feedbackTitle.trim().length < 4 || feedbackDescription.trim().length < 10}>Send privately</button></div>
          <small>Feedback cannot move funds, change rankings, or authorize transactions.</small>
        </form>}
        {view === "updates" && <div className="communityFeedbackUpdates">
          <div className="communityFeedbackIntro"><strong>Your feedback updates</strong><span>Receipts stay only in this browser. Public progress never includes your message, identity, or private reviewer notes.</span></div>
          {feedbackIds.length === 0 && <div className="communityLiveEmpty"><strong>No saved receipts</strong><span>Submit feedback from this device and its privacy-safe progress will appear here.</span></div>}
          {feedbackIds.map((feedbackId) => {
            const item = feedbackStatuses.find((status) => status.feedbackId === feedbackId);
            return <article key={feedbackId}>
              <div><strong>{item ? item.category.replace("_", " ") : "Feedback received"}</strong><span>{feedbackId.slice(0, 8).toUpperCase()}</span></div>
              <div><b className={`status-${item?.status ?? "checking"}`}>{(item?.status ?? "checking").replace("_", " ")}</b><button type="button" onClick={() => setFeedbackIds(forgetCommunityFeedbackReceipt(feedbackId))}>Remove</button></div>
            </article>;
          })}
          {feedbackIds.length > 0 && <small>Removing a receipt only clears it from this browser. It does not delete the private submission from RMT’s review queue.</small>}
        </div>}
        {message && <p role="status">{message}</p>}
      </section>}
    </aside>
  );
}
