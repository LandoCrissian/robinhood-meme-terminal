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
        <p className="safeguardLead">Fair Start is a brief opening window, not a permanent trading restriction. It limits large early buys so bots or insiders cannot capture most of a launch before everyone else can react.</p>
        <div className="safeguardGrid">
          <div><strong>1-block opening delay</strong><span>Trading cannot be captured in the same block as launch.</span></div>
          <div><strong>10 protected blocks</strong><span>The temporary limits cover only the opening window.</span></div>
          <div><strong>1% maximum per buy</strong><span>No single opening purchase can take more than 1% of supply.</span></div>
          <div><strong>3% maximum per wallet</strong><span>Each wallet has a temporary opening allowance.</span></div>
          <div><strong>One buy per block</strong><span>A wallet cannot stack multiple buys into the same block.</span></div>
          <div><strong>Automatic expiry</strong><span>Normal buying begins automatically when the countdown ends. Once trading opens, selling remains available.</span></div>
        </div>
        <p className="statusFineprint">Protected buys must send tokens back to the buying wallet, preventing alternate-recipient workarounds. These controls reduce common launch-sniping advantages; they do not promise bot-free trading or eliminate market risk.</p>
      </section>
    </>
  );
}
