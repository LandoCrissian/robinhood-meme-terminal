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
  expectedReason: string
) {
  assert.equal(result.status, "unavailable");
  const reason = result.reason;
  if (typeof reason !== "string") {
    throw new Error("expected unavailable reason");
  }
  assert.equal(reason.includes(expectedReason), true);
}

async function expectChainTvlUsesNameField() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async (input) => {
      assert.equal(String(input), `${DEFILLAMA_BASE_URL}/v2/chains`);
      return jsonResponse([
        { chain: "wrong", name: "Other", tvl: 111 },
        { chain: "rbc", name: DEFILLAMA_CHAIN_NAME, tvl: 1234, chainId: 4663 }
      ]);
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.source, DEFILLAMA_SOURCE);
  assert.equal(result.metric, "chain_tvl");
  assert.equal(result.dataset, "v2-chains");
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
  assert.equal(result.chainId, "4663");
}

async function expectChainIdNormalizationFromNumeric() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async (input) => {
      assert.equal(String(input), `${DEFILLAMA_BASE_URL}/v2/chains`);
      return jsonResponse([
        { chain: DEFILLAMA_CHAIN_NAME, name: DEFILLAMA_CHAIN_NAME, tvl: 5000, chainIdV2: 4663 }
      ]);
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.chainId, "4663");
}

async function expectChainIdNotFromCmcId() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async (input) => {
      assert.equal(String(input), `${DEFILLAMA_BASE_URL}/v2/chains`);
      return jsonResponse([
        {
          chain: DEFILLAMA_CHAIN_NAME,
          name: DEFILLAMA_CHAIN_NAME,
          tvl: 1200,
          cmcId: 4663
        }
      ]);
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.chainId, undefined);
}

async function expectWrongChainIdUnavailable() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async (input) => {
      assert.equal(String(input), `${DEFILLAMA_BASE_URL}/v2/chains`);
      return jsonResponse([
        {
          chain: DEFILLAMA_CHAIN_NAME,
          name: DEFILLAMA_CHAIN_NAME,
          tvl: 1200,
          chainId: 1
        }
      ]);
    }
  });
  await assertUnavailable(result, "wrong_chain_id");
}

async function expectDexOverviewReady() {
  const result = await readVNextDefiLlamaDexsOverview({
    fetch: async (input) => {
      assert.equal(String(input), `${DEFILLAMA_BASE_URL}/overview/dexs/${DEFILLAMA_CHAIN_PATH}`);
      return jsonResponse({
        chain: DEFILLAMA_CHAIN_NAME,
        total24h: "1000",
        total7d: 6000,
        change_1d: 11,
        change_7d: 22
      });
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

async function expectAllFeeComponentsReady() {
  const calledDataTypes = new Set<string>();

  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      const url = new URL(String(input));
      const dataType = url.searchParams.get("dataType");
      assert.ok(dataType);
      assert.equal(url.pathname, `/overview/fees/${DEFILLAMA_CHAIN_PATH}`);
      calledDataTypes.add(dataType);

      if (dataType === "dailyFees") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 1000, total7d: 7000 });
      }
      if (dataType === "dailyRevenue") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 800, total7d: 6400 });
      }
      if (dataType === "dailyProtocolRevenue") {
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
  assert.equal(result.components.dailyFees.status, "ready");
  assert.equal(result.components.dailyRevenue.status, "ready");
  assert.equal(result.components.dailyProtocolRevenue.status, "ready");

  const expected = ["dailyFees", "dailyRevenue", "dailyProtocolRevenue"];
  assert.deepEqual([...calledDataTypes].sort(), expected.sort());
}

async function expectOneFeeComponentHttpFailure() {
  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      const url = new URL(String(input));
      const dataType = url.searchParams.get("dataType");
      assert.ok(dataType);

      if (dataType === "dailyFees") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 1000, total7d: 7000 });
      }
      if (dataType === "dailyRevenue") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 800, total7d: 6400 }, { status: 503 });
      }
      return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 200, total7d: 1600 });
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.fees24hUsd, 1000);
  assert.equal(result.fees7dUsd, 7000);
  assert.equal(result.components.dailyFees.status, "ready");
  assert.equal(result.components.dailyRevenue.status, "unavailable");
  assert.equal(result.components.dailyRevenue.reason, "http_503");
  assert.equal(result.components.dailyProtocolRevenue.status, "ready");
}

async function expectOneMalformedFeeComponent() {
  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      const url = new URL(String(input));
      const dataType = url.searchParams.get("dataType");
      assert.ok(dataType);

      if (dataType === "dailyFees") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 1000, total7d: 7000 });
      }
      if (dataType === "dailyRevenue") {
        return nonJsonResponse("not-json");
      }
      return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 200, total7d: 1600 });
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.components.dailyRevenue.status, "unavailable");
  assert.equal(result.components.dailyRevenue.reason, "malformed_upstream");
  assert.equal(result.fees24hUsd, 1000);
  assert.equal(result.fees7dUsd, 7000);
  assert.equal(result.protocolRevenue24hUsd, 200);
}

async function expectAllFeeComponentsUnavailable() {
  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      const url = new URL(String(input));
      const dataType = url.searchParams.get("dataType");
      assert.ok(dataType);
      return jsonResponse({
        chain: DEFILLAMA_CHAIN_NAME,
        total24h: null,
        total7d: null
      });
    }
  });

  assert.equal(result.status, "unavailable");
  assert.equal((result as { reason: string }).reason, "all_components_unavailable");
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
  const typed = result as {
    components: {
      dailyFees: { status: "ready" | "unavailable"; reason?: string };
      dailyRevenue: { status: "ready" | "unavailable"; reason?: string };
      dailyProtocolRevenue: { status: "ready" | "unavailable"; reason?: string };
    };
  };
  assert.equal(typed.components.dailyFees.status, "unavailable");
  assert.equal(typed.components.dailyRevenue.status, "unavailable");
  assert.equal(typed.components.dailyProtocolRevenue.status, "unavailable");
}

async function expectMissingNumericValuesRemainUndefined() {
  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async (input) => {
      const url = new URL(String(input));
      const dataType = url.searchParams.get("dataType");
      if (dataType === "dailyFees") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: "1000", total7d: null });
      }
      if (dataType === "dailyRevenue") {
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: null, total7d: "6400" });
      }
      return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: "", total7d: "" });
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.fees24hUsd, 1000);
  assert.equal(result.fees7dUsd, undefined);
  assert.equal(result.revenue7dUsd, 6400);
  assert.equal(result.revenue24hUsd, undefined);
  assert.equal(result.protocolRevenue24hUsd, undefined);
  assert.equal(result.protocolRevenue7dUsd, undefined);
}

async function expectTimeoutReturnsUnavailable() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async () => new Promise(() => {}),
    timeoutMs: 1
  });
  await assertUnavailable(result, "timed out");
}

async function expectFetchRejectReturnsUnavailable() {
  const result = await readVNextDefiLlamaChainTvl({
    fetch: async () => {
      throw new Error("network_offline");
    }
  });
  await assertUnavailable(result, "network_offline");
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

async function expectWrongChainFeesUnavailable() {
  const result = await readVNextDefiLlamaFeesOverview({
    fetch: async () => jsonResponse({ chain: "other", total24h: 10, total7d: 10 })
  });
  await assertUnavailable(result, "missing_chain");
}

async function expectWrongChainDexUnavailable() {
  const result = await readVNextDefiLlamaDexsOverview({
    fetch: async () => jsonResponse({ chain: "other", total24h: 100, total7d: 700 })
  });
  await assertUnavailable(result, "wrong_chain");
}

async function main() {
  await expectChainTvlUsesNameField();
  await expectChainIdNormalizationFromNumeric();
  await expectChainIdNotFromCmcId();
  await expectWrongChainIdUnavailable();
  await expectDexOverviewReady();
  await expectWrongChainDexUnavailable();

  await expectAllFeeComponentsReady();
  await expectOneFeeComponentHttpFailure();
  await expectOneMalformedFeeComponent();
  await expectAllFeeComponentsUnavailable();
  await expectMissingNumericValuesRemainUndefined();

  await expectWrongChainFeesUnavailable();
  await expectMalformedJsonReturnsUnavailable();
  await expectMalformedShapeReturnsUnavailable();
  await expectNon200ReturnsUnavailable();
  await expectTimeoutReturnsUnavailable();
  await expectFetchRejectReturnsUnavailable();

  console.log("vnext-defillama smoke passed");
}

void main();
