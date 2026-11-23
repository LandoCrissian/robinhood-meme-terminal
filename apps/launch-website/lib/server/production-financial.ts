import { createHash } from "node:crypto";
import { configuredCurveProductionRelease, curveProductionPins, curveProductionProfile, productionReaders, verifyCurveProduction } from "./curve-production";
import { configuredProductionDiscovery, readProductionDiscovery } from "./production-discovery";

export type ProductionFinancialScope = "trading" | "claims";
export type ProductionFinancialRelease = {
  schemaVersion: 1;
  profile: typeof curveProductionProfile;
  chainId: 4663;
  origin: "https://www.rmtlaunch.fun";
  baseReleaseSha256: string;
  scopes: ProductionFinancialScope[];
  ownerApprovalSha256: string;
  productionAdapterAcceptanceSha256: string;
  iPhoneAcceptanceSha256: string;
};
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const fields = ["schemaVersion", "profile", "chainId", "origin", "baseReleaseSha256", "scopes", "ownerApprovalSha256",
  "productionAdapterAcceptanceSha256", "iPhoneAcceptanceSha256"];

// These records attest to separately reviewed evidence. This module never creates
// owner approval, physical-device acceptance, publication or finality evidence.
export function parseProductionFinancialRelease(raw: string | undefined, expectedSha256: string | undefined,
  baseReleaseSha256: string | undefined): ProductionFinancialRelease | null {
  if (!raw || raw.length > 4_096 || !sha256(expectedSha256) || !sha256(baseReleaseSha256) || digest(raw) !== expectedSha256) return null;
  try {
    const data = JSON.parse(raw) as ProductionFinancialRelease;
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== fields.length
      || !fields.every(field => Object.hasOwn(data, field)) || data.schemaVersion !== 1 || data.profile !== curveProductionProfile
      || data.chainId !== 4663 || data.origin !== "https://www.rmtlaunch.fun" || data.baseReleaseSha256 !== baseReleaseSha256
      || ![data.ownerApprovalSha256, data.productionAdapterAcceptanceSha256, data.iPhoneAcceptanceSha256].every(sha256)
      || !Array.isArray(data.scopes) || !data.scopes.length || data.scopes.length > 2
      || data.scopes.some(scope => scope !== "trading" && scope !== "claims") || new Set(data.scopes).size !== data.scopes.length) return null;
    return data;
  } catch { return null; }
}

export function configuredProductionFinancial(headers: Headers, scope: ProductionFinancialScope,
  env: Record<string, string | undefined> = process.env, requireOrigin = true) {
  const flag = scope === "trading" ? env.RMT_CURVE_PRODUCTION_TRADING : env.RMT_CURVE_PRODUCTION_CLAIMS;
  if (flag !== (scope === "trading" ? "owner-trading-approved" : "owner-claims-approved")
    || !configuredProductionDiscovery(headers, env)) return null;
  const release = configuredCurveProductionRelease(headers, env, requireOrigin);
  const financial = parseProductionFinancialRelease(env.RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE,
    env.RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE_SHA256, env.RMT_CURVE_PRODUCTION_RELEASE_SHA256);
  if (!release || !financial?.scopes.includes(scope)) return null;
  // Non-secret, scope-specific binding invalidates an open wallet review whenever
  // the approved financial record or its base production release changes.
  const approvalBinding = digest(`${scope}:${env.RMT_CURVE_PRODUCTION_RELEASE_SHA256}:${env.RMT_CURVE_PRODUCTION_FINANCIAL_RELEASE_SHA256}`);
  return { release, approvalBinding, scope };
}

// Page presence reflects the trusted, approved configuration. Network readiness
// is checked independently before preparation; a temporary outage must not erase
// the order form or be presented as a revoked trading capability.
export function configuredProductionFinancialPage(headers: Headers, scope: ProductionFinancialScope,
  env: Record<string, string | undefined> = process.env) {
  return configuredProductionFinancial(headers, scope, env, false);
}

// A capability lookup is a release/configuration read, not a quote or an on-chain
// readiness statement. The state/quote/prepare handlers still corroborate the
// complete deployment and current state; submission also revalidates the exact
// prior request and wallet. Keeping this response pure avoids repeating those
// RPC checks twice more while a user is confirming an already reviewed trade.
export function configuredProductionFinancialCapabilities(headers: Headers,
  env: Record<string, string | undefined> = process.env) {
  const trading = configuredProductionFinancialPage(headers, "trading", env);
  const claims = configuredProductionFinancialPage(headers, "claims", env);
  if (!trading && !claims) return null;
  return { status: "production-financial", readiness: "check-on-prepare", chainId: 4663,
    factory: curveProductionPins.factory[0], trading: trading ? "enabled" : "disabled", claims: claims ? "enabled" : "disabled",
    approvals: { ...(trading && { trading: trading.approvalBinding }), ...(claims && { claims: claims.approvalBinding }) } } as const;
}

export async function productionReleaseReadiness(release: NonNullable<ReturnType<typeof configuredProductionFinancial>>["release"],
  options: { verify?: typeof verifyCurveProduction; discovery?: typeof readProductionDiscovery } = {}): Promise<"ready" | "unavailable"> {
  try {
    const [, discovery] = await Promise.all([(options.verify ?? verifyCurveProduction)(release),
      (options.discovery ?? readProductionDiscovery)()]);
    return discovery.status === "ready" ? "ready" : "unavailable";
  } catch { return "unavailable"; }
}

export async function resolveProductionFinancialContext(headers: Headers, scope: ProductionFinancialScope) {
  const configured = configuredProductionFinancial(headers, scope);
  if (!configured) throw new Error("Production financial capability unavailable");
  return { ...configured, ...await verifyCurveProduction(configured.release, productionReaders(scope === "trading" ? "financial" : true)), feePolicy: "nitro-zero-poster-corroborated-v1" as const };
}

export async function availableProductionFinancial(headers: Headers, scope: ProductionFinancialScope) {
  const configured = configuredProductionFinancialPage(headers, scope);
  if (!configured) return null;
  return await productionReleaseReadiness(configured.release) === "ready" ? configured : null;
}
