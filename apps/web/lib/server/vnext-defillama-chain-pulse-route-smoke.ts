import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFILLAMA_CHAIN_NAME, DEFILLAMA_CHAIN_PATH, DEFILLAMA_SOURCE } from "./vnext-defillama";
import { GET } from "../../app/api/vnext/chain-pulse/route";
import { respondWithVNextChainPulse } from "./vnext-defillama-chain-pulse-response";

function jsonResponse(payload: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(payload), {
    status: options?.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

function createDefiLlamaMock(scenario: "ready" | "partial" | "unavailable") {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString());
    if (url.pathname === "/v2/chains") {
      if (scenario === "unavailable") {
        return jsonResponse({ status: "broken" }, { status: 500 });
      }
      if (scenario === "partial") {
        return jsonResponse([
          { chain: "other", name: "Other", tvl: 111, chainId: 111 }
        ]);
      }
      return jsonResponse([
        { chain: DEFILLAMA_CHAIN_NAME, name: DEFILLAMA_CHAIN_NAME, tvl: 1234, chainId: 4663 }
      ]);
    }

    if (url.pathname === `/overview/dexs/${DEFILLAMA_CHAIN_PATH}`) {
      if (scenario === "unavailable") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME }, { status: 500 });
      }
      return jsonResponse({
        chain: DEFILLAMA_CHAIN_NAME,
        total24h: 1000,
        total7d: 7000,
        change_1d: 5,
        change_7d: 6
      });
    }

    if (url.pathname === `/overview/fees/${DEFILLAMA_CHAIN_PATH}`) {
      const dataType = url.searchParams.get("dataType");
      if (scenario === "unavailable") {
        return jsonResponse({ chain: "other", total24h: 0, total7d: 0 }, { status: 503 });
      }
      if (dataType === "dailyFees") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 300, total7d: 2100 });
      }
      if (dataType === "dailyRevenue") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 200, total7d: 1400 });
      }
      if (dataType === "dailyProtocolRevenue") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 40, total7d: 280 });
      }
      return jsonResponse({}, { status: 400 });
    }

    throw new Error(`unexpected endpoint: ${url.pathname}`);
  };
}

function withMockFetch<T>(mockFetch: typeof fetch, callback: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch;
  return callback().finally(() => {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });
}

async function invokeRoute(): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const response = await GET();
  const payload = await response.json() as Record<string, unknown>;
  return { response, payload };
}

async function assertReady() {
  await withMockFetch(createDefiLlamaMock("ready"), async () => {
    const { response, payload } = await invokeRoute();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "public, s-maxage=60, stale-while-revalidate=300");
    assert.equal(payload.status, "ready");
    assert.equal(payload.source, DEFILLAMA_SOURCE);
    assert.equal(payload.authoritative, false);
  });
}

async function assertPartial() {
  await withMockFetch(createDefiLlamaMock("partial"), async () => {
    const { response, payload } = await invokeRoute();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "public, s-maxage=60, stale-while-revalidate=300");
    assert.equal(payload.status, "partial");
  });
}

async function assertUnavailable() {
  await withMockFetch(createDefiLlamaMock("unavailable"), async () => {
    const { response, payload } = await invokeRoute();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(payload.status, "unavailable");
    const requiredNullFields = [
      "tvlUsd",
      "dexVolume24hUsd",
      "dexVolume7dUsd",
      "dexChange1dPct",
      "dexChange7dPct",
      "fees24hUsd",
      "fees7dUsd",
      "revenue24hUsd",
      "revenue7dUsd",
      "protocolRevenue24hUsd",
      "protocolRevenue7dUsd"
    ] as const;
    for (const field of requiredNullFields) {
      assert.equal(payload[field], null);
    }
  });
}

async function assertNoAuthorityFields() {
  await withMockFetch(createDefiLlamaMock("ready"), async () => {
    const { payload } = await invokeRoute();
    const forbidden = ["execution", "quote", "route", "wallet", "provider", "transaction", "transactions", "signer"];
    for (const field of forbidden) {
      assert.equal(Object.prototype.hasOwnProperty.call(payload, field), false);
    }
  });
}

async function assertUnexpectedFailureIsSanitized() {
  const response = await respondWithVNextChainPulse(async () => {
    throw new Error("upstream detail must not escape");
  });
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(payload.error, "Chain intelligence is temporarily unavailable.");
  assert.equal(JSON.stringify(payload).includes("upstream detail"), false);
}

function assertPresentationContract() {
  const source = readFileSync(new URL("../../app/vnext/vnext-chain-pulse-card.tsx", import.meta.url), "utf8");
  assert.match(source, /ROBINHOOD CHAIN PULSE/);
  assert.match(source, /Market intelligence · DefiLlama/);
  assert.match(source, /Third-party market context · Non-authoritative/);
  assert.match(source, /fetch\("\/api\/vnext\/chain-pulse"/);
  assert.equal(source.includes("api.llama.fi"), false);
  assert.equal(source.includes("setInterval"), false);
}

async function main() {
  await assertReady();
  await assertPartial();
  await assertUnavailable();
  await assertNoAuthorityFields();
  await assertUnexpectedFailureIsSanitized();
  assertPresentationContract();

  console.log("vnext-defillama-chain-pulse route smoke passed");
}

void main();
