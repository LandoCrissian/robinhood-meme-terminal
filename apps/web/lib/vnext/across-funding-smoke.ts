import assert from "node:assert/strict";
import { encodeFunctionData, getAddress, keccak256 } from "viem";
import {
  ACROSS_SPOKE_POOLS,
  acrossFundingConfiguration,
  acrossFundingOperationalState,
  evaluateAcrossFundingWalletReadiness,
  trustedAcrossFundingPair,
  verifyAcrossFundingQuoteResponse,
  type AcrossFundingConfiguration,
  type AcrossFundingRequest
} from "../server/vnext-across-funding";
import { acrossDedicatedRpcConfigured, acrossRpcEndpoint, acrossRpcHeaders } from "../server/vnext-across-rpc";
import {
  BASE_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID,
  TRUSTED_ASSET_ADDRESSES
} from "./trusted-asset-registry";

const depositV3Abi = [{
  type: "function",
  name: "depositV3",
  stateMutability: "payable",
  inputs: [
    { name: "depositor", type: "address" }, { name: "recipient", type: "address" },
    { name: "inputToken", type: "address" }, { name: "outputToken", type: "address" },
    { name: "inputAmount", type: "uint256" }, { name: "outputAmount", type: "uint256" },
    { name: "destinationChainId", type: "uint256" }, { name: "exclusiveRelayer", type: "address" },
    { name: "quoteTimestamp", type: "uint32" }, { name: "fillDeadline", type: "uint32" },
    { name: "exclusivityParameter", type: "uint32" }, { name: "message", type: "bytes" }
  ],
  outputs: []
}] as const;
const approvalAbi = [{
  type: "function", name: "approve", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }]
}] as const;

const nowMs = 1_786_400_000_000;
const nowSeconds = Math.floor(nowMs / 1_000);
const wallet = getAddress("0x1111111111111111111111111111111111111111");
const relayer = getAddress("0x2222222222222222222222222222222222222222");
const sourceToken = TRUSTED_ASSET_ADDRESSES.BASE_USDC;
const destinationToken = TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG;
const sourceSpokePool = ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID];
const runtimeCode = "0x60006000556001600055" as const;

assert.deepEqual(evaluateAcrossFundingWalletReadiness({
  sourceBalanceAtomic: "5000000",
  nativeGasBalanceAtomic: "1",
  requestedInputAtomic: "5000000"
}), {
  sourceBalanceAtomic: "5000000",
  nativeGasBalanceAtomic: "1",
  requestedInputAtomic: "5000000",
  sufficientSourceBalance: true,
  hasNativeGas: true,
  fundedPreflightReady: true
});
assert.equal(evaluateAcrossFundingWalletReadiness({
  sourceBalanceAtomic: "0",
  nativeGasBalanceAtomic: "1",
  requestedInputAtomic: "5000000"
}).fundedPreflightReady, false, "an empty Base USDC balance must stop before a provider quote or wallet prompt");
assert.equal(evaluateAcrossFundingWalletReadiness({
  sourceBalanceAtomic: "5000000",
  nativeGasBalanceAtomic: "0",
  requestedInputAtomic: "5000000"
}).fundedPreflightReady, false, "a source wallet without native gas is not transaction-ready");
assert.throws(() => evaluateAcrossFundingWalletReadiness({
  sourceBalanceAtomic: "5.0",
  nativeGasBalanceAtomic: "1",
  requestedInputAtomic: "5000000"
}), /malformed source funding balances/);
const runtimeHash = keccak256(runtimeCode);
const implementationCode = "0x60016000556002600055" as const;
const implementationHash = keccak256(implementationCode);
const implementationAddress = getAddress("0x3333333333333333333333333333333333333333");
const observedDeployment = {
  proxyRuntimeCode: runtimeCode,
  implementationAddress,
  implementationRuntimeCode: implementationCode
};
const integratorId = "0xbeef" as const;
const request: AcrossFundingRequest = {
  sourceChainId: BASE_MAINNET_CHAIN_ID,
  sourceToken,
  inputAmountAtomic: "10000000",
  depositor: wallet,
  recipient: wallet,
  requestedAtMs: nowMs
};
const configuration: AcrossFundingConfiguration = {
  apiKey: "test-only",
  integratorId,
  deployments: {
    1: { proxyRuntimeHash: runtimeHash, implementationAddress, implementationRuntimeHash: implementationHash },
    42161: { proxyRuntimeHash: runtimeHash, implementationAddress, implementationRuntimeHash: implementationHash },
    8453: { proxyRuntimeHash: runtimeHash, implementationAddress, implementationRuntimeHash: implementationHash },
    4663: { proxyRuntimeHash: runtimeHash, implementationAddress, implementationRuntimeHash: implementationHash }
  }
};

function depositData(overrides: Partial<{
  depositor: typeof wallet;
  recipient: typeof wallet;
  inputToken: typeof sourceToken;
  outputToken: typeof destinationToken;
  inputAmount: bigint;
  outputAmount: bigint;
  destinationChainId: bigint;
  quoteTimestamp: number;
  fillDeadline: number;
  message: `0x${string}`;
}> = {}) {
  return encodeFunctionData({
    abi: depositV3Abi,
    functionName: "depositV3",
    args: [
      overrides.depositor ?? wallet,
      overrides.recipient ?? wallet,
      overrides.inputToken ?? sourceToken,
      overrides.outputToken ?? destinationToken,
      overrides.inputAmount ?? 10_000_000n,
      overrides.outputAmount ?? 9_990_000n,
      overrides.destinationChainId ?? 4_663n,
      relayer,
      overrides.quoteTimestamp ?? nowSeconds - 10,
      overrides.fillDeadline ?? nowSeconds + 3_600,
      120,
      overrides.message ?? "0x"
    ]
  });
}

function body(data = depositData()) {
  return {
    crossSwapType: "bridgeableToBridgeable",
    amountType: "exactInput",
    checks: {
      allowance: { token: sourceToken, spender: sourceSpokePool, actual: "0", expected: request.inputAmountAtomic },
      balance: { token: sourceToken, actual: "50000000", expected: request.inputAmountAtomic }
    },
    steps: {
      bridge: {
        inputAmount: request.inputAmountAtomic,
        outputAmount: "9990000",
        tokenIn: { address: sourceToken, decimals: 6, symbol: "USDC", chainId: BASE_MAINNET_CHAIN_ID },
        tokenOut: { address: destinationToken, decimals: 6, symbol: "USDG", chainId: ROBINHOOD_MAINNET_CHAIN_ID },
        fees: { amount: "10000" },
        provider: "across"
      }
    },
    inputToken: { address: sourceToken, decimals: 6, symbol: "USDC", name: "USD Coin", chainId: BASE_MAINNET_CHAIN_ID },
    outputToken: { address: destinationToken, decimals: 6, symbol: "USDG", name: "Global Dollar", chainId: ROBINHOOD_MAINNET_CHAIN_ID },
    refundToken: { address: sourceToken, decimals: 6, symbol: "USDC", name: "USD Coin", chainId: BASE_MAINNET_CHAIN_ID },
    fees: {
      total: {
        amount: "10000",
        token: { address: sourceToken, decimals: 6, symbol: "USDC", chainId: BASE_MAINNET_CHAIN_ID },
        details: { app: { amount: "0" } }
      },
      originGas: { amount: "1000000000000", token: { address: "0x0000000000000000000000000000000000000000", decimals: 18, symbol: "ETH", chainId: BASE_MAINNET_CHAIN_ID } }
    },
    inputAmount: request.inputAmountAtomic,
    maxInputAmount: request.inputAmountAtomic,
    expectedOutputAmount: "9995000",
    minOutputAmount: "9990000",
    expectedFillTime: 2,
    approvalTxns: [{
      chainId: BASE_MAINNET_CHAIN_ID,
      to: sourceToken,
      data: encodeFunctionData({ abi: approvalAbi, functionName: "approve", args: [sourceSpokePool, (1n << 256n) - 1n] })
    }],
    swapTx: {
      simulationSuccess: true,
      chainId: BASE_MAINNET_CHAIN_ID,
      to: sourceSpokePool,
      data,
      value: "0",
      gas: "210000"
    },
    quoteExpiryTimestamp: nowSeconds + 60,
    id: "across-test-quote-0001"
  };
}

const prepared = verifyAcrossFundingQuoteResponse({
  body: body(), request, configuration, observedSourceDeployment: observedDeployment, observedDestinationDeployment: observedDeployment, nowMs
});
assert.equal(prepared.evidence.kind, "cross_chain_funding");
assert.equal(prepared.evidence.settlementMode, "asynchronous_fill");
assert.equal(prepared.evidence.destinationChainId, 4663);
assert.equal(prepared.evidence.destinationToken, destinationToken);
assert.equal(prepared.evidence.recipient, wallet);
assert.equal(prepared.evidence.refundRecipient, wallet);
assert.equal(prepared.evidence.refundChainId, BASE_MAINNET_CHAIN_ID);
assert.equal(prepared.evidence.refundToken, sourceToken);
assert.equal(prepared.evidence.refundOnOrigin, true);
assert.equal(prepared.evidence.partialFillsAllowed, false);
assert.equal(prepared.evidence.message, "0x");
assert.equal(prepared.evidence.unexpectedDestinationCall, false);
assert.equal(prepared.evidence.serverSubmissionEnabled, false);
assert.equal(prepared.approvalRequired, true);
assert.ok(prepared.approvalTransaction);
assert.notEqual(prepared.approvalTransaction?.data, body().approvalTxns[0]?.data, "RMT must replace broad provider approval with an exact approval");
assert.equal(prepared.depositTransaction.data, body().swapTx.data);

const swapApiMarkedData = `${depositData()}1dc0de${integratorId.slice(2)}73c0de` as const;
assert.equal(verifyAcrossFundingQuoteResponse({
  body: body(swapApiMarkedData), request, configuration,
  observedSourceDeployment: observedDeployment,
  observedDestinationDeployment: observedDeployment,
  nowMs
}).depositTransaction.data, swapApiMarkedData);
{
  const value = body(`${depositData()}1dc0de${integratorId.slice(2)}73c0deff` as const);
  assert.throws(() => verifyAcrossFundingQuoteResponse({
    body: value, request, configuration,
    observedSourceDeployment: observedDeployment,
    observedDestinationDeployment: observedDeployment,
    nowMs
  }), /appended unknown data|could not decode|non-canonical/);
}

const sufficientAllowance = body();
sufficientAllowance.checks.allowance.actual = request.inputAmountAtomic;
delete (sufficientAllowance as { approvalTxns?: unknown }).approvalTxns;
assert.equal(verifyAcrossFundingQuoteResponse({
  body: sufficientAllowance, request, configuration, observedSourceDeployment: observedDeployment, observedDestinationDeployment: observedDeployment, nowMs
}).approvalTransaction, null);

function reject(mutate: (value: ReturnType<typeof body>) => void, pattern: RegExp) {
  const value = body();
  mutate(value);
  assert.throws(() => verifyAcrossFundingQuoteResponse({
    body: value, request, configuration, observedSourceDeployment: observedDeployment, observedDestinationDeployment: observedDeployment, nowMs
  }), pattern);
}

reject((value) => { value.outputToken.address = sourceToken; }, /chain-qualified asset identity/);
reject((value) => { (value.outputToken as { chainId: number }).chainId = BASE_MAINNET_CHAIN_ID; }, /chain-qualified asset identity/);
reject((value) => { value.steps.bridge.outputAmount = "9989999"; }, /direct funding bridge leg/);
reject((value) => { Object.assign(value.steps, { destinationSwap: { target: wallet } }); }, /unexpected origin or destination call/);
reject((value) => { value.swapTx.to = wallet; }, /source transaction envelope/);
reject((value) => { value.swapTx.data = depositData({ recipient: relayer as typeof wallet }); }, /funding intent/);
reject((value) => { value.swapTx.data = depositData({ destinationChainId: 1n }); }, /funding intent/);
reject((value) => { value.swapTx.data = depositData({ outputToken: sourceToken as typeof destinationToken }); }, /funding intent/);
reject((value) => { value.swapTx.data = depositData({ inputAmount: 9_999_999n }); }, /funding intent/);
reject((value) => { value.swapTx.data = depositData({ outputAmount: 9_989_999n }); }, /funding intent/);
reject((value) => { value.swapTx.data = depositData({ quoteTimestamp: nowSeconds - 601 }); }, /funding intent/);
reject((value) => { value.swapTx.data = depositData({ fillDeadline: nowSeconds - 1 }); }, /funding intent/);
reject((value) => { value.swapTx.data = depositData({ message: "0x1234" }); }, /funding intent/);
reject((value) => { value.refundToken.address = destinationToken; }, /chain-qualified asset identity/);
reject((value) => { value.fees.total.details.app.amount = "1"; }, /application fee/);
reject((value) => { value.crossSwapType = "anyToBridgeable"; }, /unexpected swap leg/);
reject((value) => { value.approvalTxns[0]!.to = wallet; }, /invalid approval transaction/);
reject((value) => { value.checks.balance.actual = "0"; }, /allowance or balance/);

assert.throws(() => verifyAcrossFundingQuoteResponse({
  body: null, request, configuration, observedSourceDeployment: observedDeployment, observedDestinationDeployment: observedDeployment, nowMs
}), /invalid quote response/);

assert.throws(() => verifyAcrossFundingQuoteResponse({
  body: body(), request, configuration,
  observedSourceDeployment: { ...observedDeployment, proxyRuntimeCode: "0x6001" },
  observedDestinationDeployment: observedDeployment,
  nowMs
}), /proxy or implementation is not approved/);
assert.throws(() => verifyAcrossFundingQuoteResponse({
  body: body(), request, configuration,
  observedSourceDeployment: { ...observedDeployment, implementationAddress: wallet },
  observedDestinationDeployment: observedDeployment,
  nowMs
}), /proxy or implementation is not approved/);

assert.equal(trustedAcrossFundingPair(BASE_MAINNET_CHAIN_ID, sourceToken)?.output.symbol, "USDG");
assert.equal(trustedAcrossFundingPair(BASE_MAINNET_CHAIN_ID, wallet), null);

const deploymentEnvironment = {
  NODE_ENV: "test",
  RMT_ACROSS_API_KEY: "key",
  RMT_ACROSS_INTEGRATOR_ID: integratorId,
  RMT_ETHEREUM_RPC_URL: "https://ethereum.rpc.example",
  RMT_ETHEREUM_RPC_AUTH_TOKEN: "ethereum-token",
  RMT_ARBITRUM_RPC_URL: "https://arbitrum.rpc.example",
  RMT_ARBITRUM_RPC_AUTH_TOKEN: "arbitrum-token",
  RMT_BASE_RPC_URL: "https://base.rpc.example",
  RMT_BASE_RPC_AUTH_TOKEN: "base-token",
  RMT_ACROSS_ROBINHOOD_RPC_URL: "https://robinhood.rpc.example",
  RMT_ACROSS_ROBINHOOD_RPC_AUTH_TOKEN: "robinhood-token",
  FIREBASE_ADMIN_PROJECT_ID: "rmt-live",
  FIREBASE_ADMIN_CLIENT_EMAIL: "rmt@rmt-live.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  ...Object.fromEntries(["ETHEREUM", "ARBITRUM", "BASE", "ROBINHOOD"].flatMap((chain) => [
    [`RMT_ACROSS_${chain}_SPOKE_POOL_PROXY_CODE_HASH`, runtimeHash],
    [`RMT_ACROSS_${chain}_SPOKE_POOL_IMPLEMENTATION_ADDRESS`, implementationAddress],
    [`RMT_ACROSS_${chain}_SPOKE_POOL_IMPLEMENTATION_CODE_HASH`, implementationHash]
  ]))
} as unknown as NodeJS.ProcessEnv;
const disabled = acrossFundingOperationalState(deploymentEnvironment);
assert.equal(acrossDedicatedRpcConfigured(deploymentEnvironment), true);
assert.equal(acrossRpcEndpoint(BASE_MAINNET_CHAIN_ID, deploymentEnvironment), "https://base.rpc.example");
assert.equal(acrossRpcHeaders(BASE_MAINNET_CHAIN_ID, deploymentEnvironment).Authorization, "Bearer base-token");
assert.equal(disabled.configured, true);
assert.equal(disabled.credentialsConfigured, true);
assert.equal(disabled.deploymentPinsConfigured, true);
assert.equal(disabled.rpcConfigured, true);
assert.equal(disabled.persistenceConfigured, true);
assert.equal(disabled.quotingEnabled, false);
assert.equal(disabled.authorizationEnabled, false);
assert.equal(disabled.trackingEnabled, true);
assert.equal(disabled.publicAssetSelectionEnabled, false);
const quoteKillSwitch = acrossFundingOperationalState({
  ...deploymentEnvironment,
  RMT_VNEXT_ACROSS_FUNDING_AUTHORIZATION_ENABLED: "true"
} as NodeJS.ProcessEnv);
assert.equal(quoteKillSwitch.authorizationEnabled, false);
assert.equal(quoteKillSwitch.trackingEnabled, true);
const missingRecoveryDependency = acrossFundingOperationalState({
  ...deploymentEnvironment,
  FIREBASE_ADMIN_PRIVATE_KEY: ""
} as NodeJS.ProcessEnv);
assert.equal(missingRecoveryDependency.credentialsConfigured, true);
assert.equal(missingRecoveryDependency.deploymentPinsConfigured, true);
assert.equal(missingRecoveryDependency.persistenceConfigured, false);
assert.equal(missingRecoveryDependency.configured, false);
assert.equal(missingRecoveryDependency.trackingEnabled, false);
const missingRpcCredential = {
  ...deploymentEnvironment,
  RMT_BASE_RPC_AUTH_TOKEN: ""
} as NodeJS.ProcessEnv;
assert.equal(acrossDedicatedRpcConfigured(missingRpcCredential), false);
assert.equal(acrossFundingOperationalState(missingRpcCredential).configured, false);
assert.equal(acrossFundingConfiguration({} as NodeJS.ProcessEnv), null);

console.log("RMT Across funding adapter and strict quote-verifier smoke checks passed.");
