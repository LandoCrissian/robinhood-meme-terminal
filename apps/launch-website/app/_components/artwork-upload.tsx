"use client";

import { useEffect, useRef, useState } from "react";
import { artworkCID, artworkLimit, artworkProof, assetCID, assetPath, verifyArtworkReceipt, inspectArtwork, type ArtworkReceipt } from "../../lib/token-artwork";
import { assertConnectedAccount, signAccountMessage, subscribeAccountWallet } from "../../lib/profile-wallet";
import { useAccount } from "./account-provider";

// One bounded, local pending file. Serialize changes so an older selection cannot
// overwrite a newer one when the browser completes IndexedDB requests out of order.
let queue: Promise<unknown> = Promise.resolve();
function pendingFile(action: "get" | "put" | "delete", file?: Blob): Promise<Blob | undefined> {
  const run = async () => {
    const record = file && {type:file.type, bytes:await file.arrayBuffer()};
    return new Promise<Blob | undefined>((resolve,reject) => {
    const open = indexedDB.open("rmt-token-artwork",1);
    open.onupgradeneeded = () => open.result.createObjectStore("draft");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("draft",action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("draft");
      const req = action === "get" ? store.get("pending") : action === "put" ? store.put(record,"pending") : store.delete("pending");
      tx.oncomplete = () => {
        db.close();
        const saved = action === "get" && req.result;
        resolve(saved?.bytes instanceof ArrayBuffer && saved.bytes.byteLength <= artworkLimit ? new Blob([saved.bytes],{type:saved.type}) : undefined);
      };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
    });
  };
  const next = queue.then(run,run); queue = next.catch(()=>undefined); return next;
}

export const clearPendingArtwork = () => pendingFile("delete").catch(()=>{});

export function ArtworkUpload({ projectURI, onSave, onPending }: {
  projectURI: string; onSave: (receipt: ArtworkReceipt) => void; onPending: (pending:boolean) => void;
}) {
  const account = useAccount();
  const [file,setFile] = useState<Blob>(), [preview,setPreview] = useState(""), [status,setStatus] = useState("");
  const [busy,setBusy] = useState(false), [checking,setChecking] = useState(true);
  const version = useRef(0), wallet = useRef(account.wallet), request = useRef<AbortController>(undefined);
  const savedCID = assetCID(projectURI,"metadata.json");
  wallet.current = account.wallet;
  useEffect(() => {
    const current = version.current;
    void pendingFile("get").then(f => { if (current === version.current && f instanceof Blob && f.size <= artworkLimit) setFile(f); })
      .catch(()=>{}).finally(()=>{ if(current === version.current) setChecking(false); });
    return () => { version.current++; request.current?.abort(); };
  },[]);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);
  },[file]);
  useEffect(()=>{ onPending(Boolean(file) || busy || checking); },[file,busy,checking,onPending]);
  useEffect(()=>{
    if (!account.wallet) return;
    return subscribeAccountWallet(account.wallet,()=>{ request.current?.abort(); setStatus("Wallet disconnected or changed. Reconnect to retry."); });
  },[account.wallet]);
  async function select(next?: File) {
    if (!next) return;
    const current = ++version.current; request.current?.abort(); setChecking(true); setStatus("");
    try {
      if (next.size > artworkLimit) throw new Error("Choose an image up to 2 MiB.");
      inspectArtwork(new Uint8Array(await next.arrayBuffer()),next.type);
      const url = URL.createObjectURL(next);
      try { const img = new Image(); img.src = url; await img.decode(); } finally { URL.revokeObjectURL(url); }
      if (current !== version.current) return;
      try { await pendingFile("put",next); } catch { if (current === version.current) setStatus("Keep this tab open until the upload is saved."); }
      if (current === version.current) setFile(next);
    } catch(e) { if (current === version.current) setStatus(e instanceof Error ? e.message : "Choose a valid image."); }
    finally { if (current === version.current) setChecking(false); }
  }
  async function save() {
    if (!file || busy) return;
    const connected = account.wallet;
    if (!connected) { account.discoverWallets(); setStatus("Choose your creator wallet to save the image."); return; }
    if (connected.chainId !== 4663) { setStatus("Reconnect on Robinhood Chain 4663."); return; }
    const current = version.current, controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),120_000);
    request.current = controller;
    const check = () => { if (current !== version.current || controller.signal.aborted || wallet.current !== connected) throw new Error("Reconnect the creator wallet and retry."); };
    setBusy(true);
    try {
      const cid = artworkCID(new Uint8Array(await file.arrayBuffer())), issued = Date.now();
      check(); setStatus("Review the gas-free artwork message in your wallet.");
      const proof = await signAccountMessage(connected,artworkProof(location.origin,connected.address,cid,issued),check);
      check(); setStatus("Uploading and verifying storageâ€¦");
      const response = await fetch("/api/artwork/upload",{method:"POST",body:file,redirect:"error",signal:controller.signal,
        headers:{"Content-Type":file.type,"x-artwork-cid":cid,"x-artwork-proof":proof,"x-artwork-issued":String(issued)}});
      if (!response.ok) {
        const error = await response.json().catch(()=>({}));
        throw new Error(typeof error.error === "string" ? error.error : "Upload failed. Retry with the same image.");
      }
      const receipt = await response.json() as ArtworkReceipt;
      await verifyArtworkReceipt(receipt,controller.signal);
      await assertConnectedAccount(connected); check();
      onSave(receipt); setFile(undefined); setStatus("Artwork saved and verified.");
      await pendingFile("delete").catch(()=>{});
    } catch(e) { if (current === version.current) setStatus(e instanceof Error ? e.message : "Upload failed. Retry with the same image."); }
    finally { clearTimeout(timeout); if (current === version.current) setBusy(false); }
  }
  return <div className="lpDraftField lpArtworkPicker" onDragOver={e=>e.preventDefault()} onDrop={e=>{
    e.preventDefault(); if (!busy) void select(e.dataTransfer.files[0]); }}>
    <label htmlFor="token-logo-file">Token image</label>
    <input id="token-logo-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
      onChange={e=>{ const selected=e.currentTarget.files?.[0]; e.currentTarget.value=""; void select(selected); }} />
    <small>Choose or drop a still PNG, JPEG or WebP, up to 2 MiB.</small>
    {(preview || savedCID) && <img className="lpArtworkPreview" alt="Token artwork preview" src={preview || assetPath(savedCID!,"logo.webp")} />}
    {file && <div className="lpDraftActions"><button className="lpButton lpSecondary" type="button" disabled={busy || checking} onClick={()=>void save()}>Save artwork</button>
      <button type="button" disabled={busy || checking} onClick={()=>{ version.current++; setFile(undefined); setStatus(""); void pendingFile("delete").catch(()=>{}); }}>Discard selection</button></div>}
    {file && !account.wallet && account.wallets.map(w=><button type="button" key={w.id} disabled={account.busy} onClick={()=>void account.connect(w)}>Connect {w.name}</button>)}
    {savedCID && !file && <button type="button" onClick={()=>{ onSave({projectURI:"",artworkURL:""}); setStatus("Image removed from this draft."); }}>Remove draft image</button>}
    {busy && <progress aria-label="Saving artwork" />}
    <small role="status" aria-live="polite">{status}</small>
  </div>;
}
