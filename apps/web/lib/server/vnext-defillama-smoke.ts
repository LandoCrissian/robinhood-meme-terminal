import assert from "node:assert/strict";
import {
  DEFILLAMA_BASE_URL,
  DEFILLAMA_CHAIN_NAME,
  DEFILLAMA_CHAIN_PATH,
  DEFILLAMA_SOURCE,
  readVNextDefiLlamaChainTvl,
  readVNextDefiLlamaDexsOverview,
  readVNextDefiLlamaFeesOverview
} from "./vnext-defillama";

type FetchStub = (input: string | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(payload: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(payload), {
    status: options?.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

function nonJsonResponse(payload: string, options?: { status?: number }) {
  return new Response(payload, {
    status: options?.status ?? 200,
    headers: { "content-type": "text/plain" }
  });
}

async function assertUnavailable(
  result: { status: "ready" | "unavailable"; reason?: string },
  expected: string
) {
  assert.equal(result.status, "unavailable");
  const reason = result.reason;
  if (typeof reason !== "string") {
    throw new Error("expected unavailable reason");
  }
  assert.equal(reason.includes(expected), true);
}

async function expectReadyChainTvl(
  fetcher: FetchStub,
  expected: { url: string; tvlUsd: number; chainId?: string }
) {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async (input) => {
      const response = await fetcher(input);
      assert.equal(expected.url, String(input), "chain tvl uses /v2/chains");
      return response;
    }
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, DEFILLAMA_SOURCE);
  assert.equal(result.metric, "chain_tvl");
  assert.equal(result.dataset, "v2-chains");
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
  assert.equal(result.tvlUsd, expected.tvlUsd);
  if (expected.chainId !== undefined) {
    assert.equal(result.chainId, expected.chainId);
  }
}

async function expectReadyDexsOverview(fetcher: FetchStub) {
  const result = await readVNextDefiLlamaDexsOverview({
    fetch: async (input) => {
      const response = await fetcher(input);
      assert.equal(`${DEFILLAMA_BASE_URL}/overview/dexs/${DEFILLAMA_CHAIN_PATH}`, String(input));
      return response;
    }
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, DEFILLAMA_SOURCE);
  assert.equal(result.metric, "chain_dex_totals");
  assert.equal(result.dataset, "overview-dexs");
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
  assert.equal(result.total24hUsd, 1000);
  assert.equal(result.total7dUsd, 6000);
  assert.equal(result.change1dPct, 11);
  assert.equal(result.change7dPct, 22);
}

async function expectReadyFeesOverview(fetcher: FetchStub) {
  const expectedDataTypes = ["dailyFees", "dailyRevenue", "dailyProtocolRevenue"].sort();
  const observedDataTypes = new Set<string>();

  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      const url = new URL(String(input));
      const dataType = url.searchParams.get("dataType");
      assert.ok(dataType);
      observedDataTypes.add(dataType);

      if (dataType === "dailyFees") {
        assert.equal(url.pathname.endsWith(`/overview/fees/${DEFILLAMA_CHAIN_PATH}`), true);
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 1000, total7d: 7000 });
      }

      if (dataType === "dailyRevenue") {
        assert.equal(url.pathname.endsWith(`/overview/fees/${DEFILLAMA_CHAIN_PATH}`), true);
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 800, total7d: 6400 });
      }

      if (dataType === "dailyProtocolRevenue") {
        assert.equal(url.pathname.endsWith(`/overview/fees/${DEFILLAMA_CHAIN_PATH}`), true);
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 200, total7d: 1600 });
      }

      return jsonResponse({ wrong: "query" }, { status: 400 });
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.source, DEFILLAMA_SOURCE);
  assert.equal(result.metric, "chain_fees_revenue");
  assert.equal(result.dataset, "overview-fees");
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
  assert.equal(result.fees24hUsd, 1000);
  assert.equal(result.fees7dUsd, 7000);
  assert.equal(result.revenue24hUsd, 800);
  assert.equal(result.revenue7dUsd, 6400);
  assert.equal(result.protocolRevenue24hUsd, 200);
  assert.equal(result.protocolRevenue7dUsd, 1600);
  assert.deepEqual([...observedDataTypes].sort(), expectedDataTypes);
}

async function expectWrongChainFeesUnavailable(fetcher: FetchStub) {
  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      return fetcher(input);
    }
  });
  await assertUnavailable(result, "missing_chain");
}

async function expectMalformedJsonReturnsUnavailable() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async () => nonJsonResponse("not-json")
  });
  await assertUnavailable(result, "malformed_upstream");
}

async function expectMalformedShapeReturnsUnavailable() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async () => jsonResponse({ not: "a-array" })
  });
  await assertUnavailable(result, "malformed_upstream");
}

async function expectNon200ReturnsUnavailable() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async () => jsonResponse({}, { status: 500 })
  });
  await assertUnavailable(result, "http_500");
}

async function expectWrongChainDexReturnsUnavailable() {
  const result = await readVNextDefiLlamaDexsOverview({
    fetch: async () => jsonResponse({ chain: "Other", total24h: 100, total7d: 700 })
  });
  await assertUnavailable(result, "wrong_chain");
}

async function expectTimeoutReturnsUnavailable() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async () => new Promise(() => {}),
    timeoutMs: 1
  });
  await assertUnavailable(result, "timed out");
}

async function expectFetchRejectReturnsUnavailable() {
  const result = await readVNextDefiLlamaDexsOverview({
    fetch: async () => {
      throw new Error("offline");
    }
  });
  await assertUnavailable(result, "offline");
}

async function expectMissingFeeDataUnavailable() {
  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: null, total7d: null });
    }
  });
  await assertUnavailable(result, "missing_meaningful_fee_data");
}

async function main() {
  await expectReadyChainTvl(async () => jsonResponse([
    { chain: "Other", tvl: 111 },
    {
      chain: DEFILLAMA_CHAIN_NAME,
      tvl: 1000,
      chainId: "123"
    }
  ]), {
    url: `${DEFILLAMA_BASE_URL}/v2/chains`,
    tvlUsd: 1000,
    chainId: "123"
  });

  await expectReadyDexsOverview(async () => jsonResponse({
    chain: DEFILLAMA_CHAIN_NAME,
    total24h: 1000,
    total24hPrev: 900,
    total7d: 6000,
    total7dPrev: 5000,
    change_1d: "11",
    change_7d: "22"
  }));

  await expectReadyFeesOverview(async () => jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 1, total7d: 1 }));

  await expectMalformedJsonReturnsUnavailable();
  await expectMalformedShapeReturnsUnavailable();
  await expectNon200ReturnsUnavailable();
  await expectWrongChainDexReturnsUnavailable();

  await expectWrongChainFeesUnavailable(async () =>
    jsonResponse({ chain: "Other", total24h: 1, total7d: 1 })
  );

  await expectTimeoutReturnsUnavailable();
  await expectFetchRejectReturnsUnavailable();
  await expectMissingFeeDataUnavailable();

  console.log("vnext-defillama smoke passed");
}

void main();
