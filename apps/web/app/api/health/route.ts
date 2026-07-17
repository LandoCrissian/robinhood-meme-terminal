import { readFreshSystemHealth } from "../../../lib/server/system-health";
import { sharedCacheHeaders } from "../../../lib/server/cache-headers";

export const dynamic = "force-dynamic";

export async function GET() {
  // The CDN provides the short shared cache for this endpoint. Using Next's
  // stale-while-revalidate data cache here can return an arbitrarily old first
  // response after an idle period, which makes the health timestamp unreliable.
  const report = await readFreshSystemHealth();
  return Response.json(report, {
    status: report.ok ? 200 : 503,
    headers: sharedCacheHeaders({
      sharedMaxAgeSeconds: 15,
      staleWhileRevalidateSeconds: 30
    })
  });
}
