"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EXPERIENCE_STAGES,
  EXPERIENCE_STAGE_COPY,
  type ExperienceDevice,
  type ExperienceStage
} from "../../../lib/experience-funnel";

type FunnelCounts = Partial<Record<"all" | ExperienceDevice, Partial<Record<ExperienceStage, number>>>>;
type FunnelDay = { day: string; counts: FunnelCounts };

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function percentage(count: number, visits: number) {
  if (visits <= 0) return "—";
  return `${Math.min(999, Math.round((count / visits) * 100))}%`;
}

export function ExperienceFunnelInsights({ admin }: { admin: User }) {
  const [days, setDays] = useState<FunnelDay[]>([]);
  const [reportingDays, setReportingDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const token = await admin.getIdToken();
      const response = await fetch("/api/experience/funnel", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ operation: "list" })
      });
      const payload = await response.json() as { days?: FunnelDay[]; reportingDays?: number; error?: string };
      if (!response.ok || !Array.isArray(payload.days)) throw new Error(payload.error || "Experience milestones could not be loaded.");
      setDays(payload.days);
      setReportingDays(typeof payload.reportingDays === "number" ? payload.reportingDays : 14);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Experience milestones could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const result: Record<"all" | ExperienceDevice, Record<ExperienceStage, number>> = {
      all: Object.fromEntries(EXPERIENCE_STAGES.map((stage) => [stage, 0])) as Record<ExperienceStage, number>,
      mobile: Object.fromEntries(EXPERIENCE_STAGES.map((stage) => [stage, 0])) as Record<ExperienceStage, number>,
      desktop: Object.fromEntries(EXPERIENCE_STAGES.map((stage) => [stage, 0])) as Record<ExperienceStage, number>
    };
    for (const day of days) {
      for (const device of ["all", "mobile", "desktop"] as const) {
        for (const stage of EXPERIENCE_STAGES) {
          result[device][stage] += safeCount(day.counts?.[device]?.[stage]);
        }
      }
    }
    return result;
  }, [days]);

  const visits = totals.all.visit_started;

  return (
    <section className="adminActivationSection experienceFunnelAdmin" id="experience-funnel" aria-labelledby="experience-funnel-title">
      <header className="adminReviewHeader">
        <div>
          <p className="eyebrow">OPT-IN PRODUCT SIGNALS</p>
          <h2 id="experience-funnel-title">Visitor journey</h2>
          <p>Anonymous milestone totals from visitors who explicitly enabled diagnostics. No wallet, token, amount, search, email, profile, cookie, or persistent visitor ID is collected.</p>
        </div>
        <div className="adminHeaderActions"><span>LATEST {reportingDays} DAYS</span><button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button></div>
      </header>
      {message && <p className="adminReviewMessage" role="alert">{message}</p>}
      {!loading && !message && visits === 0 && <section className="panel adminAccessState"><h2>No opted-in visits yet</h2><p>The dashboard will populate after visitors choose to share anonymous journey milestones.</p></section>}
      {visits > 0 && (
        <>
          <div className="experienceFunnelSummary">
            <span><small>Opted-in visits</small><strong>{visits.toLocaleString()}</strong></span>
            <span><small>Mobile</small><strong>{totals.mobile.visit_started.toLocaleString()}</strong></span>
            <span><small>Desktop</small><strong>{totals.desktop.visit_started.toLocaleString()}</strong></span>
            <span><small>Quote reached</small><strong>{percentage(totals.all.quote_ready, visits)}</strong></span>
          </div>
          <div className="experienceFunnelRows" role="table" aria-label={`Latest ${reportingDays} days of anonymous visitor journey`}>
            {EXPERIENCE_STAGES.map((stage, index) => (
              <div className="experienceFunnelRow" role="row" key={stage}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div role="cell"><strong>{EXPERIENCE_STAGE_COPY[stage].label}</strong><small>{EXPERIENCE_STAGE_COPY[stage].detail}</small></div>
                <div role="cell"><small>All</small><strong>{totals.all[stage].toLocaleString()}</strong></div>
                <div role="cell"><small>Reach</small><strong>{percentage(totals.all[stage], visits)}</strong></div>
                <div role="cell"><small>Mobile / desktop</small><strong>{totals.mobile[stage].toLocaleString()} / {totals.desktop[stage].toLocaleString()}</strong></div>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="experienceFunnelDisclosure">Counts represent once-per-browser-session milestones among opted-in visitors. They are directional product signals, not unique people, attribution, financial activity, or a complete traffic count.</p>
    </section>
  );
}
