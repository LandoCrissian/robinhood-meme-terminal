export const railwayReadOnlyProfile = "railway-read-only-v1";
export const railwayProject = "19587a6e-6f02-4cfa-b7db-f308934f697b";
export const railwayEnvironment = "539a42da-fb60-420f-b9fa-8c29af25ebbe";
export const railwayIndexerService = "27b1aa2c-77e5-4ed4-91a1-1951d68c488e";
export const railwayWebsiteService = "8e9c1c15-74b5-4262-8851-72603a3dfc98";
export const railwayWebsiteOrigin = "https://rmt-launch-website-preview.up.railway.app";
export const railwayIndexerOrigin = "http://robinhood-meme-terminal.railway.internal:3001";

/** Only the existing authenticated indexer's origin is admitted on the private
 * network. This never accepts a user-supplied URL, path, port or arbitrary host. */
export function indexerOrigin(value: string | undefined, env: Record<string, string | undefined> = process.env): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol === "https:") return url;
    return value === railwayIndexerOrigin + "/" && url.origin === railwayIndexerOrigin
      && env.RMT_WEB_HOSTING === railwayReadOnlyProfile
      && env.RAILWAY_PROJECT_ID === railwayProject && env.RAILWAY_ENVIRONMENT_ID === railwayEnvironment
      && env.RAILWAY_SERVICE_ID === railwayWebsiteService && env.RMT_INDEXER_SERVICE_ID === railwayIndexerService ? url : null;
  } catch { return null; }
}
