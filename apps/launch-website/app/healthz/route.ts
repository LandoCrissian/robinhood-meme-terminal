import { railwayHosting } from "../../lib/server/railway-read-only";
export const dynamic = "force-dynamic";
export function GET() {
  return railwayHosting() ? Response.json({ status: "ok", mode: "read-only" }, { headers: { "Cache-Control": "no-store" } })
    : new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
export function HEAD() { return new Response(null, { status: railwayHosting() ? 200 : 404, headers: { "Cache-Control": "no-store" } }); }
