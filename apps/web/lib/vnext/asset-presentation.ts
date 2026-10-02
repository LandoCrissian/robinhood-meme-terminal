import { isAddress } from "viem";
import { projectsForContract } from "@rmt/shared/project-identity";
import type { VNextDirectoryMarket } from "./market-directory";
import { ROBINHOOD_USDG_ADDRESS } from "./robinhood-assets";

// Presentation classes never supply swap eligibility or units.
export type RmtAssetClass = "TOKEN" | "PROJECT" | "LAUNCH" | "STABLECOIN" | "RWA" | "STOCK_TOKEN" | "NFT_COLLECTION";
export const ASSET_CLASS_LABELS: Record<RmtAssetClass, string> = {
  TOKEN: "Token", PROJECT: "Project", LAUNCH: "Launch", STABLECOIN: "Stablecoin",
  RWA: "RWA", STOCK_TOKEN: "Stock Token", NFT_COLLECTION: "NFT collection",
};
export function assetPresentationClasses(market: VNextDirectoryMarket): RmtAssetClass[] {
  if (!isAddress(market.address, { strict: false })) return [];
  const classes: RmtAssetClass[] = market.rwaRelationship === "canonical-stock-token" ? ["STOCK_TOKEN"] : ["TOKEN"];
  if (market.address.toLowerCase() === ROBINHOOD_USDG_ADDRESS.toLowerCase()) classes.push("STABLECOIN");
  if (projectsForContract(market.address).length) classes.push("PROJECT");
  if (market.launchIntelligence?.evidenceClass === "ONCHAIN_VERIFIED" || market.launchpadEvidence?.some(e => ["verified-contract-state-and-events", "verified-factory-and-token-state", "verified-public-feed-and-contract-state"].includes(e.provenance))) classes.push("LAUNCH");
  // Paired stock evidence is a relationship, not this token's classification.
  return classes;
}

/** Future reference/launch edges require positive source evidence. No population here. */
export type AssetRelationshipPresentation = {
  chainId: 4663; contract: string;
  kind: "PROJECT_ASSET" | "RWA_REFERENCE" | "STOCK_UNDERLYING" | "LAUNCH_MARKET";
  source: string; evidenceUrl: string; observedAt: string;
  relatedContract?: string; referenceSymbol?: string;
};
