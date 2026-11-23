"use client";

import { useEffect, useRef, useState } from "react";
import { isLaunchAddress } from "../../lib/launch-data";
import { descriptionMetadata } from "../../lib/rmt-metadata";
import { shortAddress, socialOrigin } from "../../lib/social";
import { artworkCID, assetCID, assetPath, boundedBytes, receiptForImage } from "../../lib/token-artwork";

export function TokenActions({ token, symbol }: { token: string; symbol: string }) {
  const [feedback, setFeedback] = useState("");
  const [manualCopy, setManualCopy] = useState<{ label: string; value: string }>();
  const [sharing, setSharing] = useState(false);
  const copyInput = useRef<HTMLInputElement>(null);
  const valid = isLaunchAddress(token);
  const canonicalURL = socialOrigin + "/launches/" + token.toLowerCase();

  useEffect(() => {
    setFeedback("");
    setManualCopy(undefined);
  }, [token]);

  useEffect(() => {
    if (manualCopy) {
      copyInput.current?.focus();
      copyInput.current?.select();
    }
  }, [manualCopy]);

  async function copy(value: string, label: string) {
    setFeedback("");
    setManualCopy(undefined);
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(label + " copied.");
    } catch {
      setManualCopy({ label, value });
      setFeedback("Select and copy the " + label.toLowerCase() + ".");
    }
  }

  async function share() {
    if (sharing || !valid) return;
    setFeedback("");
    setManualCopy(undefined);
    if (!navigator.share) return copy(canonicalURL, "Link");
    setSharing(true);
    try {
      await navigator.share({ title: symbol + " | RMT Launch", text: "View $" + symbol + " on RMT Launch.", url: canonicalURL });
    } catch (error) {
      // Closing the native share sheet is an intentional cancellation.
      if (!(error instanceof Error && error.name === "AbortError")) await copy(canonicalURL, "Link");
    } finally {
      setSharing(false);
    }
  }

  if (!valid) return null;
  return <div className="tpActions">
    <div className="tpActionRow">
      <button className="tpAction tpContract" type="button" title={token}
        aria-label={"Copy " + symbol + " contract address: " + token} onClick={() => void copy(token, "Address")}>
        <span>{shortAddress(token)}</span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>
      </button>
      <button className="tpAction" type="button" disabled={sharing} onClick={() => void share()}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 15V3m-4 4 4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>
        Share
      </button>
    </div>
    <span className="tpActionFeedback" role="status" aria-live="polite">{feedback}</span>
    {manualCopy && <label className="tpManualCopy">{manualCopy.label}
      <input ref={copyInput} readOnly value={manualCopy.value} onFocus={event => event.currentTarget.select()} />
    </label>}
  </div>;
}

type DescriptionState = { cid?: string; status: "loading" | "ready" | "empty" | "unavailable"; description?: string };

export function TokenDescription({ projectURI, symbol }: { projectURI?: string; symbol: string }) {
  const cid = assetCID(projectURI, "metadata.json");
  const [state, setState] = useState<DescriptionState>({ cid, status: cid ? "loading" : "empty" });
  const [attempt, setAttempt] = useState(0);
  const current: DescriptionState = !cid ? { status: projectURI ? "unavailable" : "empty" }
    : state.cid === cid ? state : { cid, status: "loading" };

  useEffect(() => {
    if (!cid) {
      setState({ status: "empty" });
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => controller.abort(), 8000);
    setState({ cid, status: "loading" });
    void (async () => {
      // Only the already admitted, content-addressed same-origin route is read.
      // A submitted project URL must never become an arbitrary fetch target.
      const response = await fetch(assetPath(cid, "metadata.json"), { cache: "force-cache", credentials: "omit", redirect: "error", signal: controller.signal });
      if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "application/json") throw new Error("Metadata unavailable.");
      const bytes = await boundedBytes(response.body, 4096);
      if (artworkCID(bytes) !== cid) throw new Error("Metadata changed.");
      const document: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Invalid metadata.");
      const record = document as Record<string, unknown>;
      let description: string | undefined;
      if ("description" in record) {
        // Reuse the exact current publication schema, including the unchanged text
        // and image binding. Other metadata formats require explicit admission.
        if (typeof record.description !== "string" || descriptionMetadata(record.description).cid !== cid) throw new Error("Invalid description metadata.");
        description = record.description;
      } else if (typeof record.image !== "string" || assetCID(receiptForImage(record.image).projectURI, "metadata.json") !== cid) {
        throw new Error("Invalid artwork metadata.");
      }
      if (active) setState({ cid, status: description === undefined ? "empty" : "ready", description });
    })().catch(() => {
      if (active) setState({ cid, status: "unavailable" });
    }).finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cid, attempt]);

  return <section className="tpAbout" aria-label={"About " + symbol}>
    <h2>About {symbol}</h2>
    <div className="tpDescription" aria-busy={current.status === "loading"}>
      {current.status === "ready" ? <p>{current.description}</p>
        : current.status === "loading" ? <p className="tpDescriptionStatus" role="status">Loading description…</p>
        : current.status === "empty" ? <p className="tpDescriptionStatus">No description provided.</p>
        : <div className="tpDescriptionUnavailable"><p className="tpDescriptionStatus" role="status">{cid ? "Description unavailable right now." : "Description unavailable."}</p>
          {cid && <button className="tpAction" type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button>}</div>}
    </div>
  </section>;
}
