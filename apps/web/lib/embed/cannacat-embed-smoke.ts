import assert from "node:assert/strict";
import { zeroAddress } from "viem";
import { allowedCannaCatOrigin, CANNACAT_ADDRESS, CANNACAT_EMBED_VERSION, handleCannaCatEmbedRequest, validateCannaCatEmbedBody } from "../server/cannacat-embed-boundary";
import { TradeIdentityError } from "../server/rmt-trade-identity";
import { CANNACAT_EMBED, createCannaCatClient, nextCannaCatBuyInput, parseCannaCatAmount } from "./cannacat-client";

const env = { RMT_CANNACAT_EMBED_ENABLED: "true", RMT_CANNACAT_EMBED_ORIGINS: "https://lammb.fun,https://preview.lammb.fun", RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "zero-x-swap" };
const wallet = "0x0000000000000000000000000000000000000123";
const body = { chainId: 4663, inputAsset: zeroAddress, outputAsset: CANNACAT_ADDRESS, inputAmountAtomic: "100000000000000", recipient: wallet };
let calls = 0;
const handler = async (request: Request) => {
  calls += 1;
  assert.equal(request.headers.get("privy-id-token"), "fixture-identity");
  assert.equal(request.headers.get("cookie"), null);
  assert.deepEqual(await request.json(), body);
  return Response.json({ status: "fixture-only" }, { headers: { "set-cookie": "not-forwarded=yes" } });
};
const dependencies = {
  env, handlers: { quotes: handler, verify: handler, authorize: handler, "native-settlement-trace": handler },
  authenticate: async (_request: Request, recipient: `0x${string}`) => ({ status: "identity-wallet-bound" as const, wallet: recipient, identityId: "fixture-user" })
};
const request = (value: unknown = body, origin = "https://lammb.fun", method = "POST", extra: Record<string, string> = {}) => new Request("https://rmt.example/api/embed/cannacat/quotes", {
  method, headers: { origin, "content-type": "application/json", "privy-id-token": "fixture-identity", "x-rmt-client": CANNACAT_EMBED_VERSION, ...extra },
  ...(method === "POST" ? { body: JSON.stringify(value) } : {})
});

let checks = 0;
function check(run: () => void) { run(); checks += 1; }
check(() => assert.equal(allowedCannaCatOrigin("https://lammb.fun", env), true));
check(() => assert.equal(allowedCannaCatOrigin("https://lammb.fun.evil.example", env), false));
check(() => assert.equal(allowedCannaCatOrigin(null, env), false));
check(() => assert.equal(allowedCannaCatOrigin("null", env), false));
check(() => assert.equal(allowedCannaCatOrigin("https://lammb.fun", {}), false));
check(() => assert.equal(allowedCannaCatOrigin("https://lammb.fun", { ...env, RMT_CANNACAT_EMBED_ORIGINS: "*" }), false));
check(() => assert.equal(allowedCannaCatOrigin("https://lammb.fun", { ...env, RMT_CANNACAT_EMBED_ORIGINS: "https://lammb.fun/" }), false));
check(() => assert.equal(validateCannaCatEmbedBody("quotes", body), true));
for (const change of [{ chainId: 1 }, { inputAmountAtomic: "0" }, { inputAmountAtomic: (2n ** 256n).toString() }, { recipient: "invalid" }, { outputAsset: wallet }, { feeBps: 0 }, { data: "0x1234" }, { target: wallet }]) {
  check(() => assert.equal(validateCannaCatEmbedBody("quotes", { ...body, ...change }), false));
}
check(() => assert.equal(validateCannaCatEmbedBody("quotes", { ...body, inputAsset: CANNACAT_ADDRESS, outputAsset: zeroAddress }), true));
check(() => assert.equal(validateCannaCatEmbedBody("verify", { ...body, provider: "uniswap-v3" }), false));
check(() => assert.equal(validateCannaCatEmbedBody("authorize", { ...body, provider: "zero-x-swap", settlementMode: "DIRECT_NO_RMT_FEE" }), false));
check(() => assert.equal(validateCannaCatEmbedBody("native-settlement-trace", { wallet, txHash: `0x${"a".repeat(64)}` }), true));
check(() => assert.equal(validateCannaCatEmbedBody("native-settlement-trace", { wallet, txHash: `0x${"a".repeat(64)}`, rpc: "https://evil.example" }), false));
check(() => assert.equal(parseCannaCatAmount("10000"), "10000000000000000000000"));
for (const amount of ["0", "-1", "1e4", "NaN", "01", "1.0000000000000000001", ""]) check(() => assert.throws(() => parseCannaCatAmount(amount)));
check(() => assert.equal(nextCannaCatBuyInput(100n, 1000n, 10000n, 2000n), 1002n));
check(() => assert.throws(() => nextCannaCatBuyInput(100n, 1000n, 10000n, 500n)));
check(() => assert.throws(() => nextCannaCatBuyInput(100n, 0n, 10000n, 2000n)));
check(() => assert.equal(CANNACAT_EMBED.feeBps, 25));
check(() => assert.equal(CANNACAT_EMBED.chainId, 4663));
check(() => assert.throws(() => createCannaCatClient({ baseUrl: "http://rmt.example/api/embed/cannacat", identityToken: "fixture" })));
check(() => assert.throws(() => createCannaCatClient({ baseUrl: "https://rmt.example/api/embed/cannacat?token=bad", identityToken: "fixture" })));

async function main() {
  const response = await handleCannaCatEmbedRequest(request(), "quotes", dependencies);
  check(() => assert.equal(response.status, 200));
  check(() => assert.equal(response.headers.get("access-control-allow-origin"), "https://lammb.fun"));
  check(() => assert.equal(response.headers.get("access-control-allow-credentials"), null));
  check(() => assert.equal(response.headers.get("set-cookie"), null));
  check(() => assert.match(response.headers.get("cache-control")!, /no-store/));
  const before = calls;
  for (const [req, op, status, deps] of [
    [request(body, "https://evil.example"), "quotes", 403, dependencies],
    [request(), "__proto__", 404, dependencies],
    [request({}, "https://lammb.fun", "GET"), "quotes", 405, dependencies],
    [request({ ...body, feeBps: 0 }), "quotes", 400, dependencies],
    [request(body, "https://lammb.fun", "POST", { "x-rmt-client": "bad" }), "quotes", 400, dependencies],
    [request(), "quotes", 503, { ...dependencies, env: { ...env, RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "zero-x-swap,uniswap-v3" } }],
    [request(), "quotes", 401, { ...dependencies, authenticate: async () => { throw new TradeIdentityError("expired", 401); } }]
  ] as const) {
    const result = await handleCannaCatEmbedRequest(req, op, deps);
    check(() => assert.equal(result.status, status));
  }
  check(() => assert.equal(calls, before));
  const preflight = await handleCannaCatEmbedRequest(request({}, "https://lammb.fun", "OPTIONS", { "access-control-request-method": "POST", "access-control-request-headers": "content-type,privy-id-token,x-rmt-client" }), "quotes", dependencies);
  check(() => assert.equal(preflight.status, 204));
  const invalidPreflight = await handleCannaCatEmbedRequest(request({}, "https://lammb.fun", "OPTIONS", { "access-control-request-method": "POST", "access-control-request-headers": "cookie" }), "quotes", dependencies);
  check(() => assert.equal(invalidPreflight.status, 403));
  const duplicateJson = new Request("https://rmt.example/api/embed/cannacat/quotes", {
    method: "POST", headers: request().headers, body: '{"chainId":4663,"chainId":1}'
  });
  check(() => assert.equal((await handleCannaCatEmbedRequest(duplicateJson, "quotes", dependencies)).status, 400));
  const api = createCannaCatClient({ baseUrl: "https://rmt.example/api/embed/cannacat", identityToken: "fixture", fetch: async (_url, init) => {
    check(() => assert.equal(init?.credentials, "omit"));
    check(() => assert.equal(init?.redirect, "error"));
    return Response.json({ error: "private provider diagnostic" }, { status: 409 });
  } });
  await assert.rejects(() => api.quote({ side: "buy", tokenAmountAtomic: "10000", wallet, maximumEthInputAtomic: "100000000000000000" }), /quote changed/i); checks += 1;
  for (let i = 0; i < 60; i++) await handleCannaCatEmbedRequest(request(), "quotes", dependencies);
  check(() => assert.equal((await handleCannaCatEmbedRequest(request(), "quotes", dependencies)).status, 429));
  console.log(JSON.stringify({ suite: "cannacat-embed-boundary-and-client", checks, result: "PASS", realWalletRequests: 0, realTransactions: 0 }));
}
void main().catch((cause) => { console.error(cause); process.exitCode = 1; });
