"use client";

import { useEffect, useState } from "react";
import type { SystemHealthReport } from "../../lib/system-health";

export function SystemStatus({ initialReport }: { initialReport: SystemHealthReport }) {
  const [report, setReport] = useState(initialReport);

  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const next = await response.json() as SystemHealthReport;
        setReport(next);
      } catch {
        setReport((current) => ({ ...current, ok: false, checkedAt: new Date().toISOString() }));
      }
    };
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <section className="panel statusHero">
        <div className={report.ok ? "statusPulse operational" : "statusPulse degraded"} aria-hidden="true" />
        <div>
          <p className="eyebrow">SYSTEM STATUS</p>
          <h1>{report.ok ? "All launch systems operational" : "Some systems need review"}</h1>
          <p>{report.network} · Block {report.latestBlock}</p>
          <small>Checked {new Date(report.checkedAt).toLocaleTimeString()} · {report.latencyMs}ms verification · Refreshes every 15 seconds</small>
        </div>
      </section>

      <section className="statusGrid" aria-label="Live protocol checks">
        {report.checks.map((item) => (
          <article className="panel statusCard" key={item.key}>
            <div><span className={`statusDot ${item.state}`} aria-hidden="true" /><strong>{item.label}</strong></div>
            <span>{item.state === "operational" ? "Operational" : "Review"}</span>
            <p>{item.detail}</p>
          </article>
        ))}
      </section>

      <section className="panel safeguardPanel">
        <p className="eyebrow">BUILT-IN SAFEGUARDS</p>
        <h2>Fair Start protects every new launch</h2>
        <div className="safeguardGrid">
          <div><strong>3-block delay</strong><span>No immediate same-block launch buy.</span></div>
          <div><strong>25-block window</strong><span>Early-wallet limits remain active automatically.</span></div>
          <div><strong>One buy per block</strong><span>Each wallet gets one protected-window buy per block.</span></div>
          <div><strong>No alternate recipient</strong><span>Protected buys cannot silently route tokens elsewhere.</span></div>
        </div>
        <p className="statusFineprint">These controls reduce common launch-sniping advantages; they do not promise bot-free trading or eliminate market risk.</p>
      </section>
    </>
  );
}
