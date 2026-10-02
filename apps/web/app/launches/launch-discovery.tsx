"use client";
import Link from "next/link";
import { useState } from "react";
import { formatTerminalCompactUsd } from "../vnext/terminal-format";
import { projectsForContract } from "@rmt/shared/project-identity";
import type {
  LaunchDirectory,
  LaunchEvidence,
} from "@rmt/shared/launch-intelligence";
import {
  launchNavigationHref,
  launchSourceLabel,
  launchStateLabel,
} from "../../lib/vnext/launch-presentation";
import { TokenArtwork } from "../vnext/token-artwork";
import { TerminalIcon } from "../vnext/terminal-icon";
import { CopyAddress, ExplorerLink } from "../vnext/terminal-links";
export function LaunchCard({ launch }: { launch: LaunchEvidence }) {
  const project = projectsForContract(launch.token)[0],
    symbol =
      launch.identity.symbol ??
      `${launch.token.slice(0, 6)}…${launch.token.slice(-4)}`,
    name = launch.identity.name ?? "Token";
  return (
    <article
      className="rmtLaunchCard"
      data-launch-id={launch.launchId}
      data-token={launch.token}
    >
      <Link
        href={launchNavigationHref(launch)}
        prefetch
        className="rmtLaunchDestination"
        aria-label={`Open ${symbol} token market`}
      >
        <div className="rmtLaunchIdentity">
          <TokenArtwork
            contract={launch.token}
            imageUrl={launch.identity.artwork}
            launch
            className="rmtLaunchArtwork"
            symbol={symbol}
          />
          <div>
            <strong>{symbol}</strong>
            <span>{name}</span>
          </div>
          <TerminalIcon name="chevron" />
        </div>
        <div className="rmtLaunchTags">
          <span>
            {launchSourceLabel(launch)} ·{" "}
            {launch.sourceVersion.replace("_", " ")}
          </span>
          <b className={`is${launch.state}`}>
            {launchStateLabel[launch.state]}
          </b>
        </div>
        <div className="rmtLaunchProgress">
          {launch.progressBps !== null &&
          ["LAUNCHED", "BONDING", "GRADUATING"].includes(launch.state) ? (
            <>
              <div>
                <span>
                  {launch.sourceVersion === "V1"
                    ? "Principal threshold"
                    : "Graduation progress"}
                </span>
                <strong>
                  {(launch.progressBps / 100).toLocaleString("en-US", {
                    maximumFractionDigits: 1,
                  })}
                  %
                </strong>
              </div>
              <span
                role="progressbar"
                aria-label="Observed graduation progress"
                aria-valuenow={launch.progressBps / 100}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i style={{ width: `${launch.progressBps / 100}%` }} />
              </span>
            </>
          ) : (
            <span>
              {launch.state === "GRADUATED"
                ? "Graduated market"
                : launch.relationship === "TOKEN_ENROLLED"
                  ? "Existing token enrolled"
                  : "Onchain token launch"}
            </span>
          )}
        </div>
        <div className="rmtLaunchContext">
          <span>
            {new Date(launch.launchTime).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
          </span>
          <span>
            {launch.relationship === "TOKEN_ENROLLED" ? "Existing token enrolled" : launch.creatorTaxBps !== null
              ? `Creator tax ${launch.creatorTaxBps / 100}%`
              : launch.quoteAsset === `0x${"0".repeat(40)}`
                ? "Native ETH quote"
                : "Quote asset in details"}
          </span>
        </div>
        {launch.marketCapUsd8 &&
        Number.isFinite(Number(launch.marketCapUsd8)) ? (
          <div className="rmtLaunchMarket">
            <span>Observed market cap</span>
            <strong>
              {formatTerminalCompactUsd(Number(launch.marketCapUsd8) / 1e8)}
            </strong>
          </div>
        ) : null}
        <span className="rmtLaunchAction">
          Explore token <TerminalIcon name="chevron" />
        </span>
      </Link>
      <details className="rmtLaunchEvidence">
        <summary>Evidence &amp; Sources</summary>
        <dl>
          <div>
            <dt>Token</dt>
            <dd>
              <code>
                {launch.token.slice(0, 6)}…{launch.token.slice(-4)}
              </code>
              <CopyAddress address={launch.token} />
              <ExplorerLink
                kind="token"
                value={launch.token}
                accessibleName="Token contract explorer"
              >
                <TerminalIcon name="external" />
              </ExplorerLink>
            </dd>
          </div>
          <div>
            <dt>Origin</dt>
            <dd>
              {launch.relationship === "TOKEN_ENROLLED"
                ? "Pad enrollment; token creation not asserted"
                : "Factory / pad creation event"}
            </dd>
          </div>
          <div>
            <dt>Launch</dt>
            <dd>
              <ExplorerLink kind="transaction" value={launch.launchTransaction}>
                Block {launch.launchBlock} <TerminalIcon name="external" />
              </ExplorerLink>
            </dd>
          </div>
          <div>
            <dt>Source contract</dt>
            <dd>
              <ExplorerLink kind="address" value={launch.sourceContract}>
                {launch.sourceContract.slice(0, 6)}…
                {launch.sourceContract.slice(-4)}{" "}
                <TerminalIcon name="external" />
              </ExplorerLink>
            </dd>
          </div>
          <div>
            <dt>Quote asset</dt>
            <dd>
              {launch.quoteAsset === `0x${"0".repeat(40)}` ? (
                "Native ETH"
              ) : launch.quoteAsset ? (
                <ExplorerLink kind="token" value={launch.quoteAsset}>
                  {launch.quoteAsset.slice(0, 6)}…{launch.quoteAsset.slice(-4)}
                </ExplorerLink>
              ) : (
                "Not observed"
              )}
            </dd>
          </div>
          <div>
            <dt>Observed</dt>
            <dd>
              <time dateTime={launch.observedAt}>
                {new Date(launch.observedAt)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19) + " UTC"}
              </time>{" "}
              · block {launch.observedBlock}
            </dd>
          </div>
        </dl>
        {project ? (
          <Link href={`/projects/${project.projectId}`}>
            Linked project · {project.displayName}
          </Link>
        ) : null}
        <p>
          Origin and lifecycle are intelligence. They do not establish safety,
          project admission or execution availability.
        </p>
      </details>
    </article>
  );
}
export function LaunchDiscovery({
  initial,
  query,
  source,
  observedNow,
}: {
  initial: LaunchDirectory;
  query: string;
  source?: string;
  observedNow: number;
}) {
  const [directory, setDirectory] = useState(initial),
    [phase, setPhase] = useState("ALL"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false);
  const entries = directory.entries,
    now = observedNow;
  const phases = [
    "ALL",
    ...(entries.some((e) => now - Date.parse(e.launchTime) < 86400000)
      ? ["NEW"]
      : []),
    ...(["GRADUATING", "GRADUATED"] as const).filter((state) =>
      entries.some((e) => e.state === state),
    ),
  ];
  const visible = entries.filter(
    (e) =>
      phase === "ALL" ||
      (phase === "NEW"
        ? now - Date.parse(e.launchTime) < 86400000
        : e.state === phase),
  );
  async function loadMore() {
    if (loading || !directory.nextCursor) return;
    setLoading(true);
    setError(false);
    try {
      const r = await fetch(
        `/api/vnext/launches?${new URLSearchParams({ cursor: directory.nextCursor, ...(query ? { q: query } : {}), ...(source ? { source } : {}) })}`,
      );
      const next = (await r.json()) as LaunchDirectory;
      if (
        !r.ok ||
        next.chainId !== 4663 ||
        next.status === "unavailable" ||
        !Array.isArray(next.entries) ||
        next.entries.some(
          (e) => e.chainId !== 4663 || !/^0x[0-9a-f]{40}$/.test(e.token),
        )
      )
        throw Error();
      setDirectory((current) => ({
        ...next,
        entries: [
          ...current.entries,
          ...next.entries.filter(
            (e) => !current.entries.some((old) => old.launchId === e.launchId),
          ),
        ],
      }));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section aria-label="Onchain launches">
      <nav className="rmtLaunchFilters" aria-label="Launch sources">
        <Link
          aria-current={!source ? "page" : undefined}
          href={`/launches${query ? `?q=${encodeURIComponent(query)}` : ""}`}
        >
          All sources
        </Link>
        {(["PONS", "STONKBROKERS"] as const)
          .filter((s) => s === source || entries.some((e) => e.source === s))
          .map((s) => (
            <Link
              key={s}
              href={`/launches?${new URLSearchParams({ source: s, ...(query ? { q: query } : {}) })}`}
              aria-current={source === s ? "page" : undefined}
            >
              {s === "PONS" ? "pons" : "StonkBrokers"}
            </Link>
          ))}
      </nav>
      {phases.length > 1 ? (
        <nav
          className="rmtLaunchFilters isStates"
          aria-label="Launch lifecycle"
        >
          {phases.map((p) => (
            <button
              type="button"
              aria-pressed={phase === p}
              key={p}
              onClick={() => setPhase(p)}
            >
              {p === "ALL"
                ? "All"
                : p === "NEW"
                  ? "New"
                  : launchStateLabel[p as "GRADUATING" | "GRADUATED"]}
            </button>
          ))}
        </nav>
      ) : null}
      {visible.length ? (
        <div className="rmtLaunchGrid">
          {visible.map((e) => (
            <LaunchCard key={e.launchId} launch={e} />
          ))}
        </div>
      ) : (
        <p className="rmtLaunchQuiet">
          {directory.status === "unavailable"
            ? "Launch discovery is temporarily unavailable. Markets remain available."
            : "No matching launches in the indexed evidence yet."}
        </p>
      )}
      {directory.status === "partial" ? (
        <p className="rmtLaunchCoverage">
          Launch history is still syncing. Recorded origins remain available.
        </p>
      ) : null}
      {directory.status === "unavailable" && entries.length ? (
        <p className="rmtLaunchCoverage" role="status">
          Launch updates delayed. Showing recorded origins.
        </p>
      ) : null}
      {error ? (
        <p role="status" className="rmtLaunchCoverage">
          More launches could not be loaded.
        </p>
      ) : null}
      {directory.nextCursor ? (
        <button
          className="rmtLaunchMore"
          type="button"
          disabled={loading}
          onClick={loadMore}
        >
          {loading ? "Loading…" : "More launches"}
        </button>
      ) : null}
    </section>
  );
}
