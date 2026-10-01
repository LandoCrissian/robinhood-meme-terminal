import assert from "node:assert/strict";
import { createChartReadDiagnostic } from "./chart-read-diagnostic";
import { createGeckoPresentationReader, geckoTokenUrl, PresentationProviderError } from "./gecko-presentation-reader";
import { createTokenChartReader } from "./token-chart-market";

export async function chartReadDiagnosticSmoke() {
  const assetAddress = "0x14c51bb55592372eac7141a1d0527d1dd7fbd42f";
  const pool = `0x${"ab".repeat(32)}`;
  const history = { data: { attributes: { ohlcv_list: [[100, 1, 2, 1, 2, 1], [200, 2, 3, 2, 3, 1]] } }, meta: { base: { address: assetAddress } } };
  let now = 1_800_000_000_000;
  const diagnostic = () => createChartReadDiagnostic(assetAddress, "1H", null);
  let calls = 0, mode = "ok";
  const fetcher = (async () => {
    calls++;
    if (mode === "timeout") throw new DOMException("secret-credential-url", "AbortError");
    if (mode === "broken") throw new TypeError("secret-credential-url", { cause: { code: "ECONNRESET", headers: { Authorization: "secret" } } });
    if (mode === "malformed") return new Response("secret-malformed-body", { headers: { Date: new Date(now).toUTCString() } });
    return Response.json(mode === "no-history" ? { ...history, data: { attributes: { ohlcv_list: [] } } } : history, { status: mode === "429" ? 429 : mode === "503" ? 503 : 200, headers: { Date: new Date(mode === "old" ? now - 19 * 60_000 : now).toUTCString(), "Retry-After": "60" } });
  }) as typeof fetch;
  const provider = createGeckoPresentationReader(fetcher, () => now);
  const chart = createTokenChartReader(provider, () => pool);
  const cold = diagnostic();
  const result = await chart.chart(assetAddress, null, "1H", null, cold);
  assert.equal(result.coverage, "AVAILABLE"); assert.equal(calls, 1);
  assert.equal(cold.summary(200).events.some(event => event.operation === "GECKO_OHLCV_FETCH" && event.httpStatus === 200), true);
  const warm = diagnostic(); await chart.chart(assetAddress, null, "1H", null, warm);
  assert.equal(calls, 1); assert.equal(warm.summary(200).events.some(event => event.reason === "CACHE_FRESH"), true);
  now += 31_000; mode = "503";
  const stale = diagnostic(); assert.equal((await chart.chart(assetAddress, null, "1H", null, stale)).stale, true);
  assert.equal(stale.summary(200).events.some(event => event.operation === "GECKO_HTTP_STATUS" && event.outcome === "FAILED" && event.httpStatus === 503), true);
  assert.equal(stale.summary(200).events.some(event => event.reason === "STALE_FALLBACK" && event.staleAvailable), true);
  now += 16_000; mode = "ok";
  assert.equal((await chart.chart(assetAddress, null, "1H", null, diagnostic())).stale, false);
  for (const state of ["old", "503", "429", "malformed", "timeout", "broken"]) {
    mode = state;
    const trace = diagnostic();
    const reader = createTokenChartReader(createGeckoPresentationReader(fetcher, () => now), () => pool);
    let error: unknown;
    try { await reader.chart(assetAddress, null, "1H", null, trace); } catch (caught) { error = caught; }
    assert.ok(error instanceof PresentationProviderError);
    const summary = trace.summary(503, error);
    const failure = summary.events.find(event => event.outcome === "FAILED");
    assert.ok(failure);
    if (state === "old") { assert.equal(failure.operation, "STALE_EVIDENCE_READ"); assert.equal(failure.reason, "HTTP_DATE_TOO_OLD"); assert.equal(failure.ageMs, 19 * 60_000); }
    if (state === "503" || state === "429") assert.equal(failure.httpStatus, Number(state));
    if (state === "malformed") { assert.equal(failure.operation, "GECKO_PARSE"); assert.equal(failure.errorClass, "SyntaxError"); }
    if (state === "timeout") assert.equal(failure.errorClass, "AbortError");
    if (state === "broken") { assert.equal(failure.errorClass, "TypeError"); assert.equal(failure.errorCode, "ECONNRESET"); }
    assert.equal(JSON.stringify(summary).includes("secret"), false);
  }
  mode = "no-history";
  assert.equal((await createTokenChartReader(createGeckoPresentationReader(fetcher, () => now), () => pool).chart(assetAddress, null, "1H", null, diagnostic())).coverage, "NO_HISTORY");
  mode = "429";
  const limited = createGeckoPresentationReader(fetcher, () => now);
  await assert.rejects(limited.read(geckoTokenUrl(assetAddress, "info"), value => value, 1000));
  const cooldown = diagnostic(); await assert.rejects(limited.read(geckoTokenUrl(assetAddress, "pools"), value => value, 1000, undefined, cooldown));
  assert.equal(cooldown.summary(503).events.some(event => event.operation === "GLOBAL_COOLDOWN" && event.outcome === "FAILED"), true);
  mode = "ok";
  const budget = createGeckoPresentationReader(fetcher, () => now);
  for (let index = 0; index < 24; index++) await budget.read(geckoTokenUrl(`0x${index.toString(16).padStart(40, "0")}`, "info"), value => value, 1000);
  const blocked = diagnostic(); await assert.rejects(budget.read(geckoTokenUrl(assetAddress, "pools"), value => value, 1000, undefined, blocked));
  assert.equal(blocked.summary(503).events.some(event => event.operation === "LOCAL_BUDGET" && event.reason === "START_BUDGET"), true);
  const ref = diagnostic(); await assert.rejects(createTokenChartReader(createGeckoPresentationReader(fetcher, () => now), () => pool).chart(assetAddress, null, "1H", 1e-9, ref));
  assert.equal(ref.summary(503).events.some(event => event.operation === "REFERENCE_PRICE" && event.outcome === "FAILED"), true);
  const bounded = diagnostic();
  for (let index = 0; index < 80; index++) bounded.event("OTHER", bounded.now(), "OK", { pool: "credential", reason: "credential", Authorization: "credential" } as never);
  assert.equal(bounded.summary(200).events.length, 48); assert.equal(bounded.summary(200).omitted, 32);
  assert.equal(JSON.stringify(bounded.summary(200)).includes("credential"), false);
  const deadline = diagnostic();
  const timeoutReader = createGeckoPresentationReader((async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("secret", "AbortError")), { once: true }))) as typeof fetch);
  await assert.rejects(timeoutReader.read(geckoTokenUrl(assetAddress, "pools"), value => value, 1000, undefined, deadline));
  assert.equal(deadline.summary(503).events.some(event => event.operation === "GECKO_TIMEOUT" && event.errorClass === "AbortError"), true);
  // Actual public handler, controlled fetch boundary. No endpoint replacement.
  const originalFetch = globalThis.fetch, originalInfo = console.info;
  const logs: ReturnType<typeof ChartReadDiagnosticSummary>[] = [];
  function ChartReadDiagnosticSummary() { return diagnostic().summary(200); }
  let handlerCalls = 0, old = false;
  globalThis.fetch = (async url => {
    handlerCalls++;
    const requested = String(url).match(/\/tokens\/(0x[a-f0-9]+)\/pools/)?.[1] ?? new URL(String(url)).searchParams.get("token")!;
    const payload = String(url).includes("/ohlcv/") ? { ...history, meta: { base: { address: requested } } } : { data: [{ id: `robinhood_${pool}`, attributes: { address: pool }, relationships: { base_token: { data: { id: `robinhood_${requested}` } }, quote_token: { data: { id: `robinhood_0x1111111111111111111111111111111111111111` } } } }] };
    return Response.json(payload, { headers: { Date: new Date(Date.now() - (old ? 19 * 60_000 : 0)).toUTCString() } });
  }) as typeof fetch;
  console.info = value => logs.push(JSON.parse(value));
  try {
    const { GET } = await import("../../app/api/markets/ohlcv/route");
    const success = await GET(new Request(`https://rmt.invalid/api/markets/ohlcv?token=0x3333333333333333333333333333333333333333&range=1H`));
    assert.equal(success.status, 200); assert.equal((await success.json()).coverage, "AVAILABLE");
    assert.equal(success.headers.get("cache-control"), "public, s-maxage=30, stale-while-revalidate=30");
    assert.equal(handlerCalls, 2); assert.equal(logs[0].events.at(-1)?.operation, "RESPONSE_SERIALIZATION");
    old = true;
    const failure = await GET(new Request(`https://rmt.invalid/api/markets/ohlcv?token=0x4444444444444444444444444444444444444444&range=1H`));
    assert.equal(failure.status, 503); assert.deepEqual(await failure.json(), { error: "Price history is temporarily unavailable." });
    assert.equal(failure.headers.get("cache-control"), "public, s-maxage=15, stale-while-revalidate=60");
    assert.equal(logs[1].events.some(event => event.reason === "HTTP_DATE_TOO_OLD" && event.outcome === "FAILED"), true);
    assert.equal(logs[1].errorClass, "PresentationProviderError");
    const callsBeforeInvalid = handlerCalls;
    assert.equal((await GET(new Request("https://rmt.invalid/api/markets/ohlcv?token=secret&range=1H"))).status, 400);
    assert.equal(handlerCalls, callsBeforeInvalid); assert.equal(logs.length, 2);
  } finally { globalThis.fetch = originalFetch; console.info = originalInfo; }
  console.log("Chart read diagnostics: cold/warm/stale/recovery, HTTP age, 429/503, parse/transport, local budget/cooldown/reference, bounds and redaction passed; NO production requests.");
}
