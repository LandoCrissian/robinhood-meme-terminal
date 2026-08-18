"use client";

import { useEffect, useState } from "react";
import {
  formatTerminalCompactUsd,
  formatTerminalPercent
} from "./terminal-format";
import styles from "./vnext-chain-pulse-card.module.css";

type PulseStatus = "ready" | "partial" | "unavailable";

type ChainPulseCardPayload = {
  status: PulseStatus;
  tvlUsd: number | null;
  dexVolume24hUsd: number | null;
  dexVolume7dUsd: number | null;
  dexChange1dPct: number | null;
  dexChange7dPct: number | null;
  fees24hUsd: number | null;
  fees7dUsd: number | null;
  revenue24hUsd: number | null;
  revenue7dUsd: number | null;
  protocolRevenue24hUsd: number | null;
  protocolRevenue7dUsd: number | null;
};

const STATUS_LABELS: Record<PulseStatus, string> = {
  ready: "LIVE",
  partial: "PARTIAL DATA",
  unavailable: "DATA UNAVAILABLE"
};

type CardState =
  | { status: "loading"; pulse: undefined }
  | { status: PulseStatus; pulse: ChainPulseCardPayload | undefined }
  | { status: "error"; pulse: undefined };

type CardMetric = {
  label: string;
  value: string;
};

function isPulseStatus(value: unknown): value is PulseStatus {
  return value === "ready" || value === "partial" || value === "unavailable";
}

function sanitizePulse(payload: unknown): ChainPulseCardPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const candidate = payload as Partial<Record<string, unknown>>;
  if (!isPulseStatus(candidate.status)) return undefined;

  const numericOrNull = (value: unknown): number | null => {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  return {
    status: candidate.status,
    tvlUsd: numericOrNull(candidate.tvlUsd),
    dexVolume24hUsd: numericOrNull(candidate.dexVolume24hUsd),
    dexVolume7dUsd: numericOrNull(candidate.dexVolume7dUsd),
    dexChange1dPct: numericOrNull(candidate.dexChange1dPct),
    dexChange7dPct: numericOrNull(candidate.dexChange7dPct),
    fees24hUsd: numericOrNull(candidate.fees24hUsd),
    fees7dUsd: numericOrNull(candidate.fees7dUsd),
    revenue24hUsd: numericOrNull(candidate.revenue24hUsd),
    revenue7dUsd: numericOrNull(candidate.revenue7dUsd),
    protocolRevenue24hUsd: numericOrNull(candidate.protocolRevenue24hUsd),
    protocolRevenue7dUsd: numericOrNull(candidate.protocolRevenue7dUsd)
  };
}

function formatUsd(value: number | null) {
  return value === null ? "Unavailable" : formatTerminalCompactUsd(value);
}

function formatPct(value: number | null) {
  return value === null ? "Unavailable" : formatTerminalPercent(value);
}

function buildMetrics(pulse: ChainPulseCardPayload | undefined): CardMetric[] {
  return [
    { label: "TVL", value: formatUsd(pulse?.tvlUsd ?? null) },
    { label: "DEX volume 24h", value: formatUsd(pulse?.dexVolume24hUsd ?? null) },
    { label: "DEX volume 7d", value: formatUsd(pulse?.dexVolume7dUsd ?? null) },
    { label: "DEX change 24h", value: formatPct(pulse?.dexChange1dPct ?? null) },
    { label: "DEX change 7d", value: formatPct(pulse?.dexChange7dPct ?? null) },
    { label: "Fees 24h", value: formatUsd(pulse?.fees24hUsd ?? null) },
    { label: "Revenue 24h", value: formatUsd(pulse?.revenue24hUsd ?? null) },
    { label: "Protocol revenue 24h", value: formatUsd(pulse?.protocolRevenue24hUsd ?? null) }
  ];
}

export function VNextChainPulseCard() {
  const [state, setState] = useState<CardState>({ status: "loading", pulse: undefined });

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch("/api/vnext/chain-pulse", { signal: controller.signal });
        if (!response.ok) {
          setState({ status: "unavailable", pulse: undefined });
          return;
        }

        const payload = await response.json();
        if (controller.signal.aborted) return;
        const pulse = sanitizePulse(payload);
        if (!pulse) {
          setState({ status: "unavailable", pulse: undefined });
          return;
        }
        setState({ status: pulse.status, pulse });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", pulse: undefined });
      }
    };

    void load();

    return () => {
      controller.abort();
    };
  }, []);

  const status = state.status === "error" ? "unavailable" : state.status;
  const metrics = buildMetrics(state.pulse);

  return (
    <section className={styles.chainPulseCard} aria-label="Robinhood chain pulse" aria-live="polite">
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>ROBINHOOD CHAIN PULSE</h2>
          <p className={styles.cardSubLabel}>Market intelligence · DefiLlama</p>
        </div>
        <span className={styles.cardStatus}>
          {status === "loading" ? "CHECKING" : STATUS_LABELS[status]}
        </span>
      </header>
      <dl className={styles.metrics}>
        {metrics.map((metric) => (
          <div key={metric.label} className={styles.metric}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
      <footer className={styles.cardFooter}><small>Third-party market context · Non-authoritative</small></footer>
    </section>
  );
}
