import assert from "node:assert/strict";
import { getAddress, zeroAddress } from "viem";
import { configuredVNextUniswapXAdapters, vNextUniswapXAdapter } from "../server/vnext-uniswapx-adapter";
import type { VNextProviderQuoteRequest } from "../server/vnext-provider-adapter";

const originalFetch = globalThis.fetch;
const originalKey = process.env.RMT_UNISWAP_API_KEY;
const originalGate = process.env.RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED;
const inputAsset = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const outputAsset = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const recipient = getAddress("0x0000000000000000000000000000000000010000");
const reactor = getAddress("0x000000007A1C8e570011EeDF86A2A35593013cBA");
const request: VNextProviderQuoteRequest = {
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "1000000",
  amountIn: 1_000_000n,
  recipient,
  inputIdentity: { address: inputAsset, symbol: "USDG", decimals: 6 },
  outputIdentity: { address: outputAsset, symbol: "WETH", decimals: 18 }
};

function quoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    routing: "DUTCH_V3",
    quote: {
      input: { token: inputAsset.toLowerCase(), amount: request.inputAmountAtomic, maximumAmount: request.inputAmountAtomic },
      output: { token: outputAsset.toLowerCase(), amount: "520000000000000", minimumAmount: "514800000000000", recipient },
      orderInfo: { chainId: 4_663, swapper: recipient, reactor },
      portionBips: 0,
      portionAmount: "0",
      encodedOrder: "0xdeadbeef",
      ...overrides
    },
    permitData: { domain: {}, values: {}, types: {} }
  };
}

async function run() {
  delete process.env.RMT_UNISWAP_API_KEY;
  delete process.env.RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED;
  assert.equal(configuredVNextUniswapXAdapters().length, 0);
  process.env.RMT_UNISWAP_API_KEY = "server-only-test-key";
  assert.equal(configuredVNextUniswapXAdapters().length, 0);
  process.env.RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED = "true";
  assert.equal(configuredVNextUniswapXAdapters().length, 1);

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.href, "https://trade-api.gateway.uniswap.org/v1/quote");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-api-key"), "server-only-test-key");
    assert.equal(headers.get("x-universal-router-version"), "2.1.1");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(body, {
      type: "EXACT_INPUT",
      amount: request.inputAmountAtomic,
      tokenInChainId: 4_663,
      tokenOutChainId: 4_663,
      tokenIn: inputAsset,
      tokenOut: outputAsset,
      swapper: recipient,
      recipient,
      slippageTolerance: 1,
      routingPreference: "BEST_PRICE",
      protocols: ["UNISWAPX_LATEST"]
    });
    return Response.json(quoteResponse());
  };

  const ready = await vNextUniswapXAdapter.quote(request);
  assert.equal(ready.status, "indicative");
  assert.equal(ready.provider, "uniswapx");
  assert.equal(ready.providerFamily, "uniswapx");
  assert.equal(ready.executionKind, "rfq_intent");
  assert.equal(ready.expectedOutputAtomic, "520000000000000");
  assert.equal(ready.protectedOutputAtomic, "514800000000000");
  assert.equal(ready.protectedNetOutputAtomic, ready.protectedOutputAtomic);
  assert.equal(ready.userPaysGas, false);
  assert.equal(ready.gasSponsorshipFeeAtomic, null);
  assert.equal(ready.rmtFeeOutputAtomic, "0");
  assert.equal(ready.strictVerificationAvailable, false);
  assert.equal(ready.authorizationReady, false);
  assert.equal("rawProviderQuote" in ready, false);
  assert.equal("encodedOrder" in ready, false);

  globalThis.fetch = async () => Response.json(quoteResponse({
    output: { token: inputAsset, amount: "520000000000000", minimumAmount: "514800000000000", recipient }
  }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json(quoteResponse({
    output: { token: outputAsset, amount: "520000000000000", minimumAmount: "514800000000000", recipient: inputAsset }
  }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json(quoteResponse({
    input: { token: inputAsset, amount: "999999" }
  }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json(quoteResponse({
    output: { token: outputAsset, amount: "500", minimumAmount: "501", recipient }
  }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json({ ...quoteResponse(), routing: "CLASSIC" });
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json(quoteResponse({
    orderInfo: { chainId: 4_663, swapper: recipient, reactor: inputAsset }
  }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json(quoteResponse({ portionBips: 10, portionAmount: "520000000000" }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json({ message: "No quotes available" }, { status: 400 });
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "no_route");

  globalThis.fetch = async () => Response.json({ message: "rate limited" }, { status: 429 });
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "temporarily_unavailable");

  let nativeFetchCalled = false;
  globalThis.fetch = async () => {
    nativeFetchCalled = true;
    return Response.json(quoteResponse());
  };
  const native = await vNextUniswapXAdapter.quote({
    ...request,
    inputAsset: zeroAddress,
    inputIdentity: { address: zeroAddress, symbol: "ETH", decimals: 18 }
  });
  assert.equal(native.status, "no_route");
  assert.equal(nativeFetchCalled, false);

  delete process.env.RMT_UNISWAP_API_KEY;
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "temporarily_unavailable");
}

void run().then(() => {
  console.log("RMT VNext UniswapX observation adapter smoke checks passed.");
}).catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.RMT_UNISWAP_API_KEY;
  else process.env.RMT_UNISWAP_API_KEY = originalKey;
  if (originalGate === undefined) delete process.env.RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED;
  else process.env.RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED = originalGate;
});
