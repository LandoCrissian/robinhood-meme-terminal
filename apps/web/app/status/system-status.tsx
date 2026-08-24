"use client";

import { useEffect, useState } from "react";
import type { SystemHealthReport } from "../../lib/system-health";

const statusTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC"
});

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
          <h1>{report.ok ? "Terminal systems healthy" : "Some Terminal systems need review"}</h1>
          <p>{report.network} · Block {report.latestBlock}</p>
          <small>Checked {statusTimeFormatter.format(new Date(report.checkedAt))} UTC · {report.latencyMs}ms verification · Refreshes every 15 seconds</small>
        </div>
      </section>

      <div className="statusTerminalTape" aria-label="Status refresh information">
        <span><b>NETWORK</b>{report.network}</span>
        <span><b>HEAD</b>{report.latestBlock}</span>
        <span><b>VERIFY</b>{report.latencyMs}MS</span>
        <span><b>REFRESH</b>15S</span>
      </div>

      <section className="statusGrid" aria-label="Live Terminal checks">
        {report.checks.map((item) => (
          <article className="panel statusCard" key={item.key}>
            <div><span className={`statusDot ${item.state}`} aria-hidden="true" /><strong>{item.label}</strong></div>
            <span>{item.state === "operational" ? "Operational" : "Review"}</span>
            <p>{item.detail}</p>
          </article>
        ))}
      </section>

      <section className="panel safeguardPanel">
        <p className="eyebrow">EXECUTION AVAILABILITY</p>
        <h2>Wallet execution remains owner-gated</h2>
        <p className="safeguardLead">Public wallet execution remains unavailable until the reviewed executor deployment and activation are explicitly authorized. This is informational and does not make market discovery unhealthy.</p>
      </section>

      <section className="panel safeguardPanel">
        <p className="eyebrow">BUILT-IN SAFEGUARDS</p>
        <h2>The Terminal separates discovery from execution authority</h2>
        <p className="safeguardLead">Markets stay visible when RMT has valid evidence. Wallet execution remains unavailable unless RMT can construct and independently verify the exact transaction the trader is asked to sign.</p>
        <div className="safeguardGrid">
          <div><strong>Exact chain</strong><span>Execution evidence is bound to Robinhood Chain ID 4663.</span></div>
          <div><strong>Exact assets</strong><span>Input and output contracts must match the selected trade.</span></div>
          <div><strong>Protected output</strong><span>The transaction must enforce the trader&apos;s reviewed minimum received.</span></div>
          <div><strong>Exact recipient</strong><span>Verified output is bound to the submitting wallet.</span></div>
          <div><strong>Evidence boundaries</strong><span>Provider observations inform markets without fabricating canonical status.</span></div>
          <div><strong>Self-custody</strong><span>The connected wallet remains the only signing authority.</span></div>
        </div>
        <p className="statusFineprint">These checks protect transaction integrity. They do not guarantee a market&apos;s legitimacy, liquidity, future value, or availability.</p>
      </section>
    </>
  );
}
