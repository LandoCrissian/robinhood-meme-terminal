import assert from "node:assert/strict";
import { getAddress, zeroAddress } from "viem";
import { parseZeroXPrice, vNextZeroXGaslessAdapter, vNextZeroXSwapAdapter } from "../server/vnext-zero-x-adapter";
import type { VNextProviderQuoteRequest } from "../server/vnext-provider-adapter";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "./execution-settlement";
import { RMT_ZERO_X_FEE_TREASURY, ZERO_X_NATIVE_TOKEN, fromZeroXToken, toZeroXToken } from "./zero-x-settlement";
import { runZeroXFirmQuoteVerifierSmoke } from "./zero-x-firm-quote-verifier-smoke";

const originalFetch = globalThis.fetch;
const originalKey = process.env.RMT_ZEROX_API_KEY;
const erc20A = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const erc20B = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const recipient = getAddress("0x0000000000000000000000000000000000010000");

function request(inputAsset = erc20A, outputAsset = erc20B): VNextProviderQuoteRequest {
  return {
    chainId: 4_663, inputAsset, outputAsset, inputAmountAtomic: "1000000", amountIn: 1_000_000n, recipient,
    inputIdentity: { address: inputAsset, symbol: inputAsset === zeroAddress ? "ETH" : "SELL", decimals: 18 },
    outputIdentity: { address: outputAsset, symbol: outputAsset === zeroAddress ? "ETH" : "BUY", decimals: 18 }
  };
}

function response(inputAsset: string, outputAsset: string) {
  const sellToken = toZeroXToken(inputAsset);
  const buyToken = toZeroXToken(outputAsset);
  return {
    liquidityAvailable: true, sellToken, buyToken, sellAmount: "1000000", buyAmount: "520000", minBuyAmount: "510000",
    totalNetworkFee: "9000",
    fees: {
      integratorFee: { amount: "2500", token: sellToken, type: "volume" },
      integratorFees: [],
      zeroExFee: { amount: "1500", token: buyToken, type: "volume" },
      gasFee: null
    }
  };
}

async function run() {
try {
  process.env.RMT_ZEROX_API_KEY = "server-only-test-key";
  assert.equal(toZeroXToken(zeroAddress), ZERO_X_NATIVE_TOKEN);
  assert.equal(fromZeroXToken(ZERO_X_NATIVE_TOKEN), zeroAddress);
  assert.equal(vNextZeroXSwapAdapter.capabilities.strictVerification, true);
  assert.equal(vNextZeroXSwapAdapter.capabilities.walletAuthorization, true);
  assert.equal(vNextZeroXGaslessAdapter.capabilities.strictVerification, false);
  assert.equal(vNextZeroXGaslessAdapter.capabilities.walletAuthorization, false);

  globalThis.fetch = async (raw, init) => {
    const url = new URL(String(raw));
    const inputAsset = fromZeroXToken(url.searchParams.get("sellToken")!);
    const outputAsset = fromZeroXToken(url.searchParams.get("buyToken")!);
    assert.equal(url.pathname, "/swap/allowance-holder/price");
    assert.equal(url.searchParams.get("swapFeeRecipient"), RMT_ZERO_X_FEE_TREASURY);
    assert.equal(url.searchParams.get("swapFeeBps"), "25");
    assert.equal(url.searchParams.get("swapFeeToken"), toZeroXToken(inputAsset));
    assert.equal(url.searchParams.has("tradeSurplusRecipient"), false);
    assert.equal(new Headers(init?.headers).get("0x-api-key"), "server-only-test-key");
    assert.equal(new Headers(init?.headers).get("0x-version"), "v2");
    return Response.json(response(inputAsset, outputAsset));
  };

  for (const pair of [[erc20A, erc20B], [erc20A, zeroAddress], [zeroAddress, erc20B]] as const) {
    const quoted = await vNextZeroXSwapAdapter.quote(request(...pair));
    assert.equal(quoted.status, "indicative");
    assert.equal(quoted.settlementMode, VNEXT_PROVIDER_NATIVE_INPUT_FEE);
    assert.equal(quoted.providerNativeFee?.feeAmountAtomic, "2500");
    assert.equal(quoted.providerNativeFee?.feeAsset, pair[0]);
    assert.equal(quoted.providerFeeAtomic, "1500");
  }

  const base = response(erc20A, erc20B);
  assert.throws(() => parseZeroXPrice({ ...base, fees: { ...base.fees, integratorFee: null } }, request(), "swap"), /omitted/);
  assert.throws(() => parseZeroXPrice({ ...base, fees: { ...base.fees, integratorFee: { amount: "2501", token: erc20A, type: "volume" } } }, request(), "swap"), /wrong integrator fee amount/);
  assert.throws(() => parseZeroXPrice({ ...base, fees: { ...base.fees, integratorFee: { amount: "2500", token: erc20B, type: "volume" } } }, request(), "swap"), /wrong token/);
  assert.throws(() => parseZeroXPrice({ ...base, fees: { ...base.fees, integratorFees: [{ amount: "2500", token: erc20A, type: "volume" }, { amount: "2500", token: erc20A, type: "volume" }] } }, request(), "swap"), /duplicate/);
  assert.doesNotThrow(() => parseZeroXPrice({ ...base, fees: { ...base.fees, integratorFees: [{ amount: "2500", token: erc20A, type: "volume" }] } }, request(), "swap"));
  assert.throws(() => parseZeroXPrice({ ...base, sellToken: zeroAddress }, request(zeroAddress, erc20B), "swap"), /zeroAddress/);

  await runZeroXFirmQuoteVerifierSmoke();
  console.log("RMT VNext 0x AllowanceHolder execution smoke checks passed.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.RMT_ZEROX_API_KEY;
  else process.env.RMT_ZEROX_API_KEY = originalKey;
}
}

void run();
