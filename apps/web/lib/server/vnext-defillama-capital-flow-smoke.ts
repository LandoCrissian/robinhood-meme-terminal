import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readVNextDefiLlamaCapitalFlow } from "./vnext-defillama-capital-flow";

const chain = { name: "Robinhood Chain", totalCirculatingUSD: { peggedUSD: 1_000 } };
const chart = Array.from({ length: 8 }, (_, index) => ({
  date: String(1_000 + index * 86_400),
  totalCirculatingUSD: { peggedUSD: index === 0 ? 800 : 1_000 }
}));
const assets = { peggedAssets: [{
  symbol: "USDG",
  chainCirculating: { "Robinhood Chain": { current: { peggedUSD: 600 } } }
}] };

function fixtureFetch(overrides: { chains?: unknown; chart?: unknown; assets?: unknown } = {}) {
  return async (input: string | URL) => {
    const url = input.toString();
    if (url.endsWith("/stablecoinchains")) return Response.json(overrides.chains ?? [chain]);
    if (url.includes("/stablecoincharts/Robinhood")) return Response.json(overrides.chart ?? chart);
    return Response.json(overrides.assets ?? assets);
  };
}

async function main() {
  const ready = await readVNextDefiLlamaCapitalFlow({ fetch: fixtureFetch(), now: () => 0 });
  assert.equal(ready.status, "ready");
  assert.equal(ready.chainId, 4663);
  assert.equal(ready.chain, "Robinhood Chain");
  assert.equal(ready.authoritative, false);
  assert.equal(ready.stablecoinMarketCapUsd, 1_000);
  assert.equal(ready.stablecoinChange7dPct, 25);
  assert.equal(ready.usdgMarketCapUsd, 600);
  assert.equal(ready.usdgDominancePct, 60);

  const partial = await readVNextDefiLlamaCapitalFlow({ fetch: fixtureFetch({ chart: { malformed: true } }) });
  assert.equal(partial.status, "partial");
  assert.equal(partial.stablecoinMarketCapUsd, 1_000);
  assert.equal(partial.stablecoinChange7dPct, null);
  assert.equal(partial.usdgDominancePct, 60);

  const wrongChain = await readVNextDefiLlamaCapitalFlow({ fetch: fixtureFetch({ chains: [{ ...chain, name: "Base" }] }) });
  assert.equal(wrongChain.status, "unavailable");
  assert.equal(wrongChain.stablecoinMarketCapUsd, null);

  const source = readFileSync(new URL("../../app/vnext/vnext-capital-flow-card.tsx", import.meta.url), "utf8");
  assert.match(source, /Market context · DeFiLlama/);
  assert.match(source, /authoritative !== false/);
  assert.doesNotMatch(source, /Bullish|Bearish|Buy signal|Risk-on/);
  console.log("VNext DeFiLlama Capital Flow strict-chain, partial-data, and non-authority smoke passed.");
}

void main().catch((cause) => { console.error(cause); process.exitCode = 1; });
