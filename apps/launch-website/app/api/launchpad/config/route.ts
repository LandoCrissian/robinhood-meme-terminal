import { headers } from "next/headers";
import { configuredCurveProductionRelease, curveProductionPins } from "../../../../lib/server/curve-production";
import { productionCreationEnabled } from "../../../../lib/server/production-creation";
import { configuredProductionDiscovery } from "../../../../lib/server/production-discovery";
import { configuredProductionFinancialCapabilities, productionReleaseReadiness } from "../../../../lib/server/production-financial";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestHeaders = await headers();
  const financial = configuredProductionFinancialCapabilities(requestHeaders);
  const creation = productionCreationEnabled() && configuredProductionDiscovery(requestHeaders)
    ? configuredCurveProductionRelease(requestHeaders, process.env, false) : null;
  if (financial) return Response.json({ ...financial, creation: creation ? "owner-only" : "disabled" },
    { headers: { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  if (creation) {
    const readiness = await productionReleaseReadiness(creation);
    return Response.json({ status: "owner-creation-only", readiness, chainId: 4663,
      factory: curveProductionPins.factory[0], creation: "owner-only", trading: "disabled", claims: "disabled",
      ...(readiness === "unavailable" && { reason: "Current network verification is unavailable. Try again shortly." }) },
    { status: readiness === "ready" ? 200 : 503,
      headers: { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  }
  return Response.json({
    status: "disabled",
    reason: "Website transactions are not enabled.",
  }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
