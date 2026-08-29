import { readVNextDefiLlamaCapitalFlow } from "../../../../lib/server/vnext-defillama-capital-flow";

export const runtime = "nodejs";

export async function GET() {
  const flow = await readVNextDefiLlamaCapitalFlow();
  return Response.json(flow, {
    status: flow.status === "unavailable" ? 503 : 200,
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" }
  });
}
