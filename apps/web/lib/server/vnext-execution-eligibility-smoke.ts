import assert from "node:assert/strict";
import { getAddress } from "viem";
import { RMT_CURATED_MARKET_REGISTRY } from "../vnext/curated-market-registry";
import {
  ROBINHOOD_NATIVE_ASSET_ADDRESS,
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";
import {
  requireVNextExecutionProvider,
  resolveVNextExecutionEligibility,
  VNextExecutionEligibilityError
} from "./vnext-execution-eligibility";

const providers = ["sushi", "uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl", "zero-x-swap", "zero-x-gasless"] as const;
const curated = RMT_CURATED_MARKET_REGISTRY[0]!.token;
const observed = getAddress("0x1111111111111111111111111111111111111111");
const secondObserved = getAddress("0x2222222222222222222222222222222222222222");

const curatedEligibility = resolveVNextExecutionEligibility(curated, ROBINHOOD_NATIVE_ASSET_ADDRESS, providers);
assert.equal(curatedEligibility.curated, true);
assert.deepEqual(curatedEligibility.providers, providers, "Curated markets retain their existing provider capability surface");

const observedEligibility = resolveVNextExecutionEligibility(observed, ROBINHOOD_USDG_ADDRESS, providers);
assert.equal(observedEligibility.curated, false);
assert.deepEqual(observedEligibility.providers, ["uniswap-v2", "uniswap-v3", "zero-x-swap"]);
for (const [input, output] of [[observed, ROBINHOOD_USDG_ADDRESS], [ROBINHOOD_NATIVE_ASSET_ADDRESS, observed], [ROBINHOOD_USDG_ADDRESS, observed]] as const) {
  assert.deepEqual(resolveVNextExecutionEligibility(input, output, providers).providers, ["uniswap-v2", "uniswap-v3", "zero-x-swap"]);
  assert.doesNotThrow(() => requireVNextExecutionProvider(input, output, "zero-x-swap", providers));
}
assert.doesNotThrow(() => requireVNextExecutionProvider(observed, ROBINHOOD_USDG_ADDRESS, "uniswap-v2", providers));
assert.doesNotThrow(() => requireVNextExecutionProvider(observed, ROBINHOOD_USDG_ADDRESS, "uniswap-v3", providers));
assert.throws(
  () => requireVNextExecutionProvider(observed, ROBINHOOD_USDG_ADDRESS, "uniswap-v4", providers),
  VNextExecutionEligibilityError,
  "Non-curated V4 must remain read-only without reviewed PoolKey authority"
);
assert.throws(
  () => requireVNextExecutionProvider(observed, ROBINHOOD_USDG_ADDRESS, "sushi", providers),
  VNextExecutionEligibilityError,
  "A provider observation cannot authorize an unsupported execution family"
);
assert.throws(
  () => resolveVNextExecutionEligibility(observed, secondObserved, providers),
  /one exact Token Market asset and one supported settlement asset/
);
for (const [input, output] of [
  [ROBINHOOD_NATIVE_ASSET_ADDRESS, ROBINHOOD_USDG_ADDRESS],
  [ROBINHOOD_USDG_ADDRESS, ROBINHOOD_NATIVE_ASSET_ADDRESS],
  [ROBINHOOD_WETH_ADDRESS, ROBINHOOD_USDG_ADDRESS],
  [ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS]
] as const) {
  assert.deepEqual(resolveVNextExecutionEligibility(input, output, providers), { marketAssets: [], curated: false, providers: ["zero-x-swap"] });
  assert.doesNotThrow(() => requireVNextExecutionProvider(input, output, "zero-x-swap", providers));
  for (const provider of providers.filter((candidate) => candidate !== "zero-x-swap")) {
    assert.throws(() => requireVNextExecutionProvider(input, output, provider, providers), VNextExecutionEligibilityError);
  }
  assert.deepEqual(resolveVNextExecutionEligibility(input, output, ["uniswap-v2", "uniswap-v3", "zero-x-gasless"]).providers, []);
}
assert.throws(() => requireVNextExecutionProvider(observed, ROBINHOOD_USDG_ADDRESS, "zero-x-gasless", providers), VNextExecutionEligibilityError);

console.info("VNext dynamic execution eligibility smoke passed");
