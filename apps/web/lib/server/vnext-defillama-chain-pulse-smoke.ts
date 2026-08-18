import assert from "node:assert/strict";
import {
  DEFILLAMA_BASE_URL,
  DEFILLAMA_CHAIN_NAME,
  DEFILLAMA_CHAIN_PATH,
  DEFILLAMA_SOURCE
} from "./vnext-defillama";
import { readVNextDefiLlamaChainPulse } from "./vnext-defillama-chain-pulse";

function jsonResponse(payload: unknown, options?: { status?: number }) {
  return new Response(JSON.stringify(payload), {
    status: options?.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

async function expectAllDatasetsReady() {
  const result = await readVNextDefiLlamaChainPulse({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/chains") {
        return jsonResponse([
          { chain: DEFILLAMA_CHAIN_NAME, name: DEFILLAMA_CHAIN_NAME, tvl: 1000, chainId: 4663 }
        ]);
      }
      if (url.pathname === `/overview/dexs/${DEFILLAMA_CHAIN_PATH}`) {
        return jsonResponse({
          chain: DEFILLAMA_CHAIN_NAME,
          total24h: 1100,
          total7d: 7700,
          change_1d: 1,
          change_7d: 2
        });
      }
      if (url.pathname === `/overview/fees/${DEFILLAMA_CHAIN_PATH}`) {
        const dataType = url.searchParams.get("dataType");
        if (dataType === "dailyFees") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 100, total7d: 700 });
        }
        if (dataType === "dailyRevenue") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 80, total7d: 560 });
        }
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 20, total7d: 140 });
      }
      throw new Error(`unexpected request ${String(input)}`);
    }
  });

  assert.equal(result.status, "ready");
  assert.equal(result.chainId, 4663);
  assert.equal(result.chain, DEFILLAMA_CHAIN_NAME);
  assert.equal(result.source, DEFILLAMA_SOURCE);
  assert.equal(result.authoritative, false);
  assert.equal(result.tvlUsd, 1000);
  assert.equal(result.dexVolume24hUsd, 1100);
  assert.equal(result.fees24hUsd, 100);
  assert.equal(result.revenue24hUsd, 80);
  assert.equal(result.protocolRevenue24hUsd, 20);
  assert.equal(result.sources.tvl.status, "ready");
  assert.equal(result.sources.dex.status, "ready");
  assert.equal(result.sources.fees.status, "ready");
}

async function expectTvlUnavailablePartialWhenDexAndFeesReady() {
  const result = await readVNextDefiLlamaChainPulse({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/chains") {
        return jsonResponse([{ chain: "other", name: "other", tvl: 1000 }], { status: 200 });
      }
      if (url.pathname === `/overview/dexs/${DEFILLAMA_CHAIN_PATH}`) {
        return jsonResponse({
          chain: DEFILLAMA_CHAIN_NAME,
          total24h: 1100,
          total7d: 7700,
          change_1d: 1,
          change_7d: 2
        });
      }
      if (url.pathname === `/overview/fees/${DEFILLAMA_CHAIN_PATH}`) {
        const dataType = url.searchParams.get("dataType");
        if (dataType === "dailyFees") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 100, total7d: 700 });
        }
        if (dataType === "dailyRevenue") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 80, total7d: 560 });
        }
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 20, total7d: 140 });
      }
      throw new Error(`unexpected request ${String(input)}`);
    }
  });

  assert.equal(result.status, "partial");
  assert.equal(result.sources.tvl.status, "unavailable");
  assert.equal(result.sources.dex.status, "ready");
  assert.equal(result.sources.fees.status, "ready");
  assert.equal(result.tvlUsd, null);
  assert.equal(result.dexVolume24hUsd, 1100);
}

async function expectDexUnavailablePartialWhenTvlReady() {
  const result = await readVNextDefiLlamaChainPulse({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/chains") {
        return jsonResponse([{ chain: DEFILLAMA_CHAIN_NAME, name: DEFILLAMA_CHAIN_NAME, tvl: 1000, chainId: 4663 }]);
      }
      if (url.pathname === `/overview/dexs/${DEFILLAMA_CHAIN_PATH}`) {
        return jsonResponse({ chain: "other", total24h: 1100, total7d: 7700 }, { status: 200 });
      }
      if (url.pathname === `/overview/fees/${DEFILLAMA_CHAIN_PATH}`) {
        const dataType = url.searchParams.get("dataType");
        if (dataType === "dailyFees") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 100, total7d: 700 });
        }
        if (dataType === "dailyRevenue") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 80, total7d: 560 });
        }
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 20, total7d: 140 });
      }
      throw new Error(`unexpected request ${String(input)}`);
    }
  });

  assert.equal(result.status, "partial");
  assert.equal(result.sources.dex.status, "unavailable");
  assert.equal(result.sources.tvl.status, "ready");
  assert.equal(result.sources.fees.status, "ready");
  assert.equal(result.tvlUsd, 1000);
  assert.equal(result.dexVolume24hUsd, null);
}

async function expectFeesPartiallyReady() {
  const result = await readVNextDefiLlamaChainPulse({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/chains") {
        return jsonResponse([{ chain: DEFILLAMA_CHAIN_NAME, name: DEFILLAMA_CHAIN_NAME, tvl: 1000, chainId: 4663 }]);
      }
      if (url.pathname === `/overview/dexs/${DEFILLAMA_CHAIN_PATH}`) {
        return jsonResponse({
          chain: DEFILLAMA_CHAIN_NAME,
          total24h: 1100,
          total7d: 7700,
          change_1d: 1,
          change_7d: 2
        });
      }
      if (url.pathname === `/overview/fees/${DEFILLAMA_CHAIN_PATH}`) {
        const dataType = url.searchParams.get("dataType");
        if (dataType === "dailyFees") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 100, total7d: 700 });
        }
        if (dataType === "dailyRevenue") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME }, { status: 500 });
        }
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 20, total7d: 140 });
      }
      throw new Error(`unexpected request ${String(input)}`);
    }
  });

  assert.equal(result.sources.fees.status, "ready");
  assert.equal(result.sources.fees.components.dailyFees.status, "ready");
  assert.equal(result.sources.fees.components.dailyRevenue.status, "unavailable");
  assert.equal(result.sources.fees.components.dailyProtocolRevenue.status, "ready");
  assert.equal(result.fees24hUsd, 100);
  assert.equal(result.revenue24hUsd, null);
}

async function expectAllUnavailable() {
  const result = await readVNextDefiLlamaChainPulse({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/chains") {
        return jsonResponse({}, { status: 503 });
      }
      if (url.pathname === `/overview/dexs/${DEFILLAMA_CHAIN_PATH}`) {
        return jsonResponse({ chain: "other", total24h: 1100, total7d: 7700 }, { status: 200 });
      }
      if (url.pathname === `/overview/fees/${DEFILLAMA_CHAIN_PATH}`) {
        return jsonResponse({ chain: "other", total24h: 100, total7d: 700 });
      }
      throw new Error(`unexpected request ${String(input)}`);
    }
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.sources.tvl.status, "unavailable");
  assert.equal(result.sources.dex.status, "unavailable");
  assert.equal(result.sources.fees.status, "unavailable");
  assert.equal(result.tvlUsd, null);
  assert.equal(result.dexVolume24hUsd, null);
  assert.equal(result.fees24hUsd, null);
}

async function expectMissingValuesAreNull() {
  const result = await readVNextDefiLlamaChainPulse({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/chains") {
        return jsonResponse([{ chain: DEFILLAMA_CHAIN_NAME, name: DEFILLAMA_CHAIN_NAME, tvl: 1000, chainId: 4663 }]);
      }
      if (url.pathname === `/overview/dexs/${DEFILLAMA_CHAIN_PATH}`) {
        return jsonResponse({
          chain: DEFILLAMA_CHAIN_NAME,
          total24h: 1100,
          total7d: 7700
        });
      }
      if (url.pathname === `/overview/fees/${DEFILLAMA_CHAIN_PATH}`) {
        const dataType = url.searchParams.get("dataType");
        if (dataType === "dailyFees") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 100, total7d: "" });
        }
        if (dataType === "dailyRevenue") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: "", total7d: 560 });
        }
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: "", total7d: "" });
      }
      throw new Error(`unexpected request ${String(input)}`);
    }
  });

  assert.equal(result.dexChange1dPct, null);
  assert.equal(result.dexChange7dPct, null);
  assert.equal(result.fees7dUsd, null);
  assert.equal(result.revenue24hUsd, null);
  assert.equal(result.protocolRevenue24hUsd, null);
  assert.equal(result.protocolRevenue7dUsd, null);
}

async function expectNoAuthorityLeakingKeys() {
  const result = await readVNextDefiLlamaChainPulse({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/chains") {
        return jsonResponse([{ chain: DEFILLAMA_CHAIN_NAME, name: DEFILLAMA_CHAIN_NAME, tvl: 1000, chainId: 4663 }]);
      }
      if (url.pathname === `/overview/dexs/${DEFILLAMA_CHAIN_PATH}`) {
        return jsonResponse({
          chain: DEFILLAMA_CHAIN_NAME,
          total24h: 1100,
          total7d: 7700,
          change_1d: 1,
          change_7d: 2
        });
      }
      if (url.pathname === `/overview/fees/${DEFILLAMA_CHAIN_PATH}`) {
        const dataType = url.searchParams.get("dataType");
        if (dataType === "dailyFees") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 100, total7d: 700 });
        }
        if (dataType === "dailyRevenue") {
          return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 80, total7d: 560 });
        }
        return jsonResponse({ chain: DEFILLAMA_CHAIN_NAME, total24h: 20, total7d: 140 });
      }
      throw new Error(`unexpected request ${String(input)}`);
    }
  });

  const forbidden = ["execution", "route", "wallet", "wallets", "quote", "quotes", "provider", "tx", "transactions", "signer"];
  for (const field of forbidden) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, field), false);
  }
}

async function main() {
  await expectAllDatasetsReady();
  await expectTvlUnavailablePartialWhenDexAndFeesReady();
  await expectDexUnavailablePartialWhenTvlReady();
  await expectFeesPartiallyReady();
  await expectAllUnavailable();
  await expectMissingValuesAreNull();
  await expectNoAuthorityLeakingKeys();

  console.log("vnext-defillama-chain-pulse smoke passed");
}

void main();
