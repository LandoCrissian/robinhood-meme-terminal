"use client";

import { useState, useSyncExternalStore } from "react";
import { injectedSignerSelection } from "../lib/injected-wallet-signer";

/** Explicit signer step inside the existing wallet selector. Labels are not provider authority. */
export function InjectedSignerSelection() {
  const state = useSyncExternalStore(injectedSignerSelection.subscribe, injectedSignerSelection.getSnapshot, injectedSignerSelection.getSnapshot);
  const [error, setError] = useState("");
  if (!state.eligible) return null;
  return <section aria-label="Injected signer selection">
    <strong>Choose the injected signer for 0x</strong>
    <p>Select the extension you intend to use. Its announced name is not proof of identity; RMT also checks your linked account and network.</p>
    <div className="privyWalletList">
      {state.choices.map((choice) => <button type="button" key={choice.uuid} disabled={choice.conflicted}
        aria-pressed={state.selectedUuid === choice.uuid}
        onClick={() => { try { injectedSignerSelection.select(choice.uuid); setError(""); } catch { setError("Signer selection could not be bound. Recheck the active trading wallet."); } }}>
        <span><strong>{choice.name}</strong><small style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}>{choice.rdns} / {choice.uuid}</small></span>
        <em>{choice.conflicted ? "CONFLICT" : state.selectedUuid === choice.uuid ? "SELECTED" : "SELECT"}</em>
      </button>)}
    </div>
    {!state.choices.length ? <p>No supported EIP-6963 signer has announced itself on this page.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
