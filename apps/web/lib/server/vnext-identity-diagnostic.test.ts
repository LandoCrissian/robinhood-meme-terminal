import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, getAddress } from "viem";
import { createVNextExecutionIdentityAuthority, vNextExecutionIdentityErrorResponse } from "./vnext-execution-identity-authority";
import { captureResponseDiagnostic } from "../vnext/quote-response-diagnostic";
import { classifyIdentityReadFailure } from "../vnext/identity-failure";
import { readRobinhoodTokenIdentityEvidence } from "./universal-market-resolver";
import { structureTradeFailure } from "../vnext/trade-failure";
import { TradeIdentityError, tradeIdentityErrorResponse } from "./rmt-trade-identity";
import { requireProjectIdentityExecutionAdmitted, projectIdentityAdmissionErrorResponse } from "./project-identity-admission";
import { requireVNextStockTokenExecutionEligible, stockTokenExecutionPolicyErrorResponse } from "./robinhood-stock-token-registry";

const usdg = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const cannacat = getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92");

test("exact CANNACAT RPC failure survives authority, API and copied diagnostic", async () => {
  const authority = createVNextExecutionIdentityAuthority({
    readInventory: async () => ({ status: "upstream_unavailable", reason: "http_failure" }),
    readLive: async () => ({ status: "identity_read_unavailable", failure: {
      code: "IDENTITY_RPC_UNAVAILABLE", operation: "eth_getCode"
    } })
  });
  let failure: unknown; await assert.rejects(authority.read(cannacat, { required: true }), (error: unknown) => { failure = error; return true; });
  {
    const response = vNextExecutionIdentityErrorResponse(failure);
    assert.ok(response);
    const body = await response.json();
    assert.equal(body.code, "IDENTITY_RPC_UNAVAILABLE");
    assert.equal(body.identityOperation, "eth_getCode");
    assert.equal(body.identityAsset, cannacat);
    assert.equal(body.retryable, true);
    const diagnostic = captureResponseDiagnostic(body, Date.now(), null, null);
    assert.equal(diagnostic.code, "IDENTITY_RPC_UNAVAILABLE");
  }
});

test("USDG -> exact CANNACAT identity works without inventory or enrichment", async () => {
  const authority = createVNextExecutionIdentityAuthority({
    readInventory: async () => ({ status: "upstream_unavailable", reason: "http_failure" }),
    readLive: async address => ({ status: "verified_token", token: {
      address, name: address === usdg ? "Global Dollar" : "CannaCat",
      symbol: address === usdg ? "USDG" : "CANNACAT", decimals: address === usdg ? 6 : 18,
      totalSupply: "1000000000000000000000000000"
    } })
  });
  const pair = await Promise.all([authority.read(usdg), authority.read(cannacat)]);
  assert.deepEqual(pair.map(x => x?.address), [usdg, cannacat]);
  assert.deepEqual(pair.map(x => x?.decimals), [6, 18]);
  assert.ok(pair.every(x => x?.chainId === 4663 && x.provenance === "verified-onchain-token-identity"));
  assert.equal(await authority.read(cannacat, { chainId: 1 }), null);
});

async function failedResponse(work: Promise<unknown>, stage: "quote" | "verification" | "authorization" = "quote") {
  let failure: unknown;
  await assert.rejects(work, (error: unknown) => { failure = error; return true; });
  const response = vNextExecutionIdentityErrorResponse(failure, stage);
  assert.ok(response);
  return response.json();
}

test("timeout, capacity, wrong chain, positive missing code and malformed metadata remain distinct", async () => {
  const stalled = createVNextExecutionIdentityAuthority({
    readInventory: async () => ({ status: "upstream_unavailable", reason: "http_failure" }),
    readLive: () => new Promise(() => {}), freshReadDeadlineMs: 5, maximumPending: 1
  });
  assert.equal((await failedResponse(stalled.read(cannacat, { required: true }))).code, "IDENTITY_TIMEOUT");
  assert.equal((await failedResponse(stalled.read(usdg, { required: true }))).code, "IDENTITY_CAPACITY_EXCEEDED");
  assert.equal((await failedResponse(stalled.read(cannacat, { required: true, chainId: 1 }))).code, "IDENTITY_CHAIN_MISMATCH");
  for (const reason of ["no_contract", "invalid_metadata"] as const) {
    const authority = createVNextExecutionIdentityAuthority({
      readInventory: async () => ({ status: "upstream_unavailable", reason: "http_failure" }),
      readLive: async () => ({ status: "not_erc20", reason })
    });
    for (const stage of ["quote", "verification", "authorization"] as const) {
      const body = await failedResponse(authority.read(cannacat, { required: true }), stage);
      assert.equal(body.code, reason === "no_contract" ? "TOKEN_NOT_FOUND" : "TOKEN_METADATA_INVALID");
      assert.equal(body.retryable, false);
      assert.equal(body.stage, stage);
    }
  }
});

test("transport cause classification and client diagnostic discard provider secrets", () => {
  const secret = "https://rpc.invalid/private-key?token=secret";
  for (const [cause, expected] of [
    [{ name: "HttpRequestError", status: 429, message: secret }, "IDENTITY_RATE_LIMITED"],
    [{ name: "HttpRequestError", cause: { name: "TimeoutError" }, message: secret }, "IDENTITY_TIMEOUT"],
    [{ name: "HttpRequestError", status: 503, message: secret }, "IDENTITY_RPC_UNAVAILABLE"],
    [{ name: "ContractFunctionRevertedError", message: secret }, "IDENTITY_CALL_FAILED"],
    [{ code: "ERR_INVALID_URL", message: secret }, "SERVER_CONFIGURATION_ERROR"],
    [{ name: "TypeError", message: secret }, "IDENTITY_READER_FAILED"]
  ] as const) {
    const failure = classifyIdentityReadFailure({ name: "ContractFunctionExecutionError", cause }, "decimals");
    assert.equal(failure.code, expected);
    assert.equal(JSON.stringify(failure).includes(secret), false);
    const diagnostic = captureResponseDiagnostic({ ...failure, stage: "quote", phase: "IDENTITY_UNAVAILABLE", retryable: true,
      identityOperation: "decimals", identityAsset: cannacat, error: secret, calldata: secret, cookie: secret }, 0, null, null);
    assert.equal(diagnostic.code, expected);
    assert.equal(diagnostic.identityOperation, "decimals");
    assert.equal(diagnostic.identityAsset, cannacat);
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  }
  const invalid = captureResponseDiagnostic({ identityAsset: secret, identityOperation: secret }, null, null, null);
  assert.equal(invalid.identityAsset, null);
  assert.equal(invalid.identityOperation, null);
});

test("actual onchain reader reports eth_getCode / decimals failures without exporting RPC payloads", async () => {
  const original = globalThis.fetch;
  let mode: "ok" | "no-code" | "decimals" | "rate-limit" | "rpc-error" = "ok";
  globalThis.fetch = (async (_input, init) => {
    if (mode === "rate-limit") return new Response("secret provider body", { status: 429 });
    const requests = JSON.parse(String(init?.body));
    const answer = (request: { id: number; method: string; params: Array<{ data?: string }> }) => {
      if (mode === "rpc-error" && request.method === "eth_call") return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "private provider error" } };
      const selector = request.params[0]?.data;
      const result = request.method === "eth_getCode" ? mode === "no-code" ? "0x" : "0x6000"
        : selector === "0x06fdde03" ? encodeAbiParameters([{ type: "string" }], ["CannaCat"])
        : selector === "0x95d89b41" ? encodeAbiParameters([{ type: "string" }], ["CANNACAT"])
        : selector === "0x313ce567" ? mode === "decimals" ? "0x" : encodeAbiParameters([{ type: "uint8" }], [18])
        : encodeAbiParameters([{ type: "uint256" }], [1000000000000000000000000000n]);
      return { jsonrpc: "2.0", id: request.id, result };
    };
    return Response.json(Array.isArray(requests) ? requests.map(answer) : answer(requests));
  }) as typeof fetch;
  try {
    const good = await readRobinhoodTokenIdentityEvidence(cannacat);
    assert.equal(good.status, "verified_token");
    if (good.status === "verified_token") assert.equal(good.token.address, cannacat);
    mode = "no-code";
    assert.deepEqual(await readRobinhoodTokenIdentityEvidence(cannacat), { status: "not_erc20", reason: "no_contract" });
    mode = "decimals";
    assert.deepEqual(await readRobinhoodTokenIdentityEvidence(cannacat), { status: "identity_read_unavailable", failure: { code: "IDENTITY_CALL_FAILED", operation: "decimals" } });
    mode = "rate-limit";
    assert.deepEqual(await readRobinhoodTokenIdentityEvidence(cannacat), { status: "identity_read_unavailable", failure: { code: "IDENTITY_RATE_LIMITED", operation: "eth_getCode" } });
    mode = "rpc-error";
    assert.deepEqual(await readRobinhoodTokenIdentityEvidence(cannacat), { status: "identity_read_unavailable", failure: { code: "IDENTITY_RPC_UNAVAILABLE", operation: "name" } });
  } finally { globalThis.fetch = original; }
});

test("authentication and positive project conflict remain blocking, with stable diagnostics", async () => {
  const auth = tradeIdentityErrorResponse(new TradeIdentityError("Sign in.", 401));
  assert.ok(auth);
  assert.equal((await (await structureTradeFailure(auth, "quote")).json()).code, "AUTH_FAILURE");
  let conflict: unknown;
  await assert.rejects(requireProjectIdentityExecutionAdmitted([{ address: cannacat, verifiedIdentity: { address: cannacat, name: "CannaCat", symbol: "CANNACAT" } }], () => {}, {
    snapshot: { status: "ready", entries: [{ projectId: "fixture", name: "CannaCat", symbol: "CANNACAT", contractAddress: usdg, authority: "coingecko-robinhood-contract-registry" }] },
    readKnownIdentity: async () => ({ address: usdg, name: "CannaCat", symbol: "CANNACAT" })
  }), (error: unknown) => { conflict = error; return true; });
  const response = projectIdentityAdmissionErrorResponse(conflict);
  assert.ok(response);
  assert.equal((await (await structureTradeFailure(response, "quote")).json()).code, "PROJECT_IDENTITY_CONFLICT");
});

test("Stock Token policy unavailable remains blocking and distinguishable from RPC identity failure", async () => {
  let failure: unknown;
  await assert.rejects(requireVNextStockTokenExecutionEligible({ inputAsset: usdg, outputAsset: cannacat }, async () => ({ coverage: "unavailable", assetsByAddress: new Map() })),
    (error: unknown) => { failure = error; return true; });
  const response = stockTokenExecutionPolicyErrorResponse(failure);
  assert.ok(response);
  assert.equal((await (await structureTradeFailure(response, "quote")).json()).code, "STOCK_TOKEN_POLICY_UNAVAILABLE");
});
