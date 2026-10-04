import { getAddress, isAddress } from "viem";
import { externalChartRefreshMs, externalOhlcvRequestUrl, hasCatastrophicOhlcvPriceMismatch, isExternalPoolIdentity, normalizeExternalPoolIdentity, parseExternalOhlcvList, type ExternalChartRange, type ExternalOhlcvPayload } from "../external-ohlcv";
import { rmtCuratedMarketByToken } from "../vnext/curated-market-registry";
import { geckoPresentationReader, geckoTokenUrl, parseTokenPools, PresentationProviderError } from "./gecko-presentation-reader";
import { type ChartReadDiagnostic } from "./chart-read-diagnostic";

/** Presentation evidence only; no execution route imports this reader. */
export function createTokenChartReader(reader = geckoPresentationReader, canonical = (token: string) => rmtCuratedMarketByToken(token)?.market.poolKey ?? null) {
  const markets = (token: string, diagnostic?: ChartReadDiagnostic) => reader.read(geckoTokenUrl(token, "pools"), value => parseTokenPools(value, token), 5 * 60_000, undefined, diagnostic);
  async function selectedMarket(token: string, pool?: string) {
    if (!pool) {
      const result = await markets(token);
      return { ...result, data: result.data[0] ?? null };
    }
    if (!isExternalPoolIdentity(pool)) throw new PresentationProviderError("INVALID");
    const exactPool = normalizeExternalPoolIdentity(pool);
    // Cache the shared pool payload, not one caller's token-relative price.
    // Base and quote perspectives reuse the same bounded read/single flight,
    // then independently bind the observation to their exact token.
    const result = await reader.read(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${exactPool.toLowerCase()}`, value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new PresentationProviderError("INVALID");
      const payload = value as { data?: unknown };
      if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) throw new PresentationProviderError("INVALID");
      return payload;
    }, 60_000);
    const observation = parseTokenPools({ data: [result.data.data] }, token).find(m => m.pool.toLowerCase() === exactPool.toLowerCase());
    if (!observation) throw new PresentationProviderError("INVALID");
    return { ...result, data: observation };
  }
  async function chart(token: string, hint: string | null, range: ExternalChartRange, referencePrice: number | null, diagnostic?: ChartReadDiagnostic): Promise<ExternalOhlcvPayload> {
    const resolutionStarted = diagnostic?.now() ?? 0;
    const exact = getAddress(token);
    // The workspace already selects its current canonical RMT market before an
    // observed pool. A validated hint can be newer than the reviewed seed list.
    const preferred = hint ?? canonical(exact);
    let resolution;
    try { resolution = preferred ? null : await markets(exact, diagnostic); }
    catch (error) { diagnostic?.event("TOKEN_MARKET_RESOLUTION", resolutionStarted, "FAILED", { source: "GECKO_DISCOVERY" }); throw error; }
    const pool = preferred ?? resolution?.data[0]?.pool ?? null;
    diagnostic?.event("TOKEN_MARKET_RESOLUTION", resolutionStarted, "OK", { source: hint ? "HINT" : preferred ? "CANONICAL" : "GECKO_DISCOVERY", pool: pool ?? undefined });
    if (!pool) return { token: exact, pair: "", range, candles: [], source: "GeckoTerminal", coverage: "NO_HISTORY", updatedAt: resolution!.observedAt, lastTradeAt: null, refreshMs: externalChartRefreshMs(range), stale: resolution!.stale };
    const readPool = async (selected: string) => {
      diagnostic?.event("GECKO_POOL_READ", diagnostic.now(), "OK", { pool: selected });
      const result = await reader.read(externalOhlcvRequestUrl(selected.toLowerCase(), range, exact.toLowerCase()).url, value => {
        const payload = value as { data?: { attributes?: { ohlcv_list?: unknown } }; meta?: { base?: { address?: unknown }; quote?: { address?: unknown } } };
        if (![payload.meta?.base?.address, payload.meta?.quote?.address].some(address => typeof address === "string" && isAddress(address, { strict: false }) && address.toLowerCase() === exact.toLowerCase())) throw new PresentationProviderError("INVALID");
        const list = payload.data?.attributes?.ohlcv_list;
        if (!Array.isArray(list)) throw new PresentationProviderError("INVALID");
        const candles = parseExternalOhlcvList(list);
        if (list.length && !candles.length) throw new PresentationProviderError("INVALID");
        return candles;
      }, externalChartRefreshMs(range), undefined, diagnostic);
      const referenceStarted = diagnostic?.now() ?? 0;
      const mismatch = hasCatastrophicOhlcvPriceMismatch(result.data, referencePrice);
      diagnostic?.event("REFERENCE_PRICE", referenceStarted, mismatch ? "FAILED" : "OK", { reason: mismatch ? "REFERENCE_MISMATCH" : undefined });
      if (mismatch) throw new PresentationProviderError("INVALID");
      return { token: exact, pair: selected, range, candles: result.data, source: "GeckoTerminal" as const, coverage: result.data.length ? "AVAILABLE" as const : "NO_HISTORY" as const, updatedAt: result.observedAt, lastTradeAt: null, refreshMs: externalChartRefreshMs(range), stale: result.stale || Boolean(resolution?.stale) };
    };
    try { return await readPool(pool); } catch (error) {
      // Missing canonical pool permits one bounded discovery fallback. Outages
      // and invalid token binding do not fan out into alternate requests.
      if (!(error instanceof PresentationProviderError) || error.status !== 404 || !preferred) throw error;
      const discovered = await markets(exact, diagnostic);
      const alternative = discovered.data.find(market => market.pool !== pool);
      if (!discovered.data.length) return { token: exact, pair: "", range, candles: [], source: "GeckoTerminal", coverage: "NO_HISTORY", updatedAt: discovered.observedAt, lastTradeAt: null, refreshMs: externalChartRefreshMs(range), stale: discovered.stale };
      if (!alternative) throw error;
      return readPool(alternative.pool);
    }
  }
  return { markets, selectedMarket, chart };
}
export const tokenChartReader = createTokenChartReader();
