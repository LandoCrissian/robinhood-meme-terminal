"use client";

import { useEffect, useRef, useState } from "react";
import { GLOBAL_COMMUNITY_ROOM, type CommunityMessage } from "../lib/community";
import {
  ensureCommunityIdentity,
  postCommunityMessage,
  subscribeToCommunityMessages
} from "../lib/community-cloud";

export function CommunityLive() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const stream = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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

  return (
    <aside className={`communityLive${open ? " open" : ""}`} aria-label="RMT Live community">
      <button className="communityLiveLauncher" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span aria-hidden="true">◌</span><b>Live</b>
      </button>
      {open && <section className="communityLivePanel">
        <header>
          <div><small>RMT COMMUNITY</small><strong>Live lounge</strong></div>
          <span>Presence coming next</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close RMT Live">×</button>
        </header>
        <div className="communityLiveNotice">Public room · guests are labeled · never share recovery words, private keys, or untrusted links.</div>
        <div className="communityLiveStream" ref={stream}>
          {messages.length === 0 && <div className="communityLiveEmpty"><strong>Start the conversation</strong><span>RMT Live is prepared locally and will open after secure Firebase activation.</span></div>}
          {messages.map((item) => <article key={item.messageId}>
            <header><strong>{item.authorLabel}</strong><span className={`kind-${item.authorKind}`}>{item.authorKind}</span>{item.authorHandle && <small>@{item.authorHandle}</small>}</header>
            <p>{item.body}</p>
          </article>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <textarea value={body} maxLength={500} placeholder="Share feedback or join the conversation…" onChange={(event) => setBody(event.target.value)} />
          <div><button type="button" disabled={busy} onClick={() => void join()}>Join as guest</button><span>{body.length}/500</span><button type="submit" disabled={busy || body.trim().length < 2}>Send</button></div>
        </form>
        {message && <p role="status">{message}</p>}
      </section>}
    </aside>
  );
}
