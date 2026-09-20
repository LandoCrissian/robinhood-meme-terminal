import assert from "node:assert/strict";
import { appendResponseDiagnostic, captureResponseDiagnostic, consumeResponseDiagnostic, serializeResponseDiagnostic } from "./quote-response-diagnostic";
import { clearTradeQuoteCache, requestTradeQuote, tradeQuoteFailureFromResponse } from "../trade-quote-client";

export async function runQuoteResponseDiagnosticSmoke() {
  const id = "00000000-0000-4000-8000-000000000123";
  const serverId = "sfo1::iad1::m9brk-1789344929793-d3832b920717";
  const secret = "PRIVATE_SESSION_DO_NOT_COPY";
  const payload = {
    code: "CONTRACT_VERSION_UNSUPPORTED", stage: "verification", phase: "FIRM_VERIFY_FAILED", retryable: false,
    error: secret, detail: secret, message: secret, calldata: secret, commitment: secret,
    cookies: secret, headers: { authorization: secret }, wallet: secret, token: secret,
  };
  const record = captureResponseDiagnostic(payload, 1_789_344_929_793, id, serverId, 17);
  const context = `private-wallet-and-session:${secret}`;
  const origin = consumeResponseDiagnostic(record, 17, false)!;
  const entries = appendResponseDiagnostic([], origin, context, context, 17);
  const serialized = serializeResponseDiagnostic(entries[0]);
  assert.equal(serialized.includes(secret), false);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
    "code", "stage", "phase", "retryable", "explanation", "receivedAt", "quoteRequestId", "serverRequestId",
    "originGenerationId", "consumerGenerationId", "evidence", "identityOperation", "identityAsset",
    "envelopeReason", "envelopeFunction", "actionIndex", "actionKind",
  ].sort());
  assert.equal(JSON.parse(serialized).quoteRequestId, id);
  assert.equal(JSON.parse(serialized).serverRequestId, serverId);
  assert.equal(JSON.parse(serialized).originGenerationId, 17);
  assert.equal(JSON.parse(serialized).consumerGenerationId, 17);
  payload.code = secret;
  payload.phase = secret;
  assert.equal(serializeResponseDiagnostic(entries[0]), serialized, "Payload mutation cannot alter evidence");
  const injected = { ...entries[0], record: { ...record, error: secret, explanation: secret }, extra: secret };
  assert.equal(serializeResponseDiagnostic(injected).includes(secret), false);
  const unknown = captureResponseDiagnostic({ code: secret, stage: secret, phase: secret, retryable: secret }, null, secret, secret, secret);
  for (const key of ["code", "stage", "phase", "retryable", "quoteRequestId", "serverRequestId", "originGenerationId", "receivedAt"] as const) assert.equal(unknown[key], null);
  const unknownEntry = appendResponseDiagnostic([], consumeResponseDiagnostic(unknown, 20, true), context, context, 20)[0];
  const unknownCopy = JSON.parse(serializeResponseDiagnostic(unknownEntry));
  assert.equal(unknownCopy.originGenerationId, null, "Consumer generation never fills missing origin");
  assert.equal(unknownCopy.receivedAt, null, "Missing receipt time is not replaced with now");
  assert.equal(unknownCopy.quoteRequestId, null);
  assert.equal(unknownCopy.consumerGenerationId, 20);
  assert.equal(captureResponseDiagnostic({}, 0, null, null).code, null, "Absent code is not inferred from status");
  assert.equal(appendResponseDiagnostic(entries, origin, context, "new-input-context", 17), entries);
  assert.equal(appendResponseDiagnostic(entries, undefined, context, context, 17), entries);
  const current = appendResponseDiagnostic(entries, consumeResponseDiagnostic(record, 19, true), context, context, 19);
  assert.equal(appendResponseDiagnostic(current, origin, context, context, 19), current, "Late obsolete response cannot replace current diagnostics");
  assert.equal(appendResponseDiagnostic(current, consumeResponseDiagnostic(record, 19, true), "old-asset-context", context, 19), current);
  assert.equal(serializeResponseDiagnostic(current[1]).includes("CACHED_OR_IN_FLIGHT_REUSE"), true);
  assert.equal(JSON.parse(serializeResponseDiagnostic(current[1])).originGenerationId, 17);
  assert.equal(serializeResponseDiagnostic(entries[0]), serialized, "New consumers cannot rewrite previous records");
  assert.equal(Reflect.set(record, "originGenerationId", 99), false);
  assert.equal(Reflect.set(origin, "consumerGenerationId", 99), false);
  let bounded = entries;
  for (let generation = 20; generation < 40; generation++) bounded = appendResponseDiagnostic(bounded, consumeResponseDiagnostic(record, generation, true), context, context, generation);
  assert.equal(bounded.length, 8);

  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    let status = 422;
    const reply = () => new Response(JSON.stringify({ ...payload, code: "CONTRACT_VERSION_UNSUPPORTED", phase: "FIRM_VERIFY_FAILED", requestId: id }), {
      status, headers: { "x-vercel-id": serverId, "set-cookie": secret, "authorization": secret },
    });
    globalThis.fetch = (async () => { calls++; return reply(); }) as typeof fetch;
    clearTradeQuoteCache();
    const response = await requestTradeQuote("/api/vnext/verify", { quoteRequestId: id }, { diagnosticGeneration: 17, maxAttempts: 3, retryDelayMs: 0 });
    assert.equal(calls, 1, "Diagnostics do not retry a permanent rejection");
    assert.equal(tradeQuoteFailureFromResponse(response)?.failure?.code, "CONTRACT_VERSION_UNSUPPORTED");
    assert.equal(response.diagnostic?.quoteRequestId, id);
    assert.equal(response.diagnostic?.originGenerationId, 17);
    assert.equal(JSON.stringify(response.diagnostic).includes(secret), false);

    status = 200;
    clearTradeQuoteCache();
    const observations: NonNullable<ReturnType<typeof consumeResponseDiagnostic>>[] = [];
    let resolveFetch!: (response: Response) => void;
    globalThis.fetch = (() => { calls++; return new Promise<Response>((resolve) => { resolveFetch = resolve; }); }) as typeof fetch;
    const first = requestTradeQuote("/api/vnext/quotes", {}, { now: 1000, diagnosticGeneration: 21, onDiagnostic: (value) => observations.push(value) });
    const second = requestTradeQuote("/api/vnext/quotes", {}, { now: 1001, diagnosticGeneration: 22, onDiagnostic: (value) => observations.push(value) });
    assert.equal(first, second, "Request coalescing and shared promise identity stay unchanged");
    resolveFetch(reply());
    const firstResponse = await first;
    await second;
    const third = requestTradeQuote("/api/vnext/quotes", {}, { now: 1002, diagnosticGeneration: 23, onDiagnostic: (value) => observations.push(value) });
    assert.equal(third, first, "Cache hit keeps the original shared promise");
    await third;
    assert.equal(calls, 2, "Two in-flight consumers plus cache hit cause only one new fetch");
    assert.deepEqual(observations.map((value) => value.consumerGenerationId), [21, 22, 23]);
    assert.deepEqual(observations.map((value) => value.record.originGenerationId), [21, 21, 21]);
    assert.deepEqual(observations.map((value) => value.evidence), ["NETWORK_RESPONSE", "CACHED_OR_IN_FLIGHT_REUSE", "CACHED_OR_IN_FLIGHT_REUSE"]);
    assert.equal(new Set(observations.map((value) => value.record.receivedAt)).size, 1);
    assert.equal(new Set(observations.map((value) => value.record.quoteRequestId)).size, 1);
    assert.equal(observations[0].record, firstResponse.diagnostic);
    assert.notEqual(observations[0], observations[1]);
    assert.equal(Reflect.set(observations[1].record, "originGenerationId", 22), false);
    assert.equal(observations[0].consumerGenerationId, 21);
    assert.equal(tradeQuoteFailureFromResponse(firstResponse), null);
    await requestTradeQuote("/api/vnext/quotes", {}, { now: 1003, onDiagnostic: () => { throw new Error("diagnostic renderer failed"); } });
    assert.equal(calls, 2, "Observer failure cannot change request behavior");

    clearTradeQuoteCache();
    globalThis.fetch = (async () => reply()) as typeof fetch;
    await requestTradeQuote("/api/vnext/quotes", {}, { now: 2000 });
    await requestTradeQuote("/api/vnext/quotes", {}, { now: 2001, diagnosticGeneration: 24, onDiagnostic: (value) => observations.push(value) });
    assert.equal(observations.at(-1)?.record.originGenerationId, null);
    assert.equal(observations.at(-1)?.consumerGenerationId, 24);
    assert.equal(observations.at(-1)?.evidence, "CACHED_OR_IN_FLIGHT_REUSE");
    clearTradeQuoteCache();
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    const count = observations.length;
    await assert.rejects(requestTradeQuote("/api/vnext/verify", { quoteRequestId: id }, { maxAttempts: 1, onDiagnostic: (value) => observations.push(value) }));
    assert.equal(observations.length, count, "Transport failure never fabricates a response diagnostic");
  } finally {
    globalThis.fetch = originalFetch;
    clearTradeQuoteCache();
  }
  console.log("quote response diagnostic smoke PASS: immutable origin, separate consumers, cache/in-flight reuse, stale guards, secret exclusion, unchanged requests");
}
