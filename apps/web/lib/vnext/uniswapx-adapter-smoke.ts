import assert from "node:assert/strict";
import { getAddress, zeroAddress } from "viem";
import { configuredVNextUniswapXAdapters, prepareVNextUniswapXIntent, vNextUniswapXAdapter } from "../server/vnext-uniswapx-adapter";
import { UniswapXV3OrderVerificationError, verifyUniswapXV3Order } from "../server/vnext-uniswapx-order-verifier";
import type { VNextProviderQuoteRequest } from "../server/vnext-provider-adapter";

const originalFetch = globalThis.fetch;
const originalKey = process.env.RMT_UNISWAP_API_KEY;
const originalGate = process.env.RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED;
const inputAsset = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const outputAsset = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const recipient = getAddress("0x0000000000000000000000000000000000010000");
const reactor = getAddress("0x000000007A1C8e570011EeDF86A2A35593013cBA");
const permit2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
const cosigner = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const orderId = "0x4750ad8888ab082961b3484656a5b47b47ab7e70e40f4c4f76948bd2086e4bc5";
// Deterministic Dutch V3 fixture generated with the official UniswapX SDK.
// Runtime code does not depend on that SDK because its ethers v5 dependency
// currently carries an unpatched elliptic advisory.
const encodedOrder = "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000000000000001c0000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000004a00000000000000000000000000000000000000000000000000000000000000580000000000000000000000000000000007a1c8e570011eedf86a2a35593013cba000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000070000000000000000000000000000000000000000000000000000000077359400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d168000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00010000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000bd7d308f8e1639fab988df18a8011f41eacad730000000000000000000000000000000000000000000000000737693eb334000000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000724efdf5a5f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a00010000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012795f58d50000000000000000000000000000000000000000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041620e3967cd982a1a7d98d1429c9e743ead37bddb18711c0df487ca5011795ad3369949f16a34d01f17b8e6094365c55b41d2fce9f85d449e78b7afd472463a6b1c00000000000000000000000000000000000000000000000000000000000000";
const request: VNextProviderQuoteRequest = {
  chainId: 4_663,
  inputAsset,
  outputAsset,
  inputAmountAtomic: "1000000000",
  amountIn: 1_000_000_000n,
  recipient,
  inputIdentity: { address: inputAsset, symbol: "USDG", decimals: 6 },
  outputIdentity: { address: outputAsset, symbol: "WETH", decimals: 18 }
};

function fixturePermitData() {
  const orderInfo = {
    reactor,
    swapper: recipient,
    nonce: "7",
    deadline: "2000000000",
    additionalValidationContract: zeroAddress,
    additionalValidationData: "0x"
  };
  const curve = { relativeBlocks: "655361", relativeAmounts: ["0", "0"] };
  const baseInput = {
    token: inputAsset,
    startAmount: request.inputAmountAtomic,
    curve,
    maxAmount: request.inputAmountAtomic,
    adjustmentPerGweiBaseFee: "0"
  };
  const baseOutputs = [{
    token: outputAsset,
    startAmount: "520000000000000000",
    curve: { relativeBlocks: "655361", relativeAmounts: ["0", "5200000000000000"] },
    recipient,
    minAmount: "514800000000000000",
    adjustmentPerGweiBaseFee: "0"
  }];
  return {
    domain: { name: "Permit2", chainId: 4_663, verifyingContract: permit2 },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "V3DutchOrder" }
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      V3DutchOrder: [
        { name: "info", type: "OrderInfo" },
        { name: "cosigner", type: "address" },
        { name: "startingBaseFee", type: "uint256" },
        { name: "baseInput", type: "V3DutchInput" },
        { name: "baseOutputs", type: "V3DutchOutput[]" }
      ],
      OrderInfo: [
        { name: "reactor", type: "address" },
        { name: "swapper", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "additionalValidationContract", type: "address" },
        { name: "additionalValidationData", type: "bytes" }
      ],
      V3DutchInput: [
        { name: "token", type: "address" },
        { name: "startAmount", type: "uint256" },
        { name: "curve", type: "NonlinearDutchDecay" },
        { name: "maxAmount", type: "uint256" },
        { name: "adjustmentPerGweiBaseFee", type: "uint256" }
      ],
      V3DutchOutput: [
        { name: "token", type: "address" },
        { name: "startAmount", type: "uint256" },
        { name: "curve", type: "NonlinearDutchDecay" },
        { name: "recipient", type: "address" },
        { name: "minAmount", type: "uint256" },
        { name: "adjustmentPerGweiBaseFee", type: "uint256" }
      ],
      NonlinearDutchDecay: [
        { name: "relativeBlocks", type: "uint256" },
        { name: "relativeAmounts", type: "int256[]" }
      ]
    },
    values: {
      permitted: { token: inputAsset, amount: request.inputAmountAtomic },
      spender: reactor,
      nonce: "7",
      deadline: "2000000000",
      witness: { info: orderInfo, cosigner, startingBaseFee: "100000000", baseInput, baseOutputs }
    }
  };
}

function quoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    routing: "DUTCH_V3",
    quote: {
      input: { token: inputAsset.toLowerCase(), amount: request.inputAmountAtomic, maximumAmount: request.inputAmountAtomic },
      output: { token: outputAsset.toLowerCase(), amount: "520000000000000000", minimumAmount: "514800000000000000", recipient },
      orderInfo: { chainId: 4_663, swapper: recipient, reactor },
      portionBips: 0,
      portionAmount: "0",
      orderId,
      encodedOrder,
      ...overrides
    },
    permitData: fixturePermitData()
  };
}

async function run() {
  const verifiedFixture = await verifyUniswapXV3Order({
    encodedOrder,
    request,
    expectedOutputAtomic: "520000000000000000",
    protectedOutputAtomic: "514800000000000000",
    orderId,
    permitData: fixturePermitData(),
    nowSeconds: 1_900_000_000
  });
  assert.equal(verifiedFixture.orderHash, "0x4750ad8888ab082961b3484656a5b47b47ab7e70e40f4c4f76948bd2086e4bc5");
  assert.equal(verifiedFixture.cosigner, getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"));
  assert.equal(verifiedFixture.deadline, 2_000_000_000n);
  await assert.rejects(
    verifyUniswapXV3Order({
      encodedOrder,
      request: { ...request, recipient: inputAsset },
      expectedOutputAtomic: "520000000000000000",
      protectedOutputAtomic: "514800000000000000",
      orderId,
      permitData: fixturePermitData(),
      nowSeconds: 1_900_000_000
    }),
    UniswapXV3OrderVerificationError
  );
  await assert.rejects(
    verifyUniswapXV3Order({
      encodedOrder: encodedOrder.replace("620e3967", "630e3967"),
      request,
      expectedOutputAtomic: "520000000000000000",
      protectedOutputAtomic: "514800000000000000",
      orderId,
      permitData: fixturePermitData(),
      nowSeconds: 1_900_000_000
    }),
    UniswapXV3OrderVerificationError
  );

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
      protocols: ["UNISWAPX_V3"]
    });
    return Response.json(quoteResponse());
  };

  const preparedIntent = await prepareVNextUniswapXIntent(request, 514_800_000_000_000_000n);
  assert.equal(preparedIntent.provider, "uniswapx");
  assert.equal(preparedIntent.orderId, orderId);
  assert.equal(preparedIntent.deadline, "2000000000");
  assert.equal(preparedIntent.permit2, permit2);
  assert.equal(preparedIntent.reactor, reactor);
  assert.deepEqual(preparedIntent.permitData.domain, { name: "Permit2", chainId: 4_663, verifyingContract: permit2 });
  assert.equal(preparedIntent.permitData.primaryType, "PermitWitnessTransferFrom");
  assert.equal(preparedIntent.permitData.message.permitted.amount, request.inputAmountAtomic);
  assert.equal(preparedIntent.permitData.message.spender, reactor);
  assert.equal(preparedIntent.permitData.message.witness.info.swapper, recipient);
  assert.equal(preparedIntent.permitPayloadHash, "0xd6c8f587aef7a2d88ba46590a0e25f841f77f75d540024520f33b896e6b1de39");
  assert.equal(preparedIntent.submissionPayload.routing, "DUTCH_V3");
  assert.equal(preparedIntent.submissionPayload.quote.encodedOrder, encodedOrder);
  await assert.rejects(
    prepareVNextUniswapXIntent(request, 514_800_000_000_000_001n),
    /below the protected-output floor/
  );

  const ready = await vNextUniswapXAdapter.quote(request);
  assert.equal(ready.status, "indicative");
  assert.equal(ready.provider, "uniswapx");
  assert.equal(ready.providerFamily, "uniswapx");
  assert.equal(ready.executionKind, "rfq_intent");
  assert.equal(ready.expectedOutputAtomic, "520000000000000000");
  assert.equal(ready.protectedOutputAtomic, "514800000000000000");
  assert.equal(ready.protectedNetOutputAtomic, ready.protectedOutputAtomic);
  assert.equal(ready.userPaysGas, false);
  assert.equal(ready.gasSponsorshipFeeAtomic, null);
  assert.equal(ready.netEconomics?.rmtFee.state, "disabled");
  assert.equal(ready.netEconomics?.rmtFee.expectedFeeAtomic, "0");
  assert.equal(ready.strictVerificationAvailable, false);
  assert.equal(ready.authorizationReady, false);
  assert.equal("rawProviderQuote" in ready, false);
  assert.equal("encodedOrder" in ready, false);

  globalThis.fetch = async () => Response.json(quoteResponse({
    output: { token: inputAsset, amount: "520000000000000000", minimumAmount: "514800000000000000", recipient }
  }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json(quoteResponse({
    output: { token: outputAsset, amount: "520000000000000000", minimumAmount: "514800000000000000", recipient: inputAsset }
  }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json(quoteResponse({
    input: { token: inputAsset, amount: "999999999" }
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

  globalThis.fetch = async () => Response.json(quoteResponse({ encodedOrder: "0xdeadbeef" }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  globalThis.fetch = async () => Response.json(quoteResponse({ orderId: `0x${"11".repeat(32)}` }));
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  const wrongPermitDomain = fixturePermitData();
  wrongPermitDomain.domain.verifyingContract = inputAsset;
  globalThis.fetch = async () => Response.json({ ...quoteResponse(), permitData: wrongPermitDomain });
  assert.equal((await vNextUniswapXAdapter.quote(request)).status, "invalid_response");

  const wrongPermitAmount = fixturePermitData();
  wrongPermitAmount.values.permitted.amount = "999999999";
  globalThis.fetch = async () => Response.json({ ...quoteResponse(), permitData: wrongPermitAmount });
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
