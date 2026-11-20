import { headers } from "next/headers";
import { configuredCurveProductionRelease, curveProductionPins, verifyCurveProduction } from "../../../../lib/server/curve-production";
import { productionCreationEnabled } from "../../../../lib/server/production-creation";
import { configuredProductionDiscovery, readProductionDiscovery } from "../../../../lib/server/production-discovery";
import { configuredProductionFinancial } from "../../../../lib/server/production-financial";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestHeaders = await headers();
  const trading = configuredProductionFinancial(requestHeaders, "trading", process.env, false);
  const claims = configuredProductionFinancial(requestHeaders, "claims", process.env, false);
  const creation = productionCreationEnabled() && configuredProductionDiscovery(requestHeaders)
    ? configuredCurveProductionRelease(requestHeaders, process.env, false) : null;
  const release = trading?.release ?? claims?.release ?? creation;
  if (release) {
    try {
      const [, discovery] = await Promise.all([verifyCurveProduction(release), readProductionDiscovery()]);
      if (discovery.status === "ready" && (trading || claims)) return Response.json({ status: "production-financial", chainId: 4663,
        factory: curveProductionPins.factory[0], creation: creation ? "owner-only" : "disabled", trading: trading ? "enabled" : "disabled",
        claims: claims ? "enabled" : "disabled", approvals: { ...(trading && { trading: trading.approvalBinding }), ...(claims && { claims: claims.approvalBinding }) } },
      { headers: { "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
      if (discovery.status === "ready" && creation) return Response.json({ status: "owner-creation-only", chainId: 4663,
        factory: curveProductionPins.factory[0], trading: "disabled", claims: "disabled" },
      { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
    } catch { /* The read-only response remains the default. */ }
  }
  return Response.json({
    status: "disabled",
    reason: "Wallet signing and transactions are disabled in this read-only preview.",
  }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
