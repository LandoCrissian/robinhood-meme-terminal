import { readSystemHealth } from "../../../lib/server/system-health";
import { sharedCacheHeaders } from "../../../lib/server/cache-headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await readSystemHealth();
  return Response.json(report, {
    status: report.ok ? 200 : 503,
    headers: sharedCacheHeaders({
      sharedMaxAgeSeconds: 15,
      staleWhileRevalidateSeconds: 30
    })
  });
}
