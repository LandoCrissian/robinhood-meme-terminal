"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UNISWAP_V4_HOOK_PERMISSIONS,
  type ExternalV4Evidence,
  type UniswapV4HookPermissionId
} from "../lib/external-v4-evidence";

const BLOCKSCOUT_ADDRESS = "https://robinhoodchain.blockscout.com/address/";

type PassportState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; evidence: ExternalV4Evidence };

const permissionLabels = new Map<UniswapV4HookPermissionId, string>(
  UNISWAP_V4_HOOK_PERMISSIONS.map((permission) => [permission.id, permission.label])
);

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function evidenceLabel(evidence: ExternalV4Evidence) {
  if (evidence.sellSimulation.status === "blocked") return "SELL REHEARSAL BLOCKED";
  if (evidence.sellSimulation.status === "passed" && evidence.executionAssessment.state === "review") {
    return "SELL PASSED · HOOK REVIEW";
  }
  if (evidence.sellSimulation.status === "passed") return "SELL REHEARSAL PASSED";
  return "EVIDENCE INCOMPLETE";
}

function routeCallLabel(value: ExternalV4Evidence["sellSimulation"]["calls"]["swap"]) {
  if (value === "passed") return "Passed";
  if (value === "blocked") return "Blocked";
  return "Not run";
}

export function ExternalV4HookPassport({ token, poolId }: { token: string; poolId: string }) {
  const [passport, setPassport] = useState<PassportState>({ state: "loading" });

  const load = useCallback(async () => {
    setPassport({ state: "loading" });
    try {
      const query = new URLSearchParams({ token, pool: poolId });
      const response = await fetch(`/api/markets/v4-evidence?${query}`, { cache: "no-store" });
      const payload = await response.json() as ExternalV4Evidence | { error?: string };
      if (!response.ok || !("protocol" in payload) || payload.protocol !== "uniswap-v4") {
        throw new Error("error" in payload ? payload.error : "V4 evidence is unavailable.");
      }
      if (
        payload.token.toLowerCase() !== token.toLowerCase()
        || payload.poolId.toLowerCase() !== poolId.toLowerCase()
      ) throw new Error("RMT rejected mismatched v4 evidence.");
      setPassport({ state: "ready", evidence: payload });
    } catch (cause) {
      setPassport({
        state: "error",
        message: cause instanceof Error ? cause.message : "V4 evidence is unavailable."
      });
    }
  }, [poolId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (passport.state === "loading") {
    return (
      <section className="v4HookPassport loading" aria-live="polite">
        <p className="eyebrow">UNISWAP V4 HOOK & SELLABILITY PASSPORT</p>
        <h3>Rehearsing the complete sell path…</h3>
        <p>Matching the canonical pool key and hook, then simulating approval, Permit2, and Universal Router execution without broadcasting.</p>
      </section>
    );
  }
  if (passport.state === "error") {
    return (
      <section className="v4HookPassport unavailable" role="status">
        <p className="eyebrow">UNISWAP V4 HOOK & SELLABILITY PASSPORT</p>
        <h3>Evidence unavailable · view only</h3>
        <p>{passport.message} RMT will not replace missing evidence with a safety claim.</p>
        <button type="button" onClick={() => void load()}>Retry evidence</button>
      </section>
    );
  }

  const { evidence } = passport;
  const route = evidence.sellSimulation;
  const state = evidence.executionAssessment.state;
  return (
    <section className={`v4HookPassport ${state}`} aria-labelledby="v4-hook-passport-title">
      <header>
        <div>
          <p className="eyebrow">UNISWAP V4 HOOK & SELLABILITY PASSPORT</p>
          <h3 id="v4-hook-passport-title">RMT inspected more than the token contract</h3>
        </div>
        <span className={`v4PassportState ${state}`}>{evidenceLabel(evidence)}</span>
      </header>

      <div className="v4RouteRehearsal">
        <div>
          <small>NO-BROADCAST ROUTE REHEARSAL</small>
          <strong>{route.status === "passed"
            ? `Completed at block ${Number(route.testedAtBlock).toLocaleString()}`
            : route.status === "blocked"
              ? "The route did not complete"
              : "A complete route could not be rehearsed"}</strong>
          <p>RMT used an existing holder balance as read-only state. No approval, swap, signature, or asset movement was sent.</p>
        </div>
        <ol aria-label="Sell route rehearsal">
          <li className={route.calls.tokenApproval}><span>01</span><small>Token approval</small><strong>{routeCallLabel(route.calls.tokenApproval)}</strong></li>
          <li className={route.calls.permit2Approval}><span>02</span><small>Permit2 approval</small><strong>{routeCallLabel(route.calls.permit2Approval)}</strong></li>
          <li className={route.calls.swap}><span>03</span><small>V4 sell</small><strong>{routeCallLabel(route.calls.swap)}</strong></li>
        </ol>
      </div>

      <div className="v4HookEvidenceGrid">
        <article>
          <small>CANONICAL HOOK</small>
          <strong>{evidence.hook.contractName || short(evidence.hook.address)}</strong>
          <a href={`${BLOCKSCOUT_ADDRESS}${evidence.hook.address}`} target="_blank" rel="noopener noreferrer">
            {short(evidence.hook.address)} ↗
          </a>
        </article>
        <article>
          <small>SOURCE</small>
          <strong>{evidence.hook.sourcePublished === true ? "Published + verified" : evidence.hook.sourcePublished === false ? "Not verified" : "Unconfirmed"}</strong>
          <span>{evidence.hook.isProxy === false ? "Non-proxy observed" : evidence.hook.isProxy ? "Proxy / delegated" : "Proxy status unknown"}</span>
        </article>
        <article>
          <small>BYTECODE</small>
          <strong>{evidence.hook.bytecodeChanged === false ? "Matches published source" : evidence.hook.bytecodeChanged ? "Changed" : "Unconfirmed"}</strong>
          <span>Pool initialized at block {Number(evidence.poolState.initializedAtBlock).toLocaleString()}</span>
        </article>
      </div>

      <div className="v4HookCapabilities">
        <div>
          <small>HOOK POWERS</small>
          <strong>{evidence.hook.permissions.length} encoded permissions</strong>
        </div>
        <div className="v4PermissionList">
          {evidence.hook.permissions.length > 0
            ? evidence.hook.permissions.map((permission) => (
                <span className={permission.includes("swap") ? "swap" : ""} key={permission}>
                  {permissionLabels.get(permission) ?? permission}
                </span>
              ))
            : <span>No hook callbacks encoded</span>}
        </div>
        {evidence.hook.customWriteFunctions.length > 0 && (
          <p><strong>Project controls observed:</strong> {evidence.hook.customWriteFunctions.join(" · ")}</p>
        )}
      </div>

      <div className={`v4Assessment ${state}`}>
        <strong>{state === "blocked" ? "RMT blocks execution preparation" : state === "review" ? "Review before any execution" : "Current evidence passed"}</strong>
        <ul>
          {evidence.executionAssessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>
      <footer>
        <span>Checked {new Date(evidence.checkedAt).toLocaleString()}</span>
        <span>Point-in-time evidence · never a guarantee</span>
      </footer>
    </section>
  );
}
