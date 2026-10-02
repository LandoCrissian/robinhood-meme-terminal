"use client";
import Link from "next/link";
import { useState } from "react";
import { formatTerminalAge, formatTerminalCompactUsd } from "../vnext/terminal-format";
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
/** Discovery is a scanner; complete origin evidence stays in the token workspace. */
export function LaunchRow({ launch, observedNow }: { launch: LaunchEvidence; observedNow: number }) {
  const symbol = launch.identity.symbol ?? `${launch.token.slice(0, 6)}…${launch.token.slice(-4)}`;
  const age = formatTerminalAge((observedNow - Date.parse(launch.launchTime)) / 60_000);
  const bonding = ["LAUNCHED", "BONDING", "GRADUATING"].includes(launch.state);
  const cap = launch.marketCapUsd8 ? Number(launch.marketCapUsd8) / 1e8 : null;
  const metric = cap !== null && Number.isFinite(cap) && cap > 0
    ? { value: formatTerminalCompactUsd(cap), label: "Market cap" }
    : bonding && launch.progressBps !== null
      ? { value: `${(launch.progressBps / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`, label: launch.sourceVersion === "V1" ? "Principal threshold" : "Progress" }
      : null;
  return (
    <Link href={launchNavigationHref(launch)} prefetch className="rmtLaunchRow"
      data-launch-id={launch.launchId} data-token={launch.token}
      aria-label={`Open ${symbol} token market`}>
      <span className="rmtLaunchToken">
        <TokenArtwork contract={launch.token} imageUrl={launch.identity.artwork} launch
          className="rmtMarketArtwork rmtLaunchArtwork" symbol={symbol} />
        <span className="rmtLaunchIdentity"><strong>{symbol}</strong><small>{launch.identity.name ?? "Token"}</small></span>
      </span>
      <span className="rmtLaunchSource">
        {launchSourceLabel(launch)} <small>{launch.sourceVersion.replace("_", " ")}</small>
        <time className="rmtLaunchMobileAge" dateTime={launch.launchTime}> · {age}</time>
        {launch.relationship === "TOKEN_ENROLLED" ? <small className="rmtLaunchEnrolled"> · Existing token enrolled</small> : null}
      </span>
      <span className={`rmtLaunchState is${launch.state}`}>{launchStateLabel[launch.state]}</span>
      <span className="rmtLaunchMetric">{metric ? <><strong>{metric.value}</strong><small>{metric.label}</small></> : null}</span>
      <time className="rmtLaunchAge" dateTime={launch.launchTime}>{age}</time>
    </Link>
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
        <div className="rmtLaunchScanner">
          <div className="rmtLaunchScannerHead" aria-hidden="true"><span>Token</span><span>Source</span><span>State</span><span>Metric</span><span>Age</span></div>
          {visible.map((e) => (
            <LaunchRow key={e.launchId} launch={e} observedNow={now} />
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
