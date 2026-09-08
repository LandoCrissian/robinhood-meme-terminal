import assert from "node:assert/strict";
import { getAddress } from "viem";
import { createZeroXSwapDiagnosticAdapter, parseZeroXPrice, vNextZeroXSwapAdapter, ZeroXInvalidResponseError } from "../server/vnext-zero-x-adapter";
import { safeZeroXPriceEconomics, type ZeroXInvalidResponseReason, type ZeroXPriceDiagnostic } from "../server/vnext-zero-x-response-diagnostics";
import type { VNextProviderQuoteRequest } from "../server/vnext-provider-adapter";

const asset = getAddress("0xccc331d2f8e102a606e1fff194e65ea9bed767c2");
const output = getAddress("0x5fc5360d0400a0fd4f2af552add042d716f1d168");
const request: VNextProviderQuoteRequest = { chainId: 4663, inputAsset: asset, outputAsset: output,
  inputAmountAtomic: "20928430761903298088735", amountIn: 20928430761903298088735n,
  recipient: getAddress("0x1111111111111111111111111111111111111111"),
  inputIdentity: { address: asset, symbol: "LIG", decimals: 18 }, outputIdentity: { address: output, symbol: "USDG", decimals: 6 } };
const base = () => ({ liquidityAvailable: true, sellToken: asset, buyToken: output, sellAmount: request.inputAmountAtomic,
  buyAmount: "1000000", minBuyAmount: "991000", totalNetworkFee: "89920068840000",
  fees: { integratorFee: { token: asset, amount: "52321076904758245221", type: "volume" }, zeroExFee: null, gasFee: null } });
const reject = (value: unknown, reason: ZeroXInvalidResponseReason) => assert.throws(() => parseZeroXPrice(value, request, "swap"),
  error => error instanceof ZeroXInvalidResponseError && error.reason === reason);
const fee = (patch: Record<string, unknown>) => ({ ...base(), fees: { ...base().fees, integratorFee: { ...base().fees.integratorFee, ...patch } } });
assert.ok(parseZeroXPrice(base(), request, "swap"));
reject(fee({ amount: "52321076904758245222" }), "WRONG_INTEGRATOR_FEE_AMOUNT"); // Live ceil versus exact required floor.
reject(fee({ amount: "52321076904758245220" }), "WRONG_INTEGRATOR_FEE_AMOUNT");
reject({ ...base(), fees: { ...base().fees, integratorFee: null } }, "MISSING_INTEGRATOR_FEE"); // Live wrapping response.
reject(fee({ token: output }), "WRONG_INTEGRATOR_FEE_TOKEN");
reject(fee({ type: "gas" }), "INVALID_INTEGRATOR_FEE_TYPE");
reject(fee({ amount: "0" }), "INVALID_INTEGRATOR_FEE");
reject({ ...base(), fees: { ...base().fees, integratorFees: [base().fees.integratorFee, base().fees.integratorFee] } }, "DUPLICATE_INTEGRATOR_FEE");
reject({ ...base(), sellToken: output }, "INVALID_TOKEN_BINDING");
reject({ ...base(), buyToken: "not-an-address" }, "INVALID_TOKEN_BINDING");
reject({ ...base(), sellAmount: "1" }, "CHANGED_SELL_AMOUNT");
reject({ ...base(), buyAmount: "0" }, "INVALID_EXPECTED_OUTPUT");
reject({ ...base(), minBuyAmount: "1000001" }, "INVALID_MINIMUM_OUTPUT");
reject({ ...base(), fees: null }, "MISSING_FEE_DISCLOSURE");
reject({ ...base(), fees: { ...base().fees, zeroExFee: { token: asset, amount: "bad" } } }, "INVALID_PROVIDER_FEE");
reject({ ...base(), totalNetworkFee: null }, "MISSING_NETWORK_FEE");
reject({ ...base(), fees: { ...base().fees, gasFee: { token: asset, amount: "5" } } }, "CONTRADICTORY_NETWORK_FEE");
reject({}, "OTHER_SCHEMA_VIOLATION");
const marker = "DO_NOT_RETAIN_ARBITRARY_TEXT";
const safe = safeZeroXPriceEconomics({ ...base(), transaction: { data: marker }, headers: marker, error: marker,
  fees: { integratorFee: { token: marker, amount: marker, type: marker }, integratorFees: Array(100).fill({ amount: marker }) } });
assert.ok(!JSON.stringify(safe).includes(marker)); assert.equal(safe.integratorFees.length, 2); assert.equal(safe.integratorFeesOverflow, true);

export async function runZeroXResponseReasonsSmoke() {
  const previousFetch = globalThis.fetch, previousKey = process.env.RMT_ZEROX_API_KEY;
  const diagnostics: ZeroXPriceDiagnostic[] = [];
  try {
    process.env.RMT_ZEROX_API_KEY = "test-only";
    globalThis.fetch = async () => Response.json(fee({ amount: "52321076904758245222" }));
    const publicResult = await vNextZeroXSwapAdapter.quote(request);
    const result = await createZeroXSwapDiagnosticAdapter(value => diagnostics.push(value)).quote(request);
    assert.equal(result.status, "invalid_response"); assert.equal(publicResult.status, "invalid_response");
    assert.equal(diagnostics[0].reason, "WRONG_INTEGRATOR_FEE_AMOUNT");
    assert.ok(!("invalidResponseReason" in publicResult)); assert.ok(!("responseEconomics" in publicResult));
    globalThis.fetch = async () => Response.json({ ...base(), buyToken: "invalid" });
    assert.equal((await vNextZeroXSwapAdapter.quote(request)).status, "invalid_response", "malformed token is not a transport outage");
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.RMT_ZEROX_API_KEY; else process.env.RMT_ZEROX_API_KEY = previousKey; }
  console.log("Bounded 0x rejection reasons, exact fee floor and public fail-closed behavior PASS.");
}
