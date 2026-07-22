"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONSENT_REHEARSAL_PROOF_MAX_AGE_MS,
  consentRehearsalRelease,
  getConsentRehearsalProofMode,
  isConsentRehearsalProofFresh,
  type ConsentRehearsalProofMode,
  type ConsentRehearsalStatus
} from "../../lib/consent-rehearsal";

const REFRESH_INTERVAL_MS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function explorerAddress(address: string) {
  return `${consentRehearsalRelease.network.explorerUrl}/address/${address}`;
}

function explorerTransaction(transactionHash: string) {
  return `${consentRehearsalRelease.network.explorerUrl}/tx/${transactionHash}`;
}

function readableTime(value: string | null | undefined) {
  if (!value) return "—";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(time);
}

function readableBlock(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return "—";
  return new Intl.NumberFormat().format(Number(value));
}

function isStatusPayload(value: unknown): value is ConsentRehearsalStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean"
    && ["verified", "mismatch", "unavailable"].includes(String(candidate.integrity))
    && typeof candidate.checkedAt === "string"
    && Boolean(candidate.network && typeof candidate.network === "object")
    && Boolean(candidate.live && typeof candidate.live === "object")
    && Boolean(candidate.release && typeof candidate.release === "object")
  );
}

function statusLabel(status: ConsentRehearsalStatus | null, mode: ConsentRehearsalProofMode) {
  if (mode === "unavailable") return "LIVE VERIFICATION UNAVAILABLE";
  if (mode === "attention") return "ATTENTION REQUIRED · EXECUTION OFF";
  if (mode === "active") return "VERIFIED · ACTIVE · TESTNET REHEARSAL";
  if (status?.activationState === "proposal-pending") return "VERIFIED · PAUSED · PROPOSAL SCHEDULED";
  if (status?.activationState === "ready-to-execute") return "VERIFIED · PAUSED · READY FOR REVIEW";
  if (status?.activationState === "paused-after-activation") return "VERIFIED · RE-PAUSED";
  return "VERIFIED · PAUSED";
}

export function RehearsalProof() {
  const [status, setStatus] = useState<ConsentRehearsalStatus | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [failedAt, setFailedAt] = useState<string>();
  const [proofClockMs, setProofClockMs] = useState(() => Date.now());
  const refreshSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++refreshSequence.current;
    activeRequest.current?.abort();
    const requestController = new AbortController();
    activeRequest.current = requestController;
    const abortRequest = () => requestController.abort();
    if (signal?.aborted) abortRequest();
    else signal?.addEventListener("abort", abortRequest, { once: true });
    let timeoutId: number | undefined;
    setRefreshing(true);
    try {
      const response = await Promise.race([
        fetch("/api/rescue/status", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: requestController.signal
        }),
        new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            requestController.abort();
            reject(new Error("Live rehearsal proof request timed out."));
          }, FETCH_TIMEOUT_MS);
        })
      ]);
      const payload: unknown = await response.json();
      if (!isStatusPayload(payload)) throw new Error("Invalid rehearsal proof response.");
      if (sequence !== refreshSequence.current) return;
      setStatus(payload);
      setProofClockMs(Date.now());
      setFailedAt(response.ok ? undefined : new Date().toISOString());
    } catch {
      if (signal?.aborted || sequence !== refreshSequence.current) return;
      // Fail closed: a failed refresh always clears previously green live proof.
      setStatus(null);
      setFailedAt(new Date().toISOString());
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortRequest);
      if (activeRequest.current === requestController) activeRequest.current = null;
      if (!signal?.aborted && sequence === refreshSequence.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => void refresh(controller.signal), REFRESH_INTERVAL_MS);
    const refreshAfterResume = () => {
      setProofClockMs(Date.now());
      if (document.visibilityState === "visible") void refresh(controller.signal);
    };
    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("pageshow", refreshAfterResume);
    window.addEventListener("focus", refreshAfterResume);
    return () => {
      controller.abort();
      activeRequest.current?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("pageshow", refreshAfterResume);
      window.removeEventListener("focus", refreshAfterResume);
    };
  }, [refresh]);

  useEffect(() => {
    if (!status) return;
    const checkedAtMs = Date.parse(status.checkedAt);
    if (!Number.isFinite(checkedAtMs)) {
      setProofClockMs(Date.now());
      return;
    }
    const remainingMs = checkedAtMs + CONSENT_REHEARSAL_PROOF_MAX_AGE_MS - Date.now();
    if (remainingMs <= 0) {
      setProofClockMs(Date.now());
      return;
    }
    const expiry = window.setTimeout(
      () => setProofClockMs(Date.now()),
      Math.min(remainingMs + 1, 2_147_483_647)
    );
    return () => window.clearTimeout(expiry);
  }, [status]);

  const statusFresh = status ? isConsentRehearsalProofFresh(status, proofClockMs) : false;
  const currentStatus = statusFresh ? status : null;
  const mode = useMemo(
    () => getConsentRehearsalProofMode(status, proofClockMs),
    [proofClockMs, status]
  );

  const release = currentStatus?.release ?? consentRehearsalRelease;
  const sessionIdle = currentStatus?.live.sessionIdle;

  return (
    <section className={`rehearsalProof ${mode}`} aria-label="Live read-only testnet deployment proof">
      <header className="rehearsalProofHeader">
        <div>
          <span className="rehearsalProofKicker"><i aria-hidden="true" /> LIVE READ-ONLY PROOF</span>
          <strong aria-live="polite">{statusLabel(currentStatus, mode)}</strong>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Checking…" : "Refresh"}
        </button>
      </header>

      <div className="rehearsalProofNetwork">
        <span>ROBINHOOD CHAIN TESTNET</span>
        <strong>CHAIN {release.network.chainId}</strong>
        <small>{mode === "verified" || mode === "active" ? "Current state reproduced from chain" : mode === "attention" ? "Live state did not match the reviewed boundary" : "Durable deployment record shown; live proof is not green"}</small>
      </div>

      <div className="rehearsalProofMetrics">
        <div><span>RUNTIME</span><strong>{mode === "verified" || mode === "active" ? "10 / 10" : "—"}</strong><small>exact hashes</small></div>
        <div><span>GOVERNANCE</span><strong>{currentStatus?.live.governanceTransactionCount ?? "—"}</strong><small>proposals</small></div>
        <div><span>POSITIONS</span><strong>{currentStatus?.live.positionsMinted ?? "—"}</strong><small>test NFTs</small></div>
        <div><span>SESSION</span><strong>{sessionIdle === true ? "IDLE" : sessionIdle === false ? "ACTIVE" : "—"}</strong><small>no custody</small></div>
      </div>

      {currentStatus?.activationProposal && (
        <div className="rehearsalProposalProof">
          <span>PROPOSAL #{currentStatus.activationProposal.id} · {currentStatus.activationProposal.status.replaceAll("-", " ")}</span>
          <small>Earliest execution {readableTime(currentStatus.activationProposal.executeAfter)} · expires {readableTime(currentStatus.activationProposal.executeBefore)}</small>
        </div>
      )}

      <div className="rehearsalProofEvidence">
        <div>
          <span>LIVE HEAD</span>
          <strong>Block {readableBlock(currentStatus?.network.latestBlock)}</strong>
          <small>{currentStatus ? `Checked ${readableTime(currentStatus.checkedAt)} · refreshes every 20s` : status ? `Last proof ${readableTime(status.checkedAt)} · expired or invalid · refreshing` : failedAt ? `Last attempt ${readableTime(failedAt)} · refreshes every 20s` : "Connecting to the public testnet RPC…"}</small>
        </div>
        <dl>
          <div><dt>CONFIG</dt><dd title={release.configuration.configurationHash}>{shortHash(release.configuration.configurationHash)}</dd></div>
          <div><dt>DOCUMENT</dt><dd title={release.configuration.termsDocumentHash}>{shortHash(release.configuration.termsDocumentHash)}</dd></div>
          <div><dt>TERMS</dt><dd title={release.configuration.migrationTermsHash}>{shortHash(release.configuration.migrationTermsHash)}</dd></div>
        </dl>
      </div>

      <nav className="rehearsalProofLinks" aria-label="Testnet evidence links">
        <a href={explorerAddress(release.contracts.venue.address)} target="_blank" rel="noreferrer">Venue ↗</a>
        <a href={explorerAddress(release.contracts.consentStack.address)} target="_blank" rel="noreferrer">Consent stack ↗</a>
        <a href={explorerAddress(release.contracts.migrator.address)} target="_blank" rel="noreferrer">Migrator ↗</a>
        <a href={explorerTransaction(release.create2.venue.transactionHash)} target="_blank" rel="noreferrer">Venue tx ↗</a>
        <a href={explorerTransaction(release.create2.consentStack.transactionHash)} target="_blank" rel="noreferrer">Stack tx ↗</a>
      </nav>

      <footer>
        <strong>No wallet required · No transaction path in the hosted app</strong>
        <span>{mode === "active" ? "Valueless testnet contract active · public migration UI off" : "RMT-operated no-value fixture · not official Sushi · unaudited"}</span>
      </footer>
    </section>
  );
}
