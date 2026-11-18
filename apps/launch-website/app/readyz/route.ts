import { readLaunchDirectory } from "../../lib/server/launch-data";
import { railwayHosting } from "../../lib/server/railway-read-only";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!railwayHosting()) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const directory = await readLaunchDirectory();
  const ready = directory.status === "ready" && directory.coverage === "v6-indexed";
  return Response.json({ status: ready ? "ready" : "degraded", discovery: directory.status,
    checkpoint: directory.checkpoint, finality: directory.finality }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
export async function HEAD() { const response = await GET(); return new Response(null, { status: response.status, headers: response.headers }); }
