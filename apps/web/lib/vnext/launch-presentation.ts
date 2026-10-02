import type {
  LaunchEvidence,
  LaunchState,
} from "@rmt/shared/launch-intelligence";
import type { VNextDirectoryMarket } from "./market-directory";
import type { VNextTerminalLocation } from "./terminal-location";
export const launchStateLabel: Record<LaunchState, string> = {
  LAUNCHED: "Launched",
  BONDING: "Bonding",
  GRADUATING: "Graduating",
  GRADUATED: "Graduated",
  ABORTED: "Aborted",
  RESCUED: "Rescued",
};
export const launchSourceLabel = (launch: Pick<LaunchEvidence, "source">) =>
  launch.source === "PONS" ? "pons" : "StonkBrokers";
export const launchNavigationHref = (
  launch: Pick<LaunchEvidence, "token" | "launchId">,
) =>
  `/?${new URLSearchParams({ market: launch.token, launch: launch.launchId })}`;
/** Exact address comes from the location. Optional identity comes ONLY from the authenticated launch reader. */
export function launchTerminalEntry(
  location: VNextTerminalLocation,
  launch?: LaunchEvidence,
): VNextDirectoryMarket | undefined {
  if (location.context !== "asset") return undefined;
  if (launch && launch.token !== location.market.toLowerCase())
    return undefined;
  const name = launch?.identity.name ?? location.market,
    symbol = launch?.identity.symbol ?? location.market;
  return {
    address: location.market,
    name,
    symbol,
    imageUri: launch?.identity.artwork ?? undefined,
    priceUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    volume5m: null,
    volume1h: null,
    volume24h: null,
    priceChange5m: null,
    priceChange1h: null,
    priceChange24h: null,
    buys5m: null,
    sells5m: null,
    buys1h: null,
    sells1h: null,
    buys24h: null,
    sells24h: null,
    pairCreatedAt: null,
    ageMinutes: null,
    momentumScore: null,
    buyPressureBps: null,
    riskFlags: null,
    signal: null,
    ...(launch ? { launchIntelligence: launch } : {}),
    ...(launch?.identityObservations?.decimals &&
    launch.identity.decimals !== null &&
    launch.identity.name &&
    launch.identity.symbol
      ? {
          verifiedIdentity: {
            address: location.market,
            name,
            symbol,
            decimals: launch.identity.decimals,
          },
        }
      : {}),
  };
}
