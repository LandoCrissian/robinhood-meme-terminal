"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { LaunchEvidence } from "@rmt/shared/launch-intelligence";
import {
  launchSourceLabel,
  launchStateLabel,
} from "../../lib/vnext/launch-presentation";
import { CopyAddress, ExplorerLink } from "./terminal-links";

/** Optional shared indexed intelligence. It owns no quote or wallet state. */
export function LaunchOrigin({
  token,
  initial,
  fallback,
}: {
  token: string;
  initial?: LaunchEvidence;
  fallback: ReactNode;
}) {
  const [evidence, setEvidence] = useState(
    initial?.token === token.toLowerCase() ? initial : undefined,
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/vnext/launches?${new URLSearchParams({ token, limit: "10" })}`,
      { signal: controller.signal },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((result) => {
        if (controller.signal.aborted) return;
        const exact = result?.entries?.find(
          (entry: LaunchEvidence) =>
            entry.chainId === 4663 && entry.token === token.toLowerCase(),
        );
        if (exact) setEvidence(exact);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [token]);
  const current =
    evidence?.token === token.toLowerCase()
      ? evidence
      : initial?.token === token.toLowerCase()
        ? initial
        : undefined;
  if (!current) return fallback;
  return (
    <section className="vnWorkspaceCard" data-launch-origin={current.source}>
      <header className="vnWorkspaceCardHead">
        <div>
          <span className="vnEyebrow">Launch origin</span>
          <h3>
            {launchSourceLabel(current)} ·{" "}
            {current.sourceVersion.replace("_", " ")}
          </h3>
        </div>
        <span>{launchStateLabel[current.state]}</span>
      </header>
      <p>
        {current.relationship === "TOKEN_ENROLLED"
          ? "Existing token enrolled in this launch pad. Its creation origin is not asserted."
          : "Token launch recorded on Robinhood Chain."}
      </p>
      <dl className="vnAssetIdentityFacts">
        <div>
          <dt>Launch</dt>
          <dd>
            <ExplorerLink kind="transaction" value={current.launchTransaction}>
              Block {current.launchBlock}
            </ExplorerLink>
          </dd>
        </div>
        <div>
          <dt>Observed</dt>
          <dd>
            <time dateTime={current.observedAt}>
              {new Date(current.observedAt)
                .toISOString()
                .replace("T", " ")
                .slice(0, 19)}{" "}
              UTC
            </time>
          </dd>
        </div>
        {current.progressBps !== null &&
        ["LAUNCHED", "BONDING", "GRADUATING"].includes(current.state) ? (
          <div>
            <dt>
              {current.sourceVersion === "V1"
                ? "Principal threshold"
                : "Graduation progress"}
            </dt>
            <dd>
              {(current.progressBps / 100).toLocaleString("en-US", {
                maximumFractionDigits: 1,
              })}
              %
            </dd>
          </div>
        ) : null}
      </dl>
      <details className="vnMoreDisclosure">
        <summary>Evidence &amp; Sources</summary>
        <p>
          Confirmed source event and block-qualified source views. This does not
          establish project admission, quality or execution availability.
        </p>
        <dl className="vnAssetIdentityFacts">
          <div>
            <dt>Source contract</dt>
            <dd>
              <code>
                {current.sourceContract.slice(0, 6)}…
                {current.sourceContract.slice(-4)}
              </code>
              <CopyAddress address={current.sourceContract} />
              <ExplorerLink kind="address" value={current.sourceContract}>
                Explorer
              </ExplorerLink>
            </dd>
          </div>
          {current.quoteAsset ? (
            <div>
              <dt>Quote asset</dt>
              <dd>
                {/^0x0{40}$/.test(current.quoteAsset) ? (
                  "Native ETH"
                ) : (
                  <ExplorerLink kind="token" value={current.quoteAsset}>
                    {current.quoteAsset.slice(0, 6)}…
                    {current.quoteAsset.slice(-4)}
                  </ExplorerLink>
                )}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Lifecycle observation</dt>
            <dd>
              {current.sourcePhase} · block {current.observedBlock}
            </dd>
          </div>
          {current.graduationTransaction ? (
            <div>
              <dt>Graduation</dt>
              <dd>
                <ExplorerLink
                  kind="transaction"
                  value={current.graduationTransaction}
                >
                  Block {current.graduationBlock}
                </ExplorerLink>
              </dd>
            </div>
          ) : null}
        </dl>
      </details>
    </section>
  );
}
