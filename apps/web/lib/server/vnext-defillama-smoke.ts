import assert from "node:assert/strict";
import {
  readVNextDefiLlamaChainTvl,
  readVNextDefiLlamaDexsOverview,
  readVNextDefiLlamaFeesOverview,
  DEFILLAMA_BASE_URL,
  DEFILLAMA_CHAIN_PATH,
  DEFILLAMA_SOURCE,
  DEFILLAMA_CHAIN_NAME
} from "./vnext-defillama";

type FetchStub = (input: string | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(payload: unknown, options?: { status?: number; statusText?: string }) {
  return new Response(JSON.stringify(payload), {
    status: options?.status ?? 200,
    statusText: options?.statusText,
    headers: { "content-type": "application/json" }
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

const pendingNever = new Promise<never>(() => {});

async function chainTvlSmoke(fetcher: FetchStub) {
  const url = `${DEFILLAMA_BASE_URL}/v2/chains`;
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async (input) => {
      const response = await fetcher(input);
      assert.equal(url, String(input), "chain tvl uses /v2/chains");
      return response;
    }
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, DEFILLAMA_SOURCE);
  assert.equal(result.metric, "chain_tvl");
  assert.equal(result.dataset, "v2-chains");
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
}

async function dexsOverviewSmoke(fetcher: FetchStub) {
  const url = `${DEFILLAMA_BASE_URL}/overview/dexs/${DEFILLAMA_CHAIN_PATH}`;
  const result = await readVNextDefiLlamaDexsOverview({
    fetch: async (input) => {
      const response = await fetcher(input);
      assert.equal(url, String(input), "dex overview uses /overview/dexs/Robinhood%20Chain");
      return response;
    }
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, DEFILLAMA_SOURCE);
  assert.equal(result.metric, "chain_dex_totals");
  assert.equal(result.dataset, "overview-dexs");
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
  assert.equal(typeof result.total24hUsd, "number");
}

async function feesOverviewSmoke(fetcher: FetchStub) {
  const url = `${DEFILLAMA_BASE_URL}/overview/fees/${DEFILLAMA_CHAIN_PATH}`;
  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      const response = await fetcher(input);
      assert.equal(url, String(input), "fees overview uses /overview/fees/Robinhood%20Chain");
      return response;
    }
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, DEFILLAMA_SOURCE);
  assert.equal(result.metric, "chain_fees_revenue");
  assert.equal(result.dataset, "overview-fees");
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
}

async function main() {
  await chainTvlSmoke(async () => jsonResponse([
    { chain: "Other", tvl: 100_000 },
    {
      chain: DEFILLAMA_CHAIN_NAME,
      tvl: 12_345_678,
      chainId: "766"
    }
  ]));

  await dexsOverviewSmoke(async () => jsonResponse({
    chain: DEFILLAMA_CHAIN_NAME,
    total24h: 1_000,
    total24hPrev: 900,
    total7d: 6_300,
    total7dPrev: 5_400,
    change_1d: 11.1,
    change_7d: 16.7
  }));

  await feesOverviewSmoke(async () => jsonResponse({
    chain: DEFILLAMA_CHAIN_NAME,
    total: 300,
    totalRevenue: 250,
    protocolRevenue: 30
  }));

  const malformedChain = await readVNextDefiLlamaChainTvl({
    fetch: async () => jsonResponse({ not: "a-array" })
  });
  await assertUnavailable(malformedChain, "malformed");

  const chainHttpFailure = await readVNextDefiLlamaChainTvl({
    fetch: async () => jsonResponse({ error: true }, { status: 500 })
  });
  await assertUnavailable(chainHttpFailure, "http_500");

  const dexsMalformed = await readVNextDefiLlamaDexsOverview({
    fetch: async () => jsonResponse({ chain: DEFILLAMA_CHAIN_NAME })
  });
  await assertUnavailable(dexsMalformed, "malformed");

  const feesMalformed = await readVNextDefiLlamaFeesOverview({
    fetch: async () => jsonResponse({ wrong: "shape" })
  });
  await assertUnavailable(feesMalformed, "malformed");

  const timeoutFailure = await readVNextDefiLlamaChainTvl({
    fetch: async () => pendingNever,
    timeoutMs: 1
  });
  await assertUnavailable(timeoutFailure, "timed out");

  const fetchFailure = await readVNextDefiLlamaDexsOverview({
    fetch: async () => {
      throw new Error("offline");
    }
  });
  await assertUnavailable(fetchFailure, "offline");

  console.log("vnext-defillama smoke passed");
}

void main();
