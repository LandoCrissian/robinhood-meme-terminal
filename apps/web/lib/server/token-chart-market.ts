import { getAddress, isAddress } from "viem";
import { externalChartRefreshMs, externalOhlcvRequestUrl, hasCatastrophicOhlcvPriceMismatch, parseExternalOhlcvList, type ExternalChartRange, type ExternalOhlcvPayload } from "../external-ohlcv";
import { rmtCuratedMarketByToken } from "../vnext/curated-market-registry";
import { geckoPresentationReader, geckoTokenUrl, parseTokenPools, PresentationProviderError } from "./gecko-presentation-reader";

/** Presentation evidence only; no execution route imports this reader. */
export function createTokenChartReader(reader = geckoPresentationReader, canonical = (token: string) => rmtCuratedMarketByToken(token)?.market.poolKey ?? null) {
  const markets = (token: string) => reader.read(geckoTokenUrl(token, "pools"), value => parseTokenPools(value, token), 5 * 60_000);
  async function chart(token: string, hint: string | null, range: ExternalChartRange, referencePrice: number | null): Promise<ExternalOhlcvPayload> {
    const exact = getAddress(token);
    // The workspace already selects its current canonical RMT market before an
    // observed pool. A validated hint can be newer than the reviewed seed list.
    const preferred = hint ?? canonical(exact);
    const resolution = preferred ? null : await markets(exact);
    const pool = preferred ?? resolution?.data[0]?.pool ?? null;
    if (!pool) return { token: exact, pair: "", range, candles: [], source: "GeckoTerminal", coverage: "NO_HISTORY", updatedAt: resolution!.observedAt, lastTradeAt: null, refreshMs: externalChartRefreshMs(range), stale: resolution!.stale };
    const readPool = async (selected: string) => {
      const result = await reader.read(externalOhlcvRequestUrl(selected.toLowerCase(), range, exact.toLowerCase()).url, value => {
        const payload = value as { data?: { attributes?: { ohlcv_list?: unknown } }; meta?: { base?: { address?: unknown }; quote?: { address?: unknown } } };
        if (![payload.meta?.base?.address, payload.meta?.quote?.address].some(address => typeof address === "string" && isAddress(address, { strict: false }) && address.toLowerCase() === exact.toLowerCase())) throw new PresentationProviderError("INVALID");
        const list = payload.data?.attributes?.ohlcv_list;
        if (!Array.isArray(list)) throw new PresentationProviderError("INVALID");
        const candles = parseExternalOhlcvList(list);
        if (list.length && !candles.length) throw new PresentationProviderError("INVALID");
        return candles;
      }, externalChartRefreshMs(range));
      if (hasCatastrophicOhlcvPriceMismatch(result.data, referencePrice)) throw new PresentationProviderError("INVALID");
      return { token: exact, pair: selected, range, candles: result.data, source: "GeckoTerminal" as const, coverage: result.data.length ? "AVAILABLE" as const : "NO_HISTORY" as const, updatedAt: result.observedAt, lastTradeAt: null, refreshMs: externalChartRefreshMs(range), stale: result.stale || Boolean(resolution?.stale) };
    };
    try { return await readPool(pool); } catch (error) {
      // Missing canonical pool permits one bounded discovery fallback. Outages
      // and invalid token binding do not fan out into alternate requests.
      if (!(error instanceof PresentationProviderError) || error.status !== 404 || !preferred) throw error;
      const discovered = await markets(exact);
      const alternative = discovered.data.find(market => market.pool !== pool);
      if (!discovered.data.length) return { token: exact, pair: "", range, candles: [], source: "GeckoTerminal", coverage: "NO_HISTORY", updatedAt: discovered.observedAt, lastTradeAt: null, refreshMs: externalChartRefreshMs(range), stale: discovered.stale };
      if (!alternative) throw error;
      return readPool(alternative.pool);
    }
  }
  return { markets, chart };
}
export const tokenChartReader = createTokenChartReader();
