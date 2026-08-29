"use client";

import { useEffect, useId, useState } from "react";
import { capitalFlowStatusLabel, type VNextCapitalFlowCardStatus } from "../../lib/vnext/terminal-presentation-state";
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

type CardState =
  | { status: "loading"; flow: undefined }
  | { status: CapitalFlow["status"]; flow: CapitalFlow | undefined }
  | { status: "error"; flow: undefined };

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
  const [state, setState] = useState<CardState>({ status: "loading", flow: undefined });
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/vnext/capital-flow", { signal: controller.signal });
        if (!response.ok) {
          if (!controller.signal.aborted) setState({ status: "unavailable", flow: undefined });
          return;
        }
        const flow = sanitize(await response.json());
        if (controller.signal.aborted) return;
        setState(flow ? { status: flow.status, flow } : { status: "unavailable", flow: undefined });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", flow: undefined });
      }
    };
    void load();
    return () => controller.abort();
  }, []);
  const flow = state.flow;
  const stablecoins = flow?.stablecoinMarketCapUsd ?? null;
  const change = flow?.stablecoinChange7dPct ?? null;
  const status: VNextCapitalFlowCardStatus = state.status;
  const loading = status === "loading";
  const context = loading ? "Waiting for market context" : change === null ? "Flow unavailable" : change > 0 ? "Stablecoin liquidity expanding" : change < 0 ? "Stablecoin liquidity contracting" : "Stablecoin liquidity unchanged";
  const metricValue = (value: number | null, formatter: (amount: number) => string) => loading ? "Checking…" : value === null ? "Unavailable" : formatter(value);
  return <section className={styles.chainPulseCard} aria-label="Robinhood Chain capital flow" aria-live="polite" data-chain-pulse-expanded={expanded}>
    <button className={styles.disclosure} type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((current) => !current)}>
      <span className={styles.summaryIdentity}><strong>Capital Flow</strong><span>{loading ? "Checking stablecoin liquidity · No values reported yet" : `Stablecoins ${stablecoins === null ? "Unavailable" : formatTerminalCompactUsd(stablecoins)} · ${change === null ? "7d unavailable" : `${formatTerminalPercent(change)} 7d`} · ${context}`}</span></span>
      <span className={styles.disclosureMeta}><small>{capitalFlowStatusLabel(status)}</small><span className={styles.chevron} aria-hidden="true">⌄</span></span>
    </button>
    {expanded ? <div className={styles.details} id={detailsId}>
      <header className={styles.cardHeader}><div><h2 className={styles.cardTitle}>CAPITAL FLOW</h2><p className={styles.cardSubLabel}>Market context · DeFiLlama</p></div><span className={styles.cardStatus}>{capitalFlowStatusLabel(status)}</span></header>
      <dl className={styles.metrics}>
        <div className={styles.metric}><dt>Stablecoin liquidity</dt><dd>{metricValue(stablecoins, formatTerminalCompactUsd)}</dd></div>
        <div className={styles.metric}><dt>Stablecoin change 7d</dt><dd>{metricValue(change, formatTerminalPercent)}</dd></div>
        <div className={styles.metric}><dt>USDG on Robinhood</dt><dd>{metricValue(flow?.usdgMarketCapUsd ?? null, formatTerminalCompactUsd)}</dd></div>
        <div className={styles.metric}><dt>USDG share</dt><dd>{metricValue(flow?.usdgDominancePct ?? null, (value) => `${value.toFixed(1)}%`)}</dd></div>
      </dl>
      <footer className={styles.cardFooter}><small>Third-party chain context · Non-authoritative · not execution evidence</small></footer>
    </div> : null}
  </section>;
}
