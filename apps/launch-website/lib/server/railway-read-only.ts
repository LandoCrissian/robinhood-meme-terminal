import { railwayEnvironment, railwayProject, railwayReadOnlyProfile, railwayWebsiteOrigin, railwayWebsiteService } from "./indexer-origin";

type Environment = Record<string, string | undefined>;
export function railwayHosting(env: Environment = process.env): { origin: string } | null {
  if (env.RMT_WEB_HOSTING !== railwayReadOnlyProfile || env.RAILWAY_PROJECT_ID !== railwayProject
    || env.RAILWAY_ENVIRONMENT_ID !== railwayEnvironment
    || env.RAILWAY_SERVICE_ID !== railwayWebsiteService
    || env.RMT_WEB_ORIGIN !== railwayWebsiteOrigin) return null;
  // Renaming a reused Railway service may leave its automatic public-domain
  // variables stale. The separately verified, explicitly pinned origin is the
  // request authority; automatic provider metadata never grants another host.
  return { origin: railwayWebsiteOrigin };
}

/** Single-container aggregate limits, independent of spoofable client-IP headers.
 * The reviewed Railway profile permits one replica. Restart clears only these
 * ephemeral abuse counters, never indexing/checkpoints or transaction journals. */
export function createRailwayRequestBudget(now: () => number = Date.now) {
  const counters = new Map<string, { window: number; count: number }>();
  return function admit(path: string, method: string): { allowed: boolean; retryAfter: number } {
    const window = Math.floor(now() / 60_000);
    const mutation = !["GET", "HEAD"].includes(method);
    const category = mutation && (path.startsWith("/api/account/") || ["/api/launchpad/production-creation", "/api/launchpad/production-earnings", "/api/launchpad/test-claim-profiles", "/api/launchpad/test-project-treasury"].includes(path))
      ? "account-mutation" : path === "/api/launchpad/creation-review" && method === "POST" ? "draft-review"
      : !mutation && !path.startsWith("/_next/static/") && !["/healthz", "/readyz"].includes(path) ? "reads" : null;
    if (!category) return { allowed: true, retryAfter: 0 };
    const limit = category === "account-mutation" ? 12 : category === "draft-review" ? 120 : 600;
    const current = counters.get(category);
    const count = current?.window === window ? current.count : 0;
    if (count >= limit) return { allowed: false, retryAfter: Math.max(1, 60 - Math.floor(now() / 1000) % 60) };
    counters.set(category, { window, count: count + 1 });
    return { allowed: true, retryAfter: 0 };
  };
}

export const admitRailwayRequest = createRailwayRequestBudget();
