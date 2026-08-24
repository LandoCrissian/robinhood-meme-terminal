import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  respondWithVNextUniversalMarketSearch,
  type VNextUniversalMarketSearchResult
} from "./vnext-universal-market-search";

const queryAddress = "0xe934e36a439c94017b64a3fece66af12099abf50";

async function invoke(
  url: string,
  result?: VNextUniversalMarketSearchResult,
  error?: Error
) {
  let calls = 0;
  const response = await respondWithVNextUniversalMarketSearch(
    new Request(url),
    async () => {
      calls += 1;
      if (error) throw error;
      assert.ok(result);
      return result;
    }
  );
  return {
    calls,
    response,
    payload: await response.json() as Record<string, unknown>
  };
}

function assertSecurityHeaders(response: Response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
}

async function main() {
  const missing = await invoke("https://rmtlaunch.fun/api/vnext/market-search");
  assert.equal(missing.response.status, 400);
  assert.equal(missing.calls, 0);
  assertSecurityHeaders(missing.response);

  const foundResult: VNextUniversalMarketSearchResult = {
    query: queryAddress,
    queryKind: "token-or-pool-address",
    status: "found",
    results: [{
      address: queryAddress,
      name: "StonkBroker",
      symbol: "STONKBROKER",
      decimals: 18,
      matchedBy: "token",
      markets: []
    }]
  };
  const found = await invoke(
    `https://rmtlaunch.fun/api/vnext/market-search?q=${queryAddress}`,
    foundResult
  );
  assert.equal(found.response.status, 200);
  assert.equal(found.calls, 1);
  assert.equal(found.payload.status, "found");
  assertSecurityHeaders(found.response);

  const invalid = await invoke(
    "https://rmtlaunch.fun/api/vnext/market-search?q=0x1234",
    {
      query: "0x1234",
      queryKind: "text",
      status: "invalid_query",
      results: []
    }
  );
  assert.equal(invalid.response.status, 400);

  for (const status of [
    "inventory_unavailable",
    "candidate_discovery_unavailable"
  ] as const) {
    const unavailable = await invoke(
      "https://rmtlaunch.fun/api/vnext/market-search?q=search",
      { query: "search", queryKind: "text", status, results: [] }
    );
    assert.equal(unavailable.response.status, 503);
    assertSecurityHeaders(unavailable.response);
  }

  const sensitiveUpstream = [
    "provider-secret-fixture",
    "market-indexer-secret-fixture",
    "https://private-indexer.example"
  ].join("|");
  const failed = await invoke(
    "https://rmtlaunch.fun/api/vnext/market-search?q=search",
    undefined,
    new Error(sensitiveUpstream)
  );
  assert.equal(failed.response.status, 503);
  assert.equal(failed.payload.status, "inventory_unavailable");
  assert.equal(JSON.stringify(failed.payload).includes(sensitiveUpstream), false);
  assertSecurityHeaders(failed.response);

  const routeSource = readFileSync(
    new URL("../../app/api/vnext/market-search/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /runtime = "nodejs"/);
  assert.match(routeSource, /dynamic = "force-dynamic"/);
  assert.match(routeSource, /maxDuration = 10/);
  assert.equal(routeSource.includes("RMT_MARKET_INDEXER_READ_TOKEN"), false);
  assert.equal(routeSource.includes("api.dexscreener.com"), false);

  console.log("Universal market search route returns only bounded, no-store search results and sanitized failures.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
