import { getAddress } from "viem";
import { geckoPresentationReader, geckoTokenUrl, parseTokenVisual } from "./gecko-presentation-reader";
import { tokenChartReader } from "./token-chart-market";

export async function readTokenPresentationCategory(contract: string, category: "visual" | "market", pool?: string) {
  const exact = getAddress(contract);
  const provenance = category === "visual" ? "GECKOTERMINAL_TOKEN_INFO" : "GECKOTERMINAL_TOKEN_POOLS";
  try {
    const result = category === "visual"
      ? await geckoPresentationReader.read(geckoTokenUrl(exact, "info"), value => parseTokenVisual(value, exact), 15 * 60_000, 24 * 60 * 60_000)
      : await tokenChartReader.selectedMarket(exact, pool);
    const data = result.data;
    return { chainId: 4663 as const, contract: exact, state: data === null ? "UNAVAILABLE" as const : result.stale ? "STALE" as const : "READY" as const, data, observedAt: result.observedAt, provenance };
  } catch {
    return { chainId: 4663 as const, contract: exact, state: "UNAVAILABLE" as const, data: null, observedAt: null, provenance };
  }
}
