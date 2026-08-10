import assert from "node:assert/strict";
import { getAddress } from "viem";
import { vNextZeroXGaslessAdapter, vNextZeroXSwapAdapter } from "../server/vnext-zero-x-adapter";
import type { VNextProviderQuoteRequest } from "../server/vnext-provider-adapter";
import { runZeroXFirmQuoteVerifierSmoke } from "./zero-x-firm-quote-verifier-smoke";

const originalFetch = globalThis.fetch;
const originalKey = process.env.RMT_ZEROX_API_KEY;
const inputAsset = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const outputAsset = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const recipient = getAddress("0x0000000000000000000000000000000000010000");
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

function priceResponse(mode: "swap" | "gasless") {
  return {
    liquidityAvailable: true,
    sellToken: inputAsset.toLowerCase(),
    buyToken: outputAsset.toLowerCase(),
    sellAmount: request.inputAmountAtomic,
    buyAmount: "520000000000000",
    minBuyAmount: "514800000000000",
    totalNetworkFee: mode === "swap" ? "9000000000000" : null,
    fees: {
      zeroExFee: { amount: "1500", token: inputAsset, type: "volume" },
      gasFee: mode === "gasless" ? { amount: "22000", token: inputAsset, type: "gas" } : null
    },
    route: { fills: [{ source: "Uniswap_V3" }] }
  };
}

async function run() {
  process.env.RMT_ZEROX_API_KEY = "server-only-test-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.0x.org");
    assert.equal(url.searchParams.get("chainId"), "4663");
    assert.equal(url.searchParams.get("sellToken"), inputAsset);
    assert.equal(url.searchParams.get("buyToken"), outputAsset);
    assert.equal(url.searchParams.get("sellAmount"), request.inputAmountAtomic);
    assert.equal(url.searchParams.get("taker"), recipient);
    assert.equal(new Headers(init?.headers).get("0x-api-key"), "server-only-test-key");
    assert.equal(new Headers(init?.headers).get("0x-version"), "v2");
    return Response.json(priceResponse(url.pathname === "/gasless/price" ? "gasless" : "swap"));
  };

  const swap = await vNextZeroXSwapAdapter.quote(request);
  assert.equal(swap.status, "indicative");
  assert.equal(swap.userPaysGas, true);
  assert.equal(swap.networkFeeNativeAtomic, "9000000000000");
  assert.equal(swap.providerFeeAsset, inputAsset);
  assert.equal(swap.providerFeeAtomic, "1500");
  assert.equal(swap.gasSponsorshipFeeAtomic, null);
  assert.equal(swap.authorizationReady, false);
  assert.equal(swap.strictVerificationAvailable, false);

  const gasless = await vNextZeroXGaslessAdapter.quote(request);
  assert.equal(gasless.status, "indicative");
  assert.equal(gasless.userPaysGas, false);
  assert.equal(gasless.networkFeeNativeAtomic, null);
  assert.equal(gasless.gasSponsorshipFeeAsset, inputAsset);
  assert.equal(gasless.gasSponsorshipFeeAtomic, "22000");
  assert.equal(gasless.protectedNetOutputAtomic, gasless.protectedOutputAtomic);
  assert.equal(gasless.authorizationReady, false);
  assert.equal(gasless.strictVerificationAvailable, false);

  globalThis.fetch = async () => Response.json({ ...priceResponse("swap"), buyToken: inputAsset });
  assert.equal((await vNextZeroXSwapAdapter.quote(request)).status, "invalid_response");

  delete process.env.RMT_ZEROX_API_KEY;
  assert.equal((await vNextZeroXSwapAdapter.quote(request)).status, "temporarily_unavailable");

  await runZeroXFirmQuoteVerifierSmoke();
}

void run().then(() => {
  console.log("RMT VNext 0x observation and firm-quote verification foundation smoke checks passed.");
}).catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.RMT_ZEROX_API_KEY;
  else process.env.RMT_ZEROX_API_KEY = originalKey;
});
