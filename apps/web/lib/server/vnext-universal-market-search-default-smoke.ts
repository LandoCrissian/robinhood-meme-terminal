import assert from "node:assert/strict";
import { encodeFunctionResult, erc20Abi, type Hex } from "viem";

async function main() {
  const originalFetch = globalThis.fetch;
  const savedRpc = process.env.RMT_MAINNET_RPC_URL;
  // Process-local fixture only. Never read credentials or reach a real network.
  process.env.RMT_MAINNET_RPC_URL = "https://bounded-search.invalid/rpc";
  const token = `0x${(145).toString(16).padStart(40, "0")}`;
  const missing = `0x${(146).toString(16).padStart(40, "0")}`;
  const curated = "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f";
  let rpcFailure = false;
  let providerFailure = false;
  let emptyCandidates = false;
  let providerRequests = 0;
  let metadataRequests = 0;
  const identity = (address: string) => address.toLowerCase() === curated
    ? { address: curated, name: "PEEP", symbol: "PEEP" }
    : { address: token, name: "Outside Loaded Token", symbol: "OUTSIDE" };
  type Rpc = { id: number; method: string; params?: Array<{ to?: string; data?: string } | string> };
  const rpcResult = (request: Rpc) => {
    if (rpcFailure) return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Fixture identity authority unavailable" } };
    if (request.method === "eth_getCode") return {
      jsonrpc: "2.0", id: request.id,
      result: String(request.params?.[0]).toLowerCase() === missing ? "0x" : "0x60006000"
    };
    if (request.method === "eth_call") {
      metadataRequests += 1;
      const call = request.params?.[0] as { to?: string; data?: string };
      const details = identity(call.to ?? "");
      const selector = call.data?.slice(0, 10);
      let result: Hex;
      if (selector === "0x06fdde03") result = encodeFunctionResult({ abi: erc20Abi, functionName: "name", result: details.name });
      else if (selector === "0x95d89b41") result = encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: details.symbol });
      else if (selector === "0x313ce567") result = encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: 18 });
      else if (selector === "0x18160ddd") result = encodeFunctionResult({ abi: erc20Abi, functionName: "totalSupply", result: 1_000_000n });
      else return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "No fixture canonical pool evidence" } };
      return { jsonrpc: "2.0", id: request.id, result };
    }
    return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Unexpected fixture RPC method" } };
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "bounded-search.invalid") {
      const payload: Rpc | Rpc[] = JSON.parse(String(init?.body));
      return Response.json(Array.isArray(payload) ? payload.map(rpcResult) : rpcResult(payload));
    }
    if (url.hostname === "api.dexscreener.com" && url.pathname === "/latest/dex/search") {
      providerRequests += 1;
      if (providerFailure) return new Response(null, { status: 503 });
      const candidate = identity(url.searchParams.get("q") === "PEEP" ? curated : token);
      return Response.json({ pairs: emptyCandidates ? [] : [{ chainId: "robinhood", baseToken: candidate,
        liquidity: { usd: 0 }, volume: { h24: 0 }, txns: { h24: { buys: 0, sells: 0 } } }] });
    }
    if (url.hostname === "robinhoodchain.blockscout.com" && url.pathname === "/api/v2/search") {
      providerRequests += 1;
      return Response.json({ items: [] });
    }
    // Optional inventory/project registries are unavailable in this fixture.
    return new Response(null, { status: 503 });
  };
  try {
    const { GET } = await import("../../app/api/vnext/market-search/route");
    const { parseVNextUniversalMarketSearchResult } = await import("../vnext/universal-market-search-contract");
    const query = async (text: string) => {
      const response = await GET(new Request(`https://rmt.invalid/api/vnext/market-search?q=${encodeURIComponent(text)}`));
      const parsed = parseVNextUniversalMarketSearchResult(await response.json());
      assert.ok(parsed, "Default route must return its public response contract");
      return { response, result: parsed };
    };
    for (const text of ["OUTSIDE", "Outside Loaded Token", "outside-loaded_token", token]) {
      const { response, result } = await query(text);
      assert.equal(response.status, 200, text);
      assert.equal(result.status, "found", text);
      assert.equal(result.results[0].address, token);
      assert.deepEqual(result.results[0].markets, [], "Discovery must not manufacture market or execution evidence");
    }
    assert.ok(providerRequests >= 6, "Default production path must call bounded universal providers");
    assert.equal((await query("PEEP")).result.status, "found", "Curated token remains searchable");
    assert.equal((await query(curated)).result.status, "found", "Curated exact token remains discoverable when market evidence is delayed");
    const beforeMissing = metadataRequests;
    assert.equal((await query(missing)).result.status, "not_found");
    assert.equal(metadataRequests, beforeMissing, "Positive no-code evidence avoids failing ERC20 reads");
    rpcFailure = true;
    const unavailable = await query(token);
    assert.equal(unavailable.response.status, 503);
    assert.equal(unavailable.result.status, "inventory_unavailable");
    assert.equal((await query("OUTSIDE")).result.status, "inventory_unavailable");
    rpcFailure = false;
    providerFailure = true;
    emptyCandidates = true;
    assert.equal((await query("ABSENT")).result.status, "candidate_discovery_unavailable");
    providerFailure = false;
    assert.equal((await query("ABSENT")).result.status, "not_found");
    assert.equal((await query("0xbroken")).result.status, "invalid_query");
    console.log("Default GET market-search: PASS (unloaded symbol/name/normalized/exact, outside 144, curated, risk-only, no execution implied, RPC unavailable, non-contract, partial provider failure).");
  } finally {
    globalThis.fetch = originalFetch;
    if (savedRpc === undefined) delete process.env.RMT_MAINNET_RPC_URL;
    else process.env.RMT_MAINNET_RPC_URL = savedRpc;
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
