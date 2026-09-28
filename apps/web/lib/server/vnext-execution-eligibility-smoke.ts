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
import { selectRobinhoodVNextPublicQuoteAdapters } from "./vnext-execution-engine";
import { quoteVNextExecutionProviders, type VNextQuoteProviderAdapter } from "./vnext-provider-adapter";

const providers = ["sushi", "uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl", "zero-x-swap", "zero-x-gasless"] as const;
const curated = RMT_CURATED_MARKET_REGISTRY[0]!.token;
const observed = getAddress("0x1111111111111111111111111111111111111111");
const secondObserved = getAddress("0x2222222222222222222222222222222222222222");

const curatedEligibility = resolveVNextExecutionEligibility(curated, ROBINHOOD_NATIVE_ASSET_ADDRESS, providers);
assert.equal(curatedEligibility.curated, true);
assert.deepEqual(curatedEligibility.providers, ["zero-x-swap"], "Curation must not reactivate retired or quote-only providers");

const observedEligibility = resolveVNextExecutionEligibility(observed, ROBINHOOD_USDG_ADDRESS, providers);
assert.equal(observedEligibility.curated, false);
assert.deepEqual(observedEligibility.providers, ["zero-x-swap"]);
for (const [input, output] of [[observed, ROBINHOOD_USDG_ADDRESS], [ROBINHOOD_NATIVE_ASSET_ADDRESS, observed], [ROBINHOOD_USDG_ADDRESS, observed]] as const) {
  assert.deepEqual(resolveVNextExecutionEligibility(input, output, providers).providers, ["zero-x-swap"]);
  assert.doesNotThrow(() => requireVNextExecutionProvider(input, output, "zero-x-swap", providers));
}
assert.throws(() => requireVNextExecutionProvider(observed, ROBINHOOD_USDG_ADDRESS, "uniswap-v2", providers), VNextExecutionEligibilityError);
assert.throws(() => requireVNextExecutionProvider(observed, ROBINHOOD_USDG_ADDRESS, "uniswap-v3", providers), VNextExecutionEligibilityError);
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
assert.deepEqual(resolveVNextExecutionEligibility(observed, secondObserved, providers).providers, ["zero-x-swap"],
  "Two non-curated ERC20 assets remain tradable when canonical 0x can route them");
assert.doesNotThrow(() => requireVNextExecutionProvider(observed, secondObserved, "zero-x-swap", providers));
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

async function proveGaslessIsNotDispatched() {
  let swapCalls = 0;
  let gaslessCalls = 0;
  const adapter = (provider: "zero-x-swap" | "zero-x-gasless", quote: () => Promise<never>): VNextQuoteProviderAdapter => ({
    provider,
    providerLabel: provider,
    providerFamily: "zeroex",
    adapterVersion: 1,
    executionKind: provider === "zero-x-swap" ? "aggregator" : "gasless",
    capabilities: { strictVerification: provider === "zero-x-swap", walletAuthorization: provider === "zero-x-swap" },
    quote
  });
  const adapters = [
    adapter("zero-x-swap", async () => { swapCalls++; throw new Error("controlled swap boundary"); }),
    adapter("zero-x-gasless", async () => { gaslessCalls++; throw new Error("gasless must remain dormant"); })
  ];
  const request = {
    chainId: 4_663 as const,
    inputAsset: ROBINHOOD_NATIVE_ASSET_ADDRESS,
    outputAsset: observed,
    inputAmountAtomic: "500000000000000",
    amountIn: 500000000000000n,
    recipient: getAddress("0x3333333333333333333333333333333333333333"),
    inputIdentity: { address: ROBINHOOD_NATIVE_ASSET_ADDRESS, symbol: "ETH", decimals: 18 },
    outputIdentity: { address: observed, symbol: "OBS", decimals: 18 }
  };
  const selected = selectRobinhoodVNextPublicQuoteAdapters(request, adapters);
  const attempts = await quoteVNextExecutionProviders(request, selected);
  assert.equal(swapCalls, 1);
  assert.equal(gaslessCalls, 0);
  assert.deepEqual(attempts.map((attempt) => attempt.provider), ["zero-x-swap"]);
}

void proveGaslessIsNotDispatched().then(() => {
  console.info("VNext curation-independent 0x execution eligibility smoke passed");
}).catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
