import assert from "node:assert/strict";
import { zeroAddress } from "viem";
import { allowedCannaCatOrigin, CANNACAT_ADDRESS, CANNACAT_EMBED_VERSION, handleCannaCatEmbedRequest, validateCannaCatEmbedBody } from "../server/cannacat-embed-boundary";
import { TradeIdentityError } from "../server/rmt-trade-identity";
import { CANNACAT_EMBED, createCannaCatClient, nextCannaCatBuyInput, parseCannaCatAmount } from "./cannacat-client";
import { createVNextZeroXProviderNativeFee } from "../vnext/zero-x-settlement";
import { connectedWalletChainId, exactConnectedExternalWallet, readConnectedWallet, soleConnectedExternalWallet } from "../connected-wallet-state";
import { walletGatewayKey } from "../wallet-gateway";

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
  const candidate = { address: wallet, type: "ethereum" as const, connectorType: "injected", walletClientType: "metamask", meta: { id: "fixture-metamask" } };
  const rabby = { ...candidate, walletClientType: "rabby", meta: { id: "fixture-rabby" } };
  check(() => assert.equal(soleConnectedExternalWallet([candidate]), candidate));
  check(() => assert.equal(soleConnectedExternalWallet([candidate, rabby]), undefined));
  check(() => assert.equal(soleConnectedExternalWallet([candidate, candidate]), undefined));
  check(() => assert.equal(soleConnectedExternalWallet([{ ...candidate, walletClientType: "privy" }]), undefined));
  check(() => assert.equal(exactConnectedExternalWallet([candidate, rabby], walletGatewayKey(rabby)), rabby));
  check(() => assert.equal(exactConnectedExternalWallet([candidate, candidate], walletGatewayKey(candidate)), undefined));
  for (const value of [4663, "4663", "0x1237", "0X1237", "eip155:4663"]) check(() => assert.equal(connectedWalletChainId(value), 4663));
  for (const value of [0, -1, 1.5, Infinity, {}, "", "eip155:0", "0x", "4663.0", "9007199254740992"]) check(() => assert.equal(connectedWalletChainId(value), null));
  const methods: string[] = [];
  const probe = async (accounts: unknown, chain: unknown) => readConnectedWallet({ address: wallet,
    getEthereumProvider: async () => ({ request: async ({ method }: { method: string }) => { methods.push(method); return method === "eth_accounts" ? accounts : chain; } }) });
  const live = await probe([wallet], "0x1237");
  check(() => assert.equal(live.status, "ready"));
  check(() => assert.equal(live.chainId, 4663));
  check(() => assert.notEqual(live.provider, null));
  const wrong = await probe([wallet], "0x1");
  check(() => assert.equal(wrong.status, "wrong-chain"));
  const unordered = await probe(["0x1111111111111111111111111111111111111111", wallet], "0x1237");
  check(() => assert.equal(unordered.status, "ready"));
  const mismatch = await probe(["0x1111111111111111111111111111111111111111"], "0x1237");
  check(() => assert.equal(mismatch.status, "account-mismatch"));
  const empty = await probe([], "0x1237");
  check(() => assert.equal(empty.status, "disconnected"));
  const malformed = await probe([wallet], {});
  check(() => assert.equal(malformed.status, "unavailable"));
  const unavailable = await readConnectedWallet({ address: wallet, getEthereumProvider: async () => null });
  check(() => assert.equal(unavailable.status, "unavailable"));
  check(() => assert(methods.every(method => method === "eth_accounts" || method === "eth_chainId")));
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
  const duplicateResult = await handleCannaCatEmbedRequest(duplicateJson, "quotes", dependencies);
  check(() => assert.equal(duplicateResult.status, 400));
  const api = createCannaCatClient({ baseUrl: "https://rmt.example/api/embed/cannacat", identityToken: "fixture", fetch: async (_url, init) => {
    check(() => assert.equal(init?.credentials, "omit"));
    check(() => assert.equal(init?.redirect, "error"));
    return Response.json({ error: "private provider diagnostic" }, { status: 409 });
  } });
  await assert.rejects(() => api.quote({ side: "buy", tokenAmountAtomic: "10000", wallet, maximumEthInputAtomic: "100000000000000000" }), /quote changed/i); checks += 1;
  let quoteCalls = 0;
  const fixedNow = Date.now();
  const successfulApi = createCannaCatClient({ baseUrl: "https://rmt.example/api/embed/cannacat", identityToken: "fixture", now: () => fixedNow, fetch: async (_url, init) => {
    quoteCalls += 1;
    const input = JSON.parse(String(init?.body));
    const output = (BigInt(input.inputAmountAtomic) * (input.inputAsset === zeroAddress ? 10_000_000n : 1n) / (input.inputAsset === zeroAddress ? 1n : 10_000_000n)).toString();
    const minimum = (BigInt(output) * 99n / 100n).toString();
    const fee = createVNextZeroXProviderNativeFee({ inputAsset: input.inputAsset, outputAsset: input.outputAsset, userGrossInputAtomic: input.inputAmountAtomic,
      expectedOutputAtomic: output, protectedOutputAtomic: minimum, recipient: input.recipient, authorizationState: "indicative",
      quotedFeeAmountAtomic: input.inputAsset === zeroAddress ? undefined : String(BigInt(output) * 25n / 10_000n) });
    return Response.json({ requestId: "11111111-1111-4111-8111-111111111111", chainId: 4663,
      inputAsset: input.inputAsset, outputAsset: input.outputAsset, inputAmountAtomic: input.inputAmountAtomic, requestedAtMs: fixedNow - 50, completedAtMs: fixedNow,
      attempts: [{ provider: "zero-x-swap", providerLabel: "0x", providerFamily: "zeroex", adapterVersion: 1, status: "indicative", chainId: 4663,
        inputAsset: input.inputAsset, outputAsset: input.outputAsset, inputAmountAtomic: input.inputAmountAtomic, expectedOutputAtomic: output, protectedOutputAtomic: minimum,
        outputDecimals: 18, priceImpact: null, liquidityFeeEvidence: [], quotedAtMs: fixedNow, expiresAtMs: fixedNow + 10_000,
        latencyMs: 50, executionKind: "aggregator", strictVerificationAvailable: true, publicWalletExecutionEligible: true, userPaysGas: true,
        providerFeeAsset: null, providerFeeAtomic: null, gasSponsorshipFeeAsset: null, gasSponsorshipFeeAtomic: null, explicitProviderFeeOutputAtomic: null,
        netEconomics: null, settlementMode: "PROVIDER_NATIVE_INPUT_FEE", providerNativeFee: fee, networkFeeNativeAtomic: "9000000000", networkFeeNativeSymbol: "ETH",
        protectedNetOutputAtomic: null, costState: "network_fee_pending", authorizationReady: false, detail: "Synthetic exact-input quote fixture." }] });
  } });
  const bought = await successfulApi.quote({ side: "buy", tokenAmountAtomic: parseCannaCatAmount("10000"), wallet, maximumEthInputAtomic: "100000000000000000" });
  check(() => assert.ok(quoteCalls > 1 && quoteCalls <= 5));
  check(() => assert.ok(BigInt(bought.attempt.protectedOutputAtomic!) >= 10_000n * 10n ** 18n));
  check(() => assert.equal(bought.attempt.providerNativeFee?.feeBps, 25));
  check(() => assert.equal(bought.inputAsset, zeroAddress));
  const small = await successfulApi.quote({ side: "buy", tokenAmountAtomic: parseCannaCatAmount("10"), wallet, maximumEthInputAtomic: "100000000000000000" });
  check(() => assert.ok(BigInt(small.attempt.protectedOutputAtomic!) >= 10n * 10n ** 18n));
  check(() => assert.ok(BigInt(small.attempt.protectedOutputAtomic!) * 10_000n <= 10n * 10n ** 18n * 10_050n));
  check(() => assert.ok(BigInt(small.inputAmountAtomic) < 100_000_000_000_000n));
  const beforeSell = quoteCalls;
  const sold = await successfulApi.quote({ side: "sell", tokenAmountAtomic: parseCannaCatAmount("10000"), wallet, maximumEthInputAtomic: "100000000000000000" });
  check(() => assert.equal(quoteCalls - beforeSell, 1));
  check(() => assert.equal(sold.inputAmountAtomic, parseCannaCatAmount("10000")));
  check(() => assert.equal(sold.outputAsset, zeroAddress));
  check(() => assert.equal(sold.attempt.providerNativeFee?.feeAsset, zeroAddress));
  const expired = { ...bought, attempt: { ...bought.attempt, expiresAtMs: fixedNow } };
  await assert.rejects(() => successfulApi.prepare(expired), /expired quote/); checks += 1;
  const canceled = new AbortController(); canceled.abort();
  const beforeAbort = quoteCalls;
  await assert.rejects(() => successfulApi.quote({ side: "buy", tokenAmountAtomic: "10000", wallet, maximumEthInputAtomic: "100000000000000000", signal: canceled.signal })); checks += 1;
  check(() => assert.equal(quoteCalls, beforeAbort));
  for (let i = 0; i < 60; i++) await handleCannaCatEmbedRequest(request(), "quotes", dependencies);
  const limitedResult = await handleCannaCatEmbedRequest(request(), "quotes", dependencies);
  check(() => assert.equal(limitedResult.status, 429));
  console.log(JSON.stringify({ suite: "cannacat-embed-boundary-and-client", checks, result: "PASS", realWalletRequests: 0, realTransactions: 0 }));
}
void main().catch((cause) => { console.error(cause); process.exitCode = 1; });
