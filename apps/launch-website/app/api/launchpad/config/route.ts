import { headers } from "next/headers";
import { configuredCurveProductionRelease, curveProductionPins, verifyCurveProduction } from "../../../../lib/server/curve-production";
import { productionCreationEnabled } from "../../../../lib/server/production-creation";
import { configuredProductionDiscovery, readProductionDiscovery } from "../../../../lib/server/production-discovery";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestHeaders = await headers();
  const release = productionCreationEnabled() && configuredProductionDiscovery(requestHeaders)
    ? configuredCurveProductionRelease(requestHeaders, process.env, false) : null;
  if (release) {
    try {
      const [, discovery] = await Promise.all([verifyCurveProduction(release), readProductionDiscovery()]);
      if (discovery.status === "ready") return Response.json({ status: "owner-creation-only", chainId: 4663,
        factory: curveProductionPins.factory[0], trading: "disabled", claims: "disabled" },
      { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
    } catch { /* The read-only response remains the default. */ }
  }
  return Response.json({
    status: "disabled",
    reason: "Wallet signing and transactions are disabled in this read-only preview.",
  }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
