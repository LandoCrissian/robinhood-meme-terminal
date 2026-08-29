"use client";

import { useEffect, useId, useState } from "react";
import { formatTerminalCompactUsd, formatTerminalPercent } from "./terminal-format";
import styles from "./vnext-chain-pulse-card.module.css";

type CapitalFlow = {
  schemaVersion: 1;
  chainId: 4663;
  chain: "Robinhood Chain";
  source: "DEFILLAMA";
  authoritative: false;
  status: "ready" | "partial" | "unavailable";
  stablecoinMarketCapUsd: number | null;
  stablecoinChange7dPct: number | null;
  usdgMarketCapUsd: number | null;
  usdgDominancePct: number | null;
};

function sanitize(payload: unknown): CapitalFlow | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.chainId !== 4663 || value.chain !== "Robinhood Chain" || value.source !== "DEFILLAMA" || value.authoritative !== false) return undefined;
  if (value.status !== "ready" && value.status !== "partial" && value.status !== "unavailable") return undefined;
  const metric = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
  const percentage = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 && candidate <= 100 ? candidate : null;
  const change = typeof value.stablecoinChange7dPct === "number" && Number.isFinite(value.stablecoinChange7dPct) ? value.stablecoinChange7dPct : null;
  return {
    schemaVersion: 1, chainId: 4663, chain: "Robinhood Chain", source: "DEFILLAMA", authoritative: false,
    status: value.status,
    stablecoinMarketCapUsd: metric(value.stablecoinMarketCapUsd),
    stablecoinChange7dPct: change,
    usdgMarketCapUsd: metric(value.usdgMarketCapUsd),
    usdgDominancePct: percentage(value.usdgDominancePct)
  };
}

export function VNextCapitalFlowCard() {
  const [flow, setFlow] = useState<CapitalFlow>();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/vnext/capital-flow", { signal: controller.signal })
      .then(async (response) => sanitize(await response.json()))
      .then((payload) => { if (!controller.signal.aborted) setFlow(payload); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const stablecoins = flow?.stablecoinMarketCapUsd ?? null;
  const change = flow?.stablecoinChange7dPct ?? null;
  const status = flow?.status ?? "unavailable";
  const context = change === null ? "Flow unavailable" : change > 0 ? "Stablecoin liquidity expanding" : change < 0 ? "Stablecoin liquidity contracting" : "Stablecoin liquidity unchanged";
  return <section className={styles.chainPulseCard} aria-label="Robinhood Chain capital flow" data-chain-pulse-expanded={expanded}>
    <button className={styles.disclosure} type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((current) => !current)}>
      <span className={styles.summaryIdentity}><strong>Capital Flow</strong><span>Stablecoins {stablecoins === null ? "Unavailable" : formatTerminalCompactUsd(stablecoins)} · {change === null ? "7d unavailable" : `${formatTerminalPercent(change)} 7d`} · {context}</span></span>
      <span className={styles.disclosureMeta}><small>{status === "ready" ? "LIVE" : status === "partial" ? "PARTIAL DATA" : "DATA UNAVAILABLE"}</small><span className={styles.chevron} aria-hidden="true">⌄</span></span>
    </button>
    {expanded ? <div className={styles.details} id={detailsId}>
      <header className={styles.cardHeader}><div><h2 className={styles.cardTitle}>CAPITAL FLOW</h2><p className={styles.cardSubLabel}>Market context · DeFiLlama</p></div><span className={styles.cardStatus}>{status}</span></header>
      <dl className={styles.metrics}>
        <div className={styles.metric}><dt>Stablecoin liquidity</dt><dd>{stablecoins === null ? "Unavailable" : formatTerminalCompactUsd(stablecoins)}</dd></div>
        <div className={styles.metric}><dt>Stablecoin change 7d</dt><dd>{change === null ? "Unavailable" : formatTerminalPercent(change)}</dd></div>
        <div className={styles.metric}><dt>USDG on Robinhood</dt><dd>{flow?.usdgMarketCapUsd === null || flow?.usdgMarketCapUsd === undefined ? "Unavailable" : formatTerminalCompactUsd(flow.usdgMarketCapUsd)}</dd></div>
        <div className={styles.metric}><dt>USDG share</dt><dd>{flow?.usdgDominancePct === null || flow?.usdgDominancePct === undefined ? "Unavailable" : `${flow.usdgDominancePct.toFixed(1)}%`}</dd></div>
      </dl>
      <footer className={styles.cardFooter}><small>Third-party chain context · Non-authoritative · not execution evidence</small></footer>
    </div> : null}
  </section>;
}
