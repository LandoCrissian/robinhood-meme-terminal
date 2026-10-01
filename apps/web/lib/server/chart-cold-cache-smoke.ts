import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { createChartReadDiagnostic } from "./chart-read-diagnostic";
import { createGeckoPresentationReader } from "./gecko-presentation-reader";
import { createTokenChartReader } from "./token-chart-market";
import fixtures from "./chart-cold-cache-fixtures.json";

// The actual installed Next fetch wrapper, controlled incremental-cache/origin
// boundaries. No private Next API is imported by production code. Candle values
// are replayed public observations; only HTTP/cache clocks are controlled.
const require = createRequire(import.meta.url);
Object.assign(globalThis, { AsyncLocalStorage });
const { createPatchedFetcher } = require("next/dist/server/lib/patch-fetch");
type Mode = "ok" | "timeout" | "429" | "503" | "invalid" | "empty" | "old";
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function boundary(fixture = fixtures[2], age = 19 * 60_000) {
  let clock = Date.now(), mode: Mode = "ok", originCalls = 0, writes = 0;
  const entries = new Map<string, any>();
  const stores: any[] = [], calls: { url: string; uncached: boolean }[] = [];
  const storage = new AsyncLocalStorage<any>(), units = new AsyncLocalStorage<any>();
  const body = (url: string, empty = false) => url.includes("/ohlcv/")
    ? { data: { attributes: { ohlcv_list: empty ? [] : fixture.candles.map(c => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]) } }, meta: { base: { address: fixture.contract } } }
    // Controlled pool membership, no invented liquidity/price/activity metrics.
    : { data: [{ id: `robinhood_${fixture.pool}`, attributes: { address: fixture.pool }, relationships: { base_token: { data: { id: `robinhood_${fixture.contract}` } }, quote_token: { data: { id: `robinhood_0x1111111111111111111111111111111111111111` } } } }] };
  const cache = {
    generateCacheKey: async (url: string) => url,
    lock: async () => () => {},
    get: async (url: string) => {
      if (!entries.has(url)) entries.set(url, { isStale: age > 0, value: { kind: "FETCH", revalidate: 30, data: { headers: { "content-type": "application/json", date: new Date(clock - age).toUTCString() }, body: Buffer.from(JSON.stringify(body(url))).toString("base64"), status: 200, url } } });
      return entries.get(url);
    },
    set: async (url: string, value: any) => { writes++; entries.set(url, { isStale: false, value }); }
  };
  const origin = (async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input); originCalls++; calls.push({ url, uncached: options?.cache === "no-store" });
    // Background cache producer and explicit fresh consumer may overlap.
    // The timer remains the reader's original timer; no test-only retry clock.
    if (mode === "timeout") {
      if (!options?.signal) throw new DOMException("controlled background timeout", "TimeoutError");
      return new Promise<Response>((_, reject) => options.signal!.addEventListener("abort", () => reject(new DOMException("controlled timeout", "AbortError")), { once: true }));
    }
    await pause(20);
    if (mode === "429" || mode === "503") return Response.json({}, { status: Number(mode), headers: { "Retry-After": "1" } });
    if (mode === "invalid") return new Response("invalid-json", { headers: { date: new Date(clock).toUTCString() } });
    return Response.json(body(url, mode === "empty"), { headers: { date: new Date(clock - (mode === "old" ? 19 * 60_000 : 0)).toUTCString() } });
  }) as typeof fetch;
  const fetcher = createPatchedFetcher(origin, { workAsyncStorage: storage, workUnitAsyncStorage: units }) as typeof fetch;
  const provider = createGeckoPresentationReader(fetcher, () => clock);
  const reader = createTokenChartReader(provider, () => fixture.label === "STONKBROKER" ? fixture.pool : null);
  async function run<R>(callback: () => Promise<R>) {
    const store = { incrementalCache: cache, forceDynamic: true, isStaticGeneration: false, route: "/api/markets/ohlcv", page: "/api/markets/ohlcv/route" };
    stores.push(store);
    return storage.run(store, callback);
  }
  async function request(selected = reader) {
    const diagnostic = createChartReadDiagnostic(fixture.contract, "1H", null);
    return run(async () => {
      try { return { status: 200, payload: await selected.chart(fixture.contract, null, "1H", null, diagnostic), trace: diagnostic.summary(200) }; }
      catch (error) { return { status: 503, payload: null, trace: diagnostic.summary(503, error) }; }
    });
  }
  return {
    request, run, fetcher, provider, reader, calls,
    independent: () => createTokenChartReader(createGeckoPresentationReader(fetcher, () => clock), () => fixture.pool),
    setMode(value: Mode) { mode = value; },
    advance(ms: number) { clock += ms; },
    expire(ms = 19 * 60_000) { for (const entry of entries.values()) { entry.isStale = true; entry.value.data.headers.date = new Date(clock - ms).toUTCString(); } },
    async settle() { for (const store of stores) for (let i = 0; i < 3; i++) await Promise.allSettled(Object.values(store.pendingRevalidates ?? {})); },
    get originCalls() { return originCalls; }, get writes() { return writes; }
  };
}

export async function chartColdCacheSmoke() {
  const matrix = [];
  for (const fixture of fixtures) {
    const b = boundary(fixture);
    const first = await b.request();
    await b.settle();
    if (first.status !== 200) {
      const retry = await b.request();
      console.log(JSON.stringify({ baseFailure: fixture.label, first: first.trace, immediateRetry: retry.trace, originCalls: b.originCalls }));
    }
    assert.equal(first.status, 200, `${fixture.label}: expired platform HTTP-200 must obtain fresh evidence, not become 503/backoff`);
    assert.equal(first.payload?.coverage, "AVAILABLE"); assert.equal(first.payload?.stale, false);
    assert.deepEqual(first.payload?.candles, fixture.candles, "Revalidation never invents/rewrites candle values");
    const keys = fixture.label === "STONKBROKER" ? 1 : 2;
    assert.equal(b.originCalls, keys * 2, "At most one existing Next background producer plus one bounded fresh read per expired key");
    assert.equal(b.calls.filter(call => call.uncached).length, keys);
    const warm = await b.request(); assert.equal(warm.status, 200); assert.equal(b.originCalls, keys * 2);
    b.advance(31_000); b.expire();
    const stale = await b.request(); await b.settle();
    assert.equal(stale.status, 200); assert.equal(stale.payload?.stale, true);
    assert.equal(b.originCalls, keys * 2 + 1, "Valid retained evidence does not launch an extra uncached read");
    const recovered = await b.request(); await b.settle();
    assert.equal(recovered.status, 200); assert.equal(recovered.payload?.stale, false);
    assert.equal(b.originCalls, keys * 2 + 1, "Immediate recovery consumes the background-refreshed platform entry");
    assert.equal(recovered.trace.events.some(event => event.reason === "FAILURE_BACKOFF"), false);
    b.advance(16 * 60_000); b.expire();
    const expired = await b.request(); await b.settle();
    assert.equal(expired.status, 200); assert.equal(expired.payload?.stale, false);
    matrix.push({ token: fixture.contract, pool: fixture.pool, cold: first.status, warm: warm.status, stale: stale.payload?.stale, recovery: recovered.status, expiredRetained: expired.status, coldOriginCalls: keys * 2 });
  }
  const fresh = boundary(fixtures[2], 0);
  assert.equal((await fresh.request()).status, 200); assert.equal(fresh.originCalls, 0, "Fresh platform evidence consumed without origin calls");
  const cold = boundary();
  const concurrent = await Promise.all(Array.from({ length: 12 }, () => cold.request())); await cold.settle();
  assert.equal(concurrent.every(result => result.status === 200), true); assert.equal(cold.originCalls, 2, "12 same-process cold consumers coalesce to one bounded attempt");
  const expiredOnly = boundary(); expiredOnly.setMode("old");
  assert.equal((await expiredOnly.request()).status, 503); await expiredOnly.settle();
  expiredOnly.setMode("ok");
  const immediate = await expiredOnly.request(); await expiredOnly.settle();
  assert.equal(immediate.status, 200, "Expired evidence alone cannot create a 15s provider-failure backoff");
  assert.equal(immediate.trace.events.some(event => event.reason === "FAILURE_BACKOFF"), false);
  const noHistory = boundary(); noHistory.setMode("empty");
  assert.equal((await noHistory.request()).payload?.coverage, "NO_HISTORY"); await noHistory.settle();
  const originalError = console.error;
  // Next reports the controlled background timeout; it is not a live error.
  console.error = () => {};
  try {
    for (const mode of ["timeout", "429", "503", "invalid"] as const) {
      const b = boundary(); b.setMode(mode);
      const first = await b.request(); await b.settle();
      assert.equal(first.status, 503); assert.equal(b.originCalls, 2);
      const operation = mode === "timeout" ? "GECKO_TIMEOUT" : mode === "invalid" ? "GECKO_PARSE" : "GECKO_HTTP_STATUS";
      assert.ok(first.trace.events.some(event => event.operation === operation && event.outcome === "FAILED"), mode);
      b.setMode("ok");
      const retry = await b.request(); assert.equal(retry.status, 503); assert.equal(b.originCalls, 2, "Actual failure retains backoff/cooldown");
      b.advance(31_000); b.expire();
      await b.request(); await b.settle();
      // Invalid HTTP-200 bodies remain invalid until Next replaces that entry;
      // this cache-expiry repair does not disguise parse failures as success.
      b.advance(16_000);
      assert.equal((await b.request()).status, 200); await b.settle();
    }
  } finally { console.error = originalError; }
  // Exercise the actual public route with the same installed Next cache
  // boundary; this is not a replacement HTTP endpoint or provider-success mock.
  const handler = boundary(fixtures[0]), savedFetch = globalThis.fetch;
  globalThis.fetch = handler.fetcher;
  try {
    const { GET } = await import("../../app/api/markets/ohlcv/route");
    const request = () => GET(new Request(`https://rmt.invalid/api/markets/ohlcv?token=${fixtures[0].contract}&range=1H`));
    const response = await handler.run(request); await handler.settle();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).coverage, "AVAILABLE");
    assert.equal((await handler.run(request)).status, 200);
    assert.equal(handler.originCalls, 4, "Handler cold discovery/OHLCV each have one background + one bounded fresh read; retry is warm");
  } finally { globalThis.fetch = savedFetch; }

  // The second read must consume a remaining budget slot and the SAME deadline.
  const token = fixtures[2].contract, info = (index: number) => `https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/0x${index.toString(16).padStart(40, "0")}/info`;
  let starts = 0;
  const limited = createGeckoPresentationReader((async (_url, options) => {
    starts++;
    return Response.json({}, { headers: { date: new Date(Date.now() - (options?.cache === "no-store" ? 0 : 19 * 60_000)).toUTCString() } });
  }) as typeof fetch);
  for (let i = 0; i < 12; i++) await limited.read(info(i), value => value, 1000);
  await assert.rejects(limited.read(info(13), value => value, 1000));
  assert.equal(starts, 24, "Fresh bypasses do not escape the 24-start/minute budget");
  let deadlineCalls = 0;
  const deadlineStarted = performance.now();
  const deadline = createGeckoPresentationReader((async (_url, options) => {
    deadlineCalls++;
    if (deadlineCalls === 1) { await pause(3000); return Response.json({}, { headers: { date: new Date(Date.now() - 19 * 60_000).toUTCString() } }); }
    return new Promise<Response>((_, reject) => options!.signal!.addEventListener("abort", () => reject(new DOMException("controlled timeout", "AbortError")), { once: true }));
  }) as typeof fetch);
  await assert.rejects(deadline.read(`https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${token}/info`, value => value, 1000));
  const deadlineMs = performance.now() - deadlineStarted;
  assert.equal(deadlineCalls, 2); assert.ok(deadlineMs < 5000, "Fresh read must not reset the 3.5-second deadline");
  // Independent instances have independent budgets/single flights. This test
  // records that limitation rather than claiming cross-instance coalescing.
  const instances = boundary();
  await Promise.all([instances.request(instances.independent()), instances.request(instances.independent())]); await instances.settle();
  assert.equal(instances.originCalls, 4, "Two isolated cold instances can each perform background + bounded fresh reads");
  console.log(JSON.stringify({ scope: "CONTROLLED_INSTALLED_NEXT_CACHE_REAL_RMT_READERS_AND_HANDLER_REPLAYED_CANDLES_NO_NETWORK", nextVersion: require("next/package.json").version, matrix, concurrentConsumers: 12, concurrentOriginCalls: cold.originCalls, independentInstanceOriginCalls: instances.originCalls, sharedDeadlineMs: Math.round(deadlineMs), budgetStarts: starts }));
}
