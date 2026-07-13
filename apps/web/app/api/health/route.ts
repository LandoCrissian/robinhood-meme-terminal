import { readSystemHealth } from "../../../lib/server/system-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await readSystemHealth();
  return Response.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" }
  });
}
