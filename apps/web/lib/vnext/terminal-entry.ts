import { projectById } from "@rmt/shared/project-identity";
import type { VNextDirectoryMarket } from "./market-directory";
import type { VNextTerminalLocation } from "./terminal-location";

/** Server-derived presentation seed. A URL never supplies metadata or units.
 * Only the existing exact verified project asset may seed its identity. */
export function projectTokenTerminalEntry(location: VNextTerminalLocation, projectId?: string): VNextDirectoryMarket | undefined {
  if (location.context !== "asset" || !projectId) return undefined;
  const asset = projectById(projectId)?.assets.find(candidate => candidate.kind === "ERC20"
    && candidate.chainId === 4663 && candidate.verification === "VERIFIED"
    && candidate.contract.toLowerCase() === location.market.toLowerCase());
  if (!asset) return undefined;
  const name = asset.name ?? asset.symbol ?? asset.contract;
  const symbol = asset.symbol ?? asset.name ?? asset.contract;
  const trustedUnits = asset.decimals !== undefined && asset.evidence?.some(e => e.class === "ONCHAIN_VERIFIED");
  return {
    address: asset.contract, name, symbol,
    priceUsd: null, liquidityUsd: null, marketCapUsd: null, fdvUsd: null,
    volume5m: null, volume1h: null, volume24h: null,
    priceChange5m: null, priceChange1h: null, priceChange24h: null,
    buys5m: null, sells5m: null, buys1h: null, sells1h: null, buys24h: null, sells24h: null,
    pairCreatedAt: null, ageMinutes: null, momentumScore: null, buyPressureBps: null,
    riskFlags: null, signal: null,
    ...(trustedUnits ? { verifiedIdentity: { address: asset.contract, name, symbol, decimals: asset.decimals! } } : {})
  };
}
