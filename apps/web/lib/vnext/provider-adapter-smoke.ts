import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, keccak256 } from "viem";
import {
  prepareVNextProviderAuthorization,
  quoteVNextExecutionProviders,
  verifyVNextExecutionProvider,
  type VNextProviderQuoteRequest,
  type VNextQuoteProviderAdapter
} from "../server/vnext-provider-adapter";

const inputAsset = getAddress("0x1111111111111111111111111111111111111111");
const outputAsset = getAddress("0x2222222222222222222222222222222222222222");
const recipient = getAddress("0x3333333333333333333333333333333333333333");
const request: VNextProviderQuoteRequest = {
  chainId: 4_663, inputAsset, outputAsset, inputAmountAtomic: "1000000", amountIn: 1_000_000n,
  recipient,
  inputIdentity: { address: inputAsset, symbol: "IN", decimals: 6 },
  outputIdentity: { address: outputAsset, symbol: "OUT", decimals: 18 }
};
const readyAdapter: VNextQuoteProviderAdapter = {
  provider: "sushi", providerLabel: "Sushi", providerFamily: "sushi", adapterVersion: 1, executionKind: "aggregator",
  capabilities: { strictVerification: false, walletAuthorization: false },
  async quote(input) {
    const now = Date.now();
    return {
      provider: "sushi", providerLabel: "Sushi", providerFamily: "sushi", adapterVersion: 1, status: "indicative", chainId: 4_663,
      inputAsset: input.inputAsset, outputAsset: input.outputAsset, inputAmountAtomic: input.inputAmountAtomic,
      expectedOutputAtomic: "1000", protectedOutputAtomic: "990", outputDecimals: 18, priceImpact: 0.01,
      liquidityFeeEvidence: [],
      quotedAtMs: now, expiresAtMs: now + 30_000, latencyMs: 1, executionKind: "aggregator",
      strictVerificationAvailable: false,
      userPaysGas: true, providerFeeAsset: null, providerFeeAtomic: null,
      gasSponsorshipFeeAsset: null, gasSponsorshipFeeAtomic: null,
      explicitProviderFeeOutputAtomic: null, rmtFeeOutputAtomic: "0",
      networkFeeNativeAtomic: null, networkFeeNativeSymbol: "ETH", protectedNetOutputAtomic: null,
      costState: "network_fee_pending", authorizationReady: false, detail: "Test-only normalized provider observation."
    };
  }
};
const unavailableAdapter: VNextQuoteProviderAdapter = {
  provider: "uniswap-v3", providerLabel: "Uniswap v3", providerFamily: "uniswap", adapterVersion: 1, executionKind: "direct_amm",
  capabilities: { strictVerification: true, walletAuthorization: true },
  async quote() { throw new Error("provider failed"); }
};
async function run() {
const attempts = await quoteVNextExecutionProviders(request, [readyAdapter, unavailableAdapter]);
assert.equal(attempts[0].status, "indicative");
assert.equal(attempts[1].status, "temporarily_unavailable");
assert.equal(attempts[1].expectedOutputAtomic, null);
await assert.rejects(() => quoteVNextExecutionProviders(request, []), /invalid provider adapter registry/);
await assert.rejects(() => quoteVNextExecutionProviders(request, [readyAdapter, readyAdapter]), /invalid provider adapter registry/);
await assert.rejects(() => quoteVNextExecutionProviders({ ...request, amountIn: 999n }, [readyAdapter]), /inconsistent provider quote request/);
await assert.rejects(() => quoteVNextExecutionProviders({ ...request, outputAsset: inputAsset }, [readyAdapter]), /assets must differ/);
await assert.rejects(() => verifyVNextExecutionProvider("sushi", { ...request, indicativeProtectedOutputFloorAtomic: 990n }, [readyAdapter]), /strict verification is not available/);

const actionData = "0x1234" as const;
const actionHash = keccak256(actionData);
const deadlineSeconds = BigInt(Math.floor(Date.now() / 1_000) + 300);
const executableAdapter: VNextQuoteProviderAdapter = {
  ...unavailableAdapter,
  capabilities: { strictVerification: true, walletAuthorization: true },
  async verify(input) {
    return {
      provider: "uniswap-v3", status: "verified", chainId: 4_663,
      inputAsset: input.inputAsset, outputAsset: input.outputAsset, inputAmountAtomic: input.inputAmountAtomic,
      indicativeProtectedOutputFloorAtomic: input.indicativeProtectedOutputFloorAtomic.toString(),
      protectedOutputAtomic: "990", recipient: input.recipient, router: recipient, approvalSpender: recipient,
      deadline: deadlineSeconds.toString(), calldataHash: actionHash, nextAction: "swap",
      nextActionTarget: recipient, nextActionCalldataHash: actionHash, transactionValueAtomic: "0", gasLimitUnits: "120000",
      estimatedNetworkCostUsdgAtomic: null, networkCostValuationSource: null,
      networkCostValuedAtMs: null, networkCostValuationExpiresAtMs: null
    };
  },
  async prepareAuthorization(input) {
    return {
      evidence: await this.verify!(input),
      transaction: { kind: "swap", target: recipient, data: actionData, value: "0", gasLimit: "120000" }
    };
  }
};
const prepared = await prepareVNextProviderAuthorization("uniswap-v3", {
  ...request, deadlineSeconds, indicativeProtectedOutputFloorAtomic: 980n, protectedOutputFloorAtomic: 990n, nowMs: Date.now()
}, [executableAdapter]);
assert.equal(prepared.transaction.data, actionData);
await assert.rejects(() => verifyVNextExecutionProvider("uniswap-v3", {
  ...request, indicativeProtectedOutputFloorAtomic: 0n
}, [executableAdapter]), /invalid indicative protected-output floor/);
await assert.rejects(() => prepareVNextProviderAuthorization("uniswap-v3", {
  ...request, deadlineSeconds, indicativeProtectedOutputFloorAtomic: 980n, protectedOutputFloorAtomic: 0n, nowMs: Date.now()
}, [executableAdapter]), /invalid protected output floor/);
await assert.rejects(() => prepareVNextProviderAuthorization("uniswap-v3", {
  ...request, deadlineSeconds, indicativeProtectedOutputFloorAtomic: 991n, protectedOutputFloorAtomic: 990n, nowMs: Date.now()
}, [executableAdapter]), /invalid protected output floor/);
const tamperedAdapter: VNextQuoteProviderAdapter = {
  ...executableAdapter,
  async prepareAuthorization(input) {
    const valid = await executableAdapter.prepareAuthorization!(input);
    return { ...valid, transaction: { ...valid.transaction, data: "0x5678" } };
  }
};
await assert.rejects(() => prepareVNextProviderAuthorization("uniswap-v3", {
  ...request, deadlineSeconds, indicativeProtectedOutputFloorAtomic: 980n, protectedOutputFloorAtomic: 990n, nowMs: Date.now()
}, [tamperedAdapter]), /invalid Uniswap v3 wallet request/);

const route = readFileSync(new URL("../../app/api/vnext/quotes/route.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../server/vnext-execution-engine.ts", import.meta.url), "utf8");
const boundary = readFileSync(new URL("../server/vnext-provider-adapter.ts", import.meta.url), "utf8");
assert.match(route, /requireAuthenticatedTradeWallet/);
assert.match(route, /readVNextVerifiedAssetIdentity/);
assert.match(route, /quoteRobinhoodVNextExecution/);
assert.match(registry, /vNextSushiAdapter/);
assert.match(registry, /vNextUniswapV3Adapter/);
assert.match(registry, /configuredVNextUniswapXAdapters/);
assert.match(registry, /configuredVNextZeroXAdapters/);
assert.match(registry, /configuredVNextUpAdapters/);
assert.match(boundary, /assertVNextQuoteAttempt/);
assert.match(boundary, /adapters\.length === 0 \|\| adapters\.length > 8/);
assert.match(boundary, /authorizationReady: false/);
assert.doesNotMatch(route, /writeContract|sendTransaction|signTypedData|calldata|database|firestore/);
assert.doesNotMatch(boundary, /writeContract|sendTransaction|signTypedData|database|firestore/);

console.log("RMT VNext provider-adapter execution engine smoke checks passed.");
}

void run().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
