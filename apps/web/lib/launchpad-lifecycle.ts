import type { ExternalMarket, LaunchpadLifecycleEvidence } from "./external-market";

export const CURRENT_LAUNCH_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const RECENT_LAUNCH_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export function launchpadEvidenceIsBrowseRelevant(
  evidence: LaunchpadLifecycleEvidence,
  launchedAtMs: number | null,
  hasCanonicalMarket: boolean,
  nowMs = Date.now()
) {
  if (evidence.state === "aborted") return false;
  if (evidence.state === "curve-live" || evidence.state === "armed" || evidence.state === "swept") return true;
  if (launchedAtMs !== null && nowMs - launchedAtMs <= CURRENT_LAUNCH_WINDOW_MS) return true;
  const activityAt = evidence.activity.lastActivityAt === null
    ? Number.NaN
    : Date.parse(evidence.activity.lastActivityAt);
  if (Number.isFinite(activityAt) && nowMs - activityAt <= RECENT_LAUNCH_ACTIVITY_WINDOW_MS) return true;
  return evidence.state === "graduated" && hasCanonicalMarket;
}

export function mergeLaunchpadLifecycleEvidence(
  existing: LaunchpadLifecycleEvidence | undefined,
  candidate: LaunchpadLifecycleEvidence | undefined
) {
  if (!existing) return candidate;
  if (!candidate) return existing;
  if (existing.sourceId !== candidate.sourceId || existing.factory.toLowerCase() !== candidate.factory.toLowerCase()) {
    return existing.current ? existing : candidate;
  }
  const stateRank: Record<LaunchpadLifecycleEvidence["state"], number> = {
    created: 0,
    armed: 1,
    "curve-live": 2,
    swept: 3,
    graduated: 4,
    aborted: 5
  };
  const preferred = stateRank[candidate.state] >= stateRank[existing.state] ? candidate : existing;
  const other = preferred === candidate ? existing : candidate;
  return {
    ...other,
    ...preferred,
    activity: {
      buys1h: preferred.activity.buys1h ?? other.activity.buys1h,
      sells1h: preferred.activity.sells1h ?? other.activity.sells1h,
      buys24h: preferred.activity.buys24h ?? other.activity.buys24h,
      sells24h: preferred.activity.sells24h ?? other.activity.sells24h,
      volumeQuote24h: preferred.activity.volumeQuote24h ?? other.activity.volumeQuote24h,
      lastActivityAt: [preferred.activity.lastActivityAt, other.activity.lastActivityAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null
    }
  };
}

export function mergeLaunchpadEvidenceOntoMarket<T extends Pick<ExternalMarket, "project" | "launchpadEvidence">>(
  market: T,
  evidenceMarket: Pick<ExternalMarket, "project" | "launchpadEvidence">
): T {
  const evidence = new Map<string, LaunchpadLifecycleEvidence>();
  for (const candidate of [...(market.launchpadEvidence ?? []), ...(evidenceMarket.launchpadEvidence ?? [])]) {
    const key = `${candidate.sourceId}:${candidate.version}:${candidate.factory}`.toLowerCase();
    evidence.set(key, mergeLaunchpadLifecycleEvidence(evidence.get(key), candidate) ?? candidate);
  }
  return {
    ...market,
    project: market.project ?? evidenceMarket.project,
    launchpadEvidence: [...evidence.values()]
  };
}
