"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useScannerRefresh } from "../vnext/use-scanner-refresh";
import { useScannerRows } from "../vnext/use-scanner-rows";
import { ScannerUpdates } from "../vnext/scanner-updates";
import { VNEXT_CLIENT_REFRESH_POLICY } from "../../lib/vnext/client-refresh-policy";
import { formatTerminalAge, formatTerminalCompactUsd } from "../vnext/terminal-format";
import type {
  LaunchDirectory,
  LaunchEvidence,
  LaunchSource,
} from "@rmt/shared/launch-intelligence";
import {
  launchNavigationHref,
  launchSourceLabel,
  launchStateLabel,
} from "../../lib/vnext/launch-presentation";
import { TokenArtwork } from "../vnext/token-artwork";
const launchKey = (launch: LaunchEvidence) => launch.launchId;
const validDirectory = (value: LaunchDirectory) => value.chainId === 4663 && value.status !== "unavailable" && Array.isArray(value.entries)
  && value.entries.every(e => e.chainId === 4663 && /^0x[0-9a-f]{40}$/.test(e.token));
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
  availableSources,
  query,
  source,
  observedNow,
}: {
  initial: LaunchDirectory;
  availableSources: readonly LaunchSource[];
  query: string;
  source?: string;
  observedNow: number;
}) {
  const [directory, setDirectory] = useState(initial),
    [phase, setPhase] = useState("ALL"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false);
  const [delayed, setDelayed] = useState(false), [now, setNow] = useState(observedNow);
  const [indexedSources, setIndexedSources] = useState(availableSources);
  const pages = useRef(1), running = useRef(false);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      let next: LaunchDirectory | undefined;
      const entries: LaunchEvidence[] = [], cursors = new Set<string>();
      let cursor: string | undefined;
      for (let index = 0; index < pages.current; index++) {
        const parameters = new URLSearchParams({ ...(query ? { q: query } : {}), ...(source ? { source } : {}), ...(cursor ? { cursor } : {}) });
        const response = await fetch(`/api/vnext/launches?${parameters}`, { signal: AbortSignal.timeout(8_000) });
        const page = await response.json() as LaunchDirectory & { availableSources?: LaunchSource[] };
        if (!response.ok || !validDirectory(page) || (page.nextCursor && cursors.has(page.nextCursor))) throw Error("Launch revalidation delayed");
        entries.push(...page.entries); next = page;
        if (index === 0 && Array.isArray(page.availableSources) && page.availableSources.every(s => s === "PONS" || s === "STONKBROKERS")) setIndexedSources(page.availableSources);
        if (!page.nextCursor) break;
        cursor = page.nextCursor; cursors.add(cursor);
      }
      if (!next) return false;
      setDirectory(current => {
        const previous = new Map(current.entries.map(e => [e.launchId, e]));
        return { ...next!, entries: [...new Map(entries.map(e => [e.launchId, { ...e, identity: { ...e.identity, artwork: e.identity.artwork ?? previous.get(e.launchId)?.identity.artwork ?? null } }])).values()] };
      });
      setNow(Date.now()); setDelayed(false); return true;
    } catch { setDelayed(true); return false; }
    finally { running.current = false; }
  }, [query, source]);
  useScannerRefresh(refresh, VNEXT_CLIENT_REFRESH_POLICY.launchDirectoryMs, { immediate: false, refreshKey: `${source ?? "ALL"}:${query}` });
  const entries = directory.entries,
    scanner = useScannerRows(entries, launchKey, `${source ?? "ALL"}:${query}:${phase}:${pages.current}`);
  const phases = [
    "ALL",
    ...(phase === "NEW" || entries.some((e) => now - Date.parse(e.launchTime) < 86400000)
      ? ["NEW"]
      : []),
    ...(["GRADUATING", "GRADUATED"] as const).filter((state) =>
      phase === state || entries.some((e) => e.state === state),
    ),
  ];
  const visible = scanner.rows.filter(
    (e) =>
      phase === "ALL" ||
      (phase === "NEW"
        ? now - Date.parse(e.launchTime) < 86400000
        : e.state === phase),
  );
  async function loadMore() {
    if (loading || running.current || !directory.nextCursor || pages.current >= 8) return;
    running.current = true;
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
      pages.current++;
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      running.current = false;
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
          .filter((s) => indexedSources.includes(s) || entries.some((e) => e.source === s))
          .map((s) => (
            <Link
              key={s}
              href={`/launches?${new URLSearchParams({ source: s, ...(query ? { q: query } : {}) })}`}
              aria-current={source === s ? "page" : undefined}
            >
              {s === "PONS" ? "Pons" : "StonkBrokers"}
            </Link>
          ))}
      </nav>
      {(
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
      )}
      <ScannerUpdates pending={scanner.pending} newCount={scanner.newCount} onShow={scanner.showUpdates} />
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
      {(delayed || directory.status === "unavailable") && entries.length ? (
        <p className="rmtLaunchCoverage" role="status">
          Launch updates delayed. Showing recorded origins.
        </p>
      ) : null}
      {error ? (
        <p role="status" className="rmtLaunchCoverage">
          More launches could not be loaded.
        </p>
      ) : null}
      {directory.nextCursor && pages.current < 8 ? (
        <button
          className="rmtLaunchMore"
          type="button"
          disabled={loading}
          onClick={loadMore}
        >
          {loading ? "Loading…" : "More launches"}
        </button>
      ) : null}
      {directory.nextCursor && pages.current >= 8 ? <p className="rmtLaunchCoverage">Showing the latest loaded window. Narrow by source or search for older launches.</p> : null}
    </section>
  );
}
