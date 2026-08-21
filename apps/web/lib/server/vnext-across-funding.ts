import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  type Address,
  type Hex
} from "viem";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID,
  TRUSTED_ASSET_ADDRESSES,
  trustedPaymentAsset,
  trustedSettlementAsset,
  type TrustedAssetChainId
} from "../vnext/trusted-asset-registry";
import {
  ACROSS_EIP1967_IMPLEMENTATION_SLOT,
  ACROSS_FUNDING_DEPLOYMENT_V1,
  acrossReviewedDeploymentPins
} from "../vnext/across-funding-deployment";
import { hasRmtAdminConfiguration } from "./firebase-admin";
import { acrossDedicatedRpcConfigured, acrossRpcEndpoint, acrossRpcHeaders } from "./vnext-across-rpc";

const ACROSS_API_URL = "https://app.across.to/api";
const ACROSS_TIMEOUT_MS = 8_000;
const MAX_QUOTE_AGE_SECONDS = 10 * 60;
const MAX_QUOTE_LIFETIME_SECONDS = 6 * 60 * 60;
const INTEGRATOR_DELIMITER = "1dc0de";
const SWAP_API_CALLDATA_MARKER = "73c0de";

export const ACROSS_SPOKE_POOLS = {
  [ETHEREUM_MAINNET_CHAIN_ID]: ACROSS_FUNDING_DEPLOYMENT_V1[ETHEREUM_MAINNET_CHAIN_ID].proxyAddress,
  [ARBITRUM_MAINNET_CHAIN_ID]: ACROSS_FUNDING_DEPLOYMENT_V1[ARBITRUM_MAINNET_CHAIN_ID].proxyAddress,
  [BASE_MAINNET_CHAIN_ID]: ACROSS_FUNDING_DEPLOYMENT_V1[BASE_MAINNET_CHAIN_ID].proxyAddress,
  [ROBINHOOD_MAINNET_CHAIN_ID]: ACROSS_FUNDING_DEPLOYMENT_V1[ROBINHOOD_MAINNET_CHAIN_ID].proxyAddress
} as const;

export type AcrossFundingSourceChainId =
  | typeof ETHEREUM_MAINNET_CHAIN_ID
  | typeof ARBITRUM_MAINNET_CHAIN_ID
  | typeof BASE_MAINNET_CHAIN_ID;

export type AcrossFundingRequest = {
  sourceChainId: AcrossFundingSourceChainId;
  sourceToken: Address;
  inputAmountAtomic: string;
  depositor: Address;
  recipient: Address;
  requestedAtMs: number;
};

export type AcrossFundingEvidence = {
  schemaVersion: 1;
  provider: "across";
  kind: "cross_chain_funding";
  settlementMode: "asynchronous_fill";
  quoteId: string;
  sourceChainId: AcrossFundingSourceChainId;
  destinationChainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  sourceToken: Address;
  destinationToken: Address;
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  recipient: Address;
  depositor: Address;
  sourceSpokePool: Address;
  destinationSpokePool: Address;
  sourceSpokePoolRuntimeHash: Hex;
  sourceSpokePoolImplementation: Address;
  sourceSpokePoolImplementationRuntimeHash: Hex;
  destinationSpokePoolRuntimeHash: Hex;
  destinationSpokePoolImplementation: Address;
  destinationSpokePoolImplementationRuntimeHash: Hex;
  approvalSpender: Address;
  exactApprovalAmountAtomic: string;
  exclusiveRelayer: Address;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusivityParameter: number;
  message: "0x";
  refundRecipient: Address;
  refundChainId: AcrossFundingSourceChainId;
  refundToken: Address;
  refundOnOrigin: true;
  partialFillsAllowed: false;
  totalFeeAtomic: string;
  totalFeeAsset: Address;
  originGasAtomic: string | null;
  expectedCompletionSeconds: number;
  quoteExpiresAtMs: number;
  providerSimulationPassed: true;
  depositTarget: Address;
  depositCalldataHash: Hex;
  depositValueAtomic: "0";
  depositGasLimit: string;
  unexpectedDestinationCall: false;
  serverSubmissionEnabled: false;
};

export type AcrossFundingPreparedTransactions = {
  evidence: AcrossFundingEvidence;
  approvalRequired: boolean;
  approvalTransaction: {
    chainId: AcrossFundingSourceChainId;
    target: Address;
    data: Hex;
    value: "0";
  } | null;
  depositTransaction: {
    chainId: AcrossFundingSourceChainId;
    target: Address;
    data: Hex;
    value: "0";
    gasLimit: string;
  };
};

export type AcrossSpokePoolDeploymentPin = {
  proxyRuntimeHash: Hex;
  implementationAddress: Address;
  implementationRuntimeHash: Hex;
};

export type AcrossObservedSpokePoolDeployment = {
  proxyRuntimeCode: Hex;
  implementationAddress: Address;
  implementationRuntimeCode: Hex;
  observedBlockNumber?: string;
  observedBlockHash?: Hex;
};

type AcrossFundingConfiguration = {
  apiKey: string;
  integratorId: `0x${string}`;
  deployments: Record<AcrossFundingSourceChainId | typeof ROBINHOOD_MAINNET_CHAIN_ID, AcrossSpokePoolDeploymentPin>;
};

type JsonObject = Record<string, unknown>;

const depositAbi = [{
  type: "function",
  name: "deposit",
  stateMutability: "payable",
  inputs: [
    { name: "depositor", type: "bytes32" },
    { name: "recipient", type: "bytes32" },
    { name: "inputToken", type: "bytes32" },
    { name: "outputToken", type: "bytes32" },
    { name: "inputAmount", type: "uint256" },
    { name: "outputAmount", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "exclusiveRelayer", type: "bytes32" },
    { name: "quoteTimestamp", type: "uint32" },
    { name: "fillDeadline", type: "uint32" },
    { name: "exclusivityParameter", type: "uint32" },
    { name: "message", type: "bytes" }
  ],
  outputs: []
}, {
  type: "function",
  name: "depositV3",
  stateMutability: "payable",
  inputs: [
    { name: "depositor", type: "address" },
    { name: "recipient", type: "address" },
    { name: "inputToken", type: "address" },
    { name: "outputToken", type: "address" },
    { name: "inputAmount", type: "uint256" },
    { name: "outputAmount", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "exclusiveRelayer", type: "address" },
    { name: "quoteTimestamp", type: "uint32" },
    { name: "fillDeadline", type: "uint32" },
    { name: "exclusivityParameter", type: "uint32" },
    { name: "message", type: "bytes" }
  ],
  outputs: []
}] as const;

const approvalAbi = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }]
}] as const;

const erc20BalanceAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "balance", type: "uint256" }]
}] as const;

class AcrossInvalidResponseError extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveAtomic(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
}

function nonNegativeAtomic(value: unknown) {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? value : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function address(value: unknown) {
  return typeof value === "string" && isAddress(value, { strict: false }) ? getAddress(value) : null;
}

function tokenIdentity(value: unknown) {
  if (!isObject(value)) return null;
  const chainId = positiveInteger(value.chainId);
  const tokenAddress = address(value.address);
  const decimals = typeof value.decimals === "number" && Number.isSafeInteger(value.decimals) ? value.decimals : null;
  return chainId && tokenAddress && decimals !== null ? { chainId, address: tokenAddress, decimals } : null;
}

function addressFromBytes32(value: unknown) {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) return null;
  return getAddress(`0x${value.slice(-40)}`);
}

function expectedIntegratorSuffix(integratorId: `0x${string}`) {
  return `${INTEGRATOR_DELIMITER}${integratorId.slice(2).toLowerCase()}`;
}

function canonicalDepositCalldata(data: Hex, integratorId: `0x${string}`) {
  const suffix = expectedIntegratorSuffix(integratorId);
  let canonical = data;
  if (canonical.toLowerCase().endsWith(SWAP_API_CALLDATA_MARKER)) {
    canonical = `0x${canonical.slice(2, -SWAP_API_CALLDATA_MARKER.length)}` as Hex;
  }
  if (canonical.toLowerCase().endsWith(suffix)) {
    canonical = `0x${canonical.slice(2, -suffix.length)}` as Hex;
  }
  return canonical;
}

function decodedDeposit(data: Hex, integratorId: `0x${string}`) {
  const canonical = canonicalDepositCalldata(data, integratorId);
  let decoded: ReturnType<typeof decodeFunctionData<typeof depositAbi>>;
  try {
    decoded = decodeFunctionData({ abi: depositAbi, data: canonical });
  } catch {
    throw new AcrossInvalidResponseError("Across returned deposit calldata that RMT could not decode.");
  }
  if (!decoded.args || (decoded.functionName !== "deposit" && decoded.functionName !== "depositV3")) {
    throw new AcrossInvalidResponseError("Across returned an unsupported source transaction.");
  }
  const args = decoded.args;
  const bytes32 = decoded.functionName === "deposit";
  const parsed = {
    depositor: bytes32 ? addressFromBytes32(args[0]) : getAddress(args[0] as Address),
    recipient: bytes32 ? addressFromBytes32(args[1]) : getAddress(args[1] as Address),
    inputToken: bytes32 ? addressFromBytes32(args[2]) : getAddress(args[2] as Address),
    outputToken: bytes32 ? addressFromBytes32(args[3]) : getAddress(args[3] as Address),
    inputAmount: args[4] as bigint,
    outputAmount: args[5] as bigint,
    destinationChainId: args[6] as bigint,
    exclusiveRelayer: bytes32 ? addressFromBytes32(args[7]) : getAddress(args[7] as Address),
    quoteTimestamp: Number(args[8]),
    fillDeadline: Number(args[9]),
    exclusivityParameter: Number(args[10]),
    message: args[11] as Hex
  };
  if (!parsed.depositor || !parsed.recipient || !parsed.inputToken || !parsed.outputToken || !parsed.exclusiveRelayer) {
    throw new AcrossInvalidResponseError("Across returned non-EVM deposit identities.");
  }
  const encoded = encodeFunctionData({
    abi: depositAbi,
    functionName: decoded.functionName,
    args: args as never
  });
  if (encoded.toLowerCase() !== canonical.toLowerCase()) {
    throw new AcrossInvalidResponseError("Across returned non-canonical deposit calldata.");
  }
  const withIntegrator = `${encoded}${expectedIntegratorSuffix(integratorId)}`;
  const allowedFull = [
    encoded,
    withIntegrator,
    `${encoded}${SWAP_API_CALLDATA_MARKER}`,
    `${withIntegrator}${SWAP_API_CALLDATA_MARKER}`
  ].map((value) => value.toLowerCase());
  if (!allowedFull.includes(data.toLowerCase())) {
    throw new AcrossInvalidResponseError("Across appended unknown data to the deposit transaction.");
  }
  return parsed;
}

function acrossCredentialsConfigured(env: NodeJS.ProcessEnv) {
  return Boolean(env.RMT_ACROSS_API_KEY?.trim())
    && /^0x[0-9a-fA-F]{4}$/.test(env.RMT_ACROSS_INTEGRATOR_ID?.trim() ?? "");
}

function acrossDeploymentPins(env: NodeJS.ProcessEnv) {
  return acrossReviewedDeploymentPins(env);
}

export function acrossFundingConfiguration(env: NodeJS.ProcessEnv = process.env): AcrossFundingConfiguration | null {
  const apiKey = env.RMT_ACROSS_API_KEY?.trim() ?? "";
  const integratorId = env.RMT_ACROSS_INTEGRATOR_ID?.trim() ?? "";
  const deployments = acrossDeploymentPins(env);
  if (!acrossCredentialsConfigured(env) || !deployments) return null;
  return {
    apiKey,
    integratorId: integratorId.toLowerCase() as `0x${string}`,
    deployments
  };
}

export function acrossFundingOperationalState(env: NodeJS.ProcessEnv = process.env) {
  const credentialsConfigured = acrossCredentialsConfigured(env);
  const deploymentPinsConfigured = Boolean(acrossDeploymentPins(env));
  const rpcConfigured = acrossDedicatedRpcConfigured(env);
  const persistenceConfigured = hasRmtAdminConfiguration(env);
  const configured = credentialsConfigured && deploymentPinsConfigured && rpcConfigured && persistenceConfigured;
  const quotingEnabled = env.RMT_VNEXT_ACROSS_FUNDING_QUOTES_ENABLED === "true";
  const authorizationEnabled = env.RMT_VNEXT_ACROSS_FUNDING_AUTHORIZATION_ENABLED === "true";
  return {
    configured,
    credentialsConfigured,
    deploymentPinsConfigured,
    rpcConfigured,
    persistenceConfigured,
    quotingEnabled: configured && quotingEnabled,
    authorizationEnabled: configured && quotingEnabled && authorizationEnabled,
    trackingEnabled: Boolean(env.RMT_ACROSS_API_KEY?.trim()) && rpcConfigured && persistenceConfigured,
    publicAssetSelectionEnabled: false
  } as const;
}

function assertFundingRequest(request: AcrossFundingRequest) {
  const sourceAsset = trustedPaymentAsset(request.sourceChainId, request.sourceToken);
  const destinationAsset = trustedSettlementAsset(ROBINHOOD_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG);
  if (
    !sourceAsset || sourceAsset.symbol !== "USDC" || sourceAsset.issuer !== "Circle"
    || !destinationAsset || destinationAsset.symbol !== "USDG"
    || !/^[1-9][0-9]{0,77}$/.test(request.inputAmountAtomic)
    || !isAddress(request.depositor) || !isAddress(request.recipient)
    || getAddress(request.depositor) !== getAddress(request.recipient)
    || !Number.isSafeInteger(request.requestedAtMs) || request.requestedAtMs <= 0
  ) throw new Error("RMT rejected an unsupported Across funding intent.");
}

function parseProviderApprovalTransactions(
  value: unknown,
  sourceChainId: AcrossFundingSourceChainId,
  sourceToken: Address,
  spender: Address,
  inputAmountAtomic: string
) {
  if (value === undefined || value === null) return false;
  if (!Array.isArray(value) || value.length > 1) throw new AcrossInvalidResponseError("Across returned unexpected approval steps.");
  if (value.length === 0) return false;
  const tx = value[0];
  if (!isObject(tx) || tx.chainId !== sourceChainId || address(tx.to) !== sourceToken || typeof tx.data !== "string" || !isHex(tx.data)) {
    throw new AcrossInvalidResponseError("Across returned an invalid approval transaction.");
  }
  let decoded: ReturnType<typeof decodeFunctionData<typeof approvalAbi>>;
  try {
    decoded = decodeFunctionData({ abi: approvalAbi, data: tx.data as Hex });
  } catch {
    throw new AcrossInvalidResponseError("Across returned an approval RMT could not decode.");
  }
  if (decoded.functionName !== "approve" || !decoded.args || getAddress(decoded.args[0]) !== spender || decoded.args[1] < BigInt(inputAmountAtomic)) {
    throw new AcrossInvalidResponseError("Across changed the approval boundary.");
  }
  return true;
}

export function verifyAcrossSpokePoolDeployment(
  observed: AcrossObservedSpokePoolDeployment,
  expected: AcrossSpokePoolDeploymentPin,
  boundary: "source" | "destination"
) {
  const proxyRuntimeHash = observed.proxyRuntimeCode === "0x" ? null : keccak256(observed.proxyRuntimeCode).toLowerCase() as Hex;
  const implementationRuntimeHash = observed.implementationRuntimeCode === "0x"
    ? null
    : keccak256(observed.implementationRuntimeCode).toLowerCase() as Hex;
  if (
    !proxyRuntimeHash || proxyRuntimeHash !== expected.proxyRuntimeHash
    || getAddress(observed.implementationAddress) !== expected.implementationAddress
    || !implementationRuntimeHash || implementationRuntimeHash !== expected.implementationRuntimeHash
  ) throw new AcrossInvalidResponseError(`Across ${boundary} SpokePool proxy or implementation is not approved.`);
  return {
    proxyRuntimeHash,
    implementationAddress: expected.implementationAddress,
    implementationRuntimeHash
  };
}

export function verifyAcrossFundingQuoteResponse(input: {
  body: unknown;
  request: AcrossFundingRequest;
  configuration: AcrossFundingConfiguration;
  observedSourceDeployment: AcrossObservedSpokePoolDeployment;
  observedDestinationDeployment: AcrossObservedSpokePoolDeployment;
  nowMs: number;
}): AcrossFundingPreparedTransactions {
  assertFundingRequest(input.request);
  const body = input.body;
  if (!isObject(body)) throw new AcrossInvalidResponseError("Across returned an invalid quote response.");
  const sourceToken = getAddress(input.request.sourceToken);
  const destinationToken = TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG;
  const sourceSpokePool = ACROSS_SPOKE_POOLS[input.request.sourceChainId];
  const sourceDeployment = verifyAcrossSpokePoolDeployment(
    input.observedSourceDeployment,
    input.configuration.deployments[input.request.sourceChainId],
    "source"
  );
  const destinationDeployment = verifyAcrossSpokePoolDeployment(
    input.observedDestinationDeployment,
    input.configuration.deployments[ROBINHOOD_MAINNET_CHAIN_ID],
    "destination"
  );

  if (body.crossSwapType !== "bridgeableToBridgeable" || body.amountType !== "exactInput") {
    throw new AcrossInvalidResponseError("Across returned a route with an unexpected swap leg.");
  }
  const inputToken = tokenIdentity(body.inputToken);
  const outputToken = tokenIdentity(body.outputToken);
  const refundToken = tokenIdentity(body.refundToken);
  if (
    !inputToken || inputToken.chainId !== input.request.sourceChainId || inputToken.address !== sourceToken || inputToken.decimals !== 6
    || !outputToken || outputToken.chainId !== ROBINHOOD_MAINNET_CHAIN_ID || outputToken.address !== destinationToken || outputToken.decimals !== 6
    || !refundToken || refundToken.chainId !== input.request.sourceChainId || refundToken.address !== sourceToken || refundToken.decimals !== 6
  ) throw new AcrossInvalidResponseError("Across changed a chain-qualified asset identity.");

  const expectedOutputAtomic = positiveAtomic(body.expectedOutputAmount);
  const protectedOutputAtomic = positiveAtomic(body.minOutputAmount);
  const maxInputAmount = positiveAtomic(body.maxInputAmount);
  const expectedCompletionSeconds = positiveInteger(body.expectedFillTime);
  const quoteExpiryTimestamp = positiveInteger(body.quoteExpiryTimestamp);
  if (
    body.inputAmount !== input.request.inputAmountAtomic
    || maxInputAmount !== input.request.inputAmountAtomic
    || !expectedOutputAtomic || !protectedOutputAtomic || BigInt(protectedOutputAtomic) > BigInt(expectedOutputAtomic)
    || !expectedCompletionSeconds || expectedCompletionSeconds > MAX_QUOTE_LIFETIME_SECONDS
    || !quoteExpiryTimestamp || quoteExpiryTimestamp * 1_000 <= input.nowMs
    || quoteExpiryTimestamp * 1_000 > input.nowMs + MAX_QUOTE_LIFETIME_SECONDS * 1_000
    || typeof body.id !== "string" || !/^[A-Za-z0-9_-]{8,160}$/.test(body.id)
  ) throw new AcrossInvalidResponseError("Across returned invalid funding economics or expiry.");

  const steps = isObject(body.steps) ? body.steps : null;
  const bridge = steps && isObject(steps.bridge) ? steps.bridge : null;
  if (!steps || !bridge || (steps.originSwap !== undefined && steps.originSwap !== null) || (steps.destinationSwap !== undefined && steps.destinationSwap !== null)) {
    throw new AcrossInvalidResponseError("Across returned an unexpected origin or destination call.");
  }
  const bridgeTokenIn = tokenIdentity(bridge.tokenIn);
  const bridgeTokenOut = tokenIdentity(bridge.tokenOut);
  if (
    bridge.provider !== "across"
    || bridge.inputAmount !== input.request.inputAmountAtomic
    || bridge.outputAmount !== protectedOutputAtomic
    || !bridgeTokenIn || bridgeTokenIn.chainId !== input.request.sourceChainId || bridgeTokenIn.address !== sourceToken
    || !bridgeTokenOut || bridgeTokenOut.chainId !== ROBINHOOD_MAINNET_CHAIN_ID || bridgeTokenOut.address !== destinationToken
  ) throw new AcrossInvalidResponseError("Across changed the direct funding bridge leg.");

  const fees = isObject(body.fees) ? body.fees : null;
  const totalFee = fees && isObject(fees.total) ? fees.total : null;
  const totalFeeToken = totalFee ? tokenIdentity(totalFee.token) : null;
  const totalFeeAtomic = totalFee ? nonNegativeAtomic(totalFee.amount) : null;
  const originGas = fees && isObject(fees.originGas) ? fees.originGas : null;
  const originGasAtomic = originGas ? nonNegativeAtomic(originGas.amount) : null;
  if (
    !totalFee || totalFeeAtomic === null || !totalFeeToken
    || totalFeeToken.chainId !== input.request.sourceChainId || totalFeeToken.address !== sourceToken
    || (originGas && originGasAtomic === null)
  ) throw new AcrossInvalidResponseError("Across omitted complete fee disclosure.");
  const appFee = isObject(totalFee.details) && isObject(totalFee.details.app)
    ? nonNegativeAtomic(totalFee.details.app.amount)
    : null;
  if (appFee !== null && appFee !== "0") throw new AcrossInvalidResponseError("Across returned an unexpected application fee.");

  const checks = isObject(body.checks) ? body.checks : null;
  const allowance = checks && isObject(checks.allowance) ? checks.allowance : null;
  const balance = checks && isObject(checks.balance) ? checks.balance : null;
  const approvalSpender = allowance ? address(allowance.spender) : null;
  if (
    !allowance || address(allowance.token) !== sourceToken || !approvalSpender || approvalSpender !== sourceSpokePool
    || positiveAtomic(allowance.expected) !== input.request.inputAmountAtomic || nonNegativeAtomic(allowance.actual) === null
    || !balance || address(balance.token) !== sourceToken || positiveAtomic(balance.expected) !== input.request.inputAmountAtomic
    || nonNegativeAtomic(balance.actual) === null || BigInt(String(balance.actual)) < BigInt(input.request.inputAmountAtomic)
  ) throw new AcrossInvalidResponseError("Across returned inconsistent allowance or balance checks.");

  const swapTx = isObject(body.swapTx) ? body.swapTx : null;
  const depositTarget = swapTx ? address(swapTx.to) : null;
  const depositGasLimit = swapTx ? positiveAtomic(swapTx.gas) : null;
  const depositValueAtomic = swapTx && swapTx.value !== undefined ? nonNegativeAtomic(swapTx.value) : "0";
  if (
    !swapTx || swapTx.simulationSuccess !== true || swapTx.chainId !== input.request.sourceChainId
    || depositTarget !== sourceSpokePool || typeof swapTx.data !== "string" || !isHex(swapTx.data)
    || !depositGasLimit || depositValueAtomic !== "0"
  ) throw new AcrossInvalidResponseError("Across returned an invalid source transaction envelope.");

  const deposit = decodedDeposit(swapTx.data as Hex, input.configuration.integratorId);
  const nowSeconds = Math.floor(input.nowMs / 1_000);
  if (
    !deposit.exclusiveRelayer
    || deposit.depositor !== getAddress(input.request.depositor)
    || deposit.recipient !== getAddress(input.request.recipient)
    || deposit.inputToken !== sourceToken || deposit.outputToken !== destinationToken
    || deposit.inputAmount.toString() !== input.request.inputAmountAtomic
    || deposit.outputAmount.toString() !== protectedOutputAtomic
    || deposit.destinationChainId !== BigInt(ROBINHOOD_MAINNET_CHAIN_ID)
    || deposit.message !== "0x"
    || deposit.quoteTimestamp > nowSeconds || deposit.quoteTimestamp < nowSeconds - MAX_QUOTE_AGE_SECONDS
    || deposit.fillDeadline <= nowSeconds || deposit.fillDeadline > nowSeconds + MAX_QUOTE_LIFETIME_SECONDS
    || !Number.isSafeInteger(deposit.exclusivityParameter) || deposit.exclusivityParameter < 0
  ) throw new AcrossInvalidResponseError("Across deposit calldata does not match the requested funding intent.");

  const approvalRequired = parseProviderApprovalTransactions(
    body.approvalTxns,
    input.request.sourceChainId,
    sourceToken,
    approvalSpender,
    input.request.inputAmountAtomic
  ) || BigInt(String(allowance.actual)) < BigInt(input.request.inputAmountAtomic);
  const exactApprovalData = approvalRequired ? encodeFunctionData({
    abi: approvalAbi,
    functionName: "approve",
    args: [approvalSpender, BigInt(input.request.inputAmountAtomic)]
  }) : null;

  const evidence: AcrossFundingEvidence = {
    schemaVersion: 1,
    provider: "across",
    kind: "cross_chain_funding",
    settlementMode: "asynchronous_fill",
    quoteId: body.id,
    sourceChainId: input.request.sourceChainId,
    destinationChainId: ROBINHOOD_MAINNET_CHAIN_ID,
    sourceToken,
    destinationToken,
    inputAmountAtomic: input.request.inputAmountAtomic,
    expectedOutputAtomic,
    protectedOutputAtomic,
    recipient: getAddress(input.request.recipient),
    depositor: getAddress(input.request.depositor),
    sourceSpokePool,
    destinationSpokePool: ACROSS_SPOKE_POOLS[ROBINHOOD_MAINNET_CHAIN_ID],
    sourceSpokePoolRuntimeHash: sourceDeployment.proxyRuntimeHash,
    sourceSpokePoolImplementation: sourceDeployment.implementationAddress,
    sourceSpokePoolImplementationRuntimeHash: sourceDeployment.implementationRuntimeHash,
    destinationSpokePoolRuntimeHash: destinationDeployment.proxyRuntimeHash,
    destinationSpokePoolImplementation: destinationDeployment.implementationAddress,
    destinationSpokePoolImplementationRuntimeHash: destinationDeployment.implementationRuntimeHash,
    approvalSpender,
    exactApprovalAmountAtomic: input.request.inputAmountAtomic,
    exclusiveRelayer: deposit.exclusiveRelayer,
    quoteTimestamp: deposit.quoteTimestamp,
    fillDeadline: deposit.fillDeadline,
    exclusivityParameter: deposit.exclusivityParameter,
    message: "0x",
    refundRecipient: getAddress(input.request.depositor),
    refundChainId: input.request.sourceChainId,
    refundToken: sourceToken,
    refundOnOrigin: true,
    partialFillsAllowed: false,
    totalFeeAtomic,
    totalFeeAsset: totalFeeToken.address,
    originGasAtomic,
    expectedCompletionSeconds,
    quoteExpiresAtMs: quoteExpiryTimestamp * 1_000,
    providerSimulationPassed: true,
    depositTarget,
    depositCalldataHash: keccak256(swapTx.data as Hex),
    depositValueAtomic: "0",
    depositGasLimit,
    unexpectedDestinationCall: false,
    serverSubmissionEnabled: false
  };
  return {
    evidence,
    approvalRequired,
    approvalTransaction: exactApprovalData ? {
      chainId: input.request.sourceChainId,
      target: sourceToken,
      data: exactApprovalData,
      value: "0"
    } : null,
    depositTransaction: {
      chainId: input.request.sourceChainId,
      target: depositTarget,
      data: swapTx.data as Hex,
      value: "0",
      gasLimit: depositGasLimit
    }
  };
}

async function rpcAnyResult(
  chainId: AcrossFundingSourceChainId | typeof ROBINHOOD_MAINNET_CHAIN_ID,
  method: string,
  params: unknown[],
  env: NodeJS.ProcessEnv = process.env
) {
  const response = await fetch(acrossRpcEndpoint(chainId, env), {
    method: "POST",
    headers: acrossRpcHeaders(chainId, env),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(ACROSS_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isObject(body) || body.error !== undefined || body.result === undefined) {
    throw new Error("RMT could not read the required Across chain state.");
  }
  return body.result;
}

async function rpcResult(
  chainId: AcrossFundingSourceChainId | typeof ROBINHOOD_MAINNET_CHAIN_ID,
  method: string,
  params: unknown[],
  env: NodeJS.ProcessEnv = process.env
) {
  const result = await rpcAnyResult(chainId, method, params, env);
  if (typeof result !== "string" || !isHex(result)) throw new Error("RMT could not read the required Across chain state.");
  return result as Hex;
}

export async function readAcrossSpokePoolDeployment(
  chainId: AcrossFundingSourceChainId | typeof ROBINHOOD_MAINNET_CHAIN_ID,
  contract: Address,
  env: NodeJS.ProcessEnv = process.env
): Promise<AcrossObservedSpokePoolDeployment> {
  const chainIdentity = await rpcResult(chainId, "eth_chainId", [], env);
  if (BigInt(chainIdentity) !== BigInt(chainId)) throw new Error("RMT rejected an Across RPC with the wrong chain identity.");
  const blockNumber = await rpcResult(chainId, "eth_blockNumber", [], env);
  const block = await rpcAnyResult(chainId, "eth_getBlockByNumber", [blockNumber, false], env);
  if (!isObject(block) || typeof block.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
    throw new Error("RMT could not pin the Across deployment evidence block.");
  }
  const observedBlockHash = block.hash.toLowerCase() as Hex;
  const [proxyRuntimeCode, implementationWord] = await Promise.all([
    rpcResult(chainId, "eth_getCode", [contract, blockNumber], env),
    rpcResult(chainId, "eth_getStorageAt", [contract, ACROSS_EIP1967_IMPLEMENTATION_SLOT, blockNumber], env)
  ]);
  if (!/^0x[0-9a-fA-F]{64}$/.test(implementationWord)) throw new Error("RMT could not resolve the Across SpokePool implementation.");
  const implementationAddress = getAddress(`0x${implementationWord.slice(-40)}`);
  if (implementationAddress === getAddress("0x0000000000000000000000000000000000000000")) {
    throw new Error("RMT rejected an Across SpokePool without an EIP-1967 implementation.");
  }
  const implementationRuntimeCode = await rpcResult(chainId, "eth_getCode", [implementationAddress, blockNumber], env);
  const reread = await rpcAnyResult(chainId, "eth_getBlockByNumber", [blockNumber, false], env);
  if (!isObject(reread) || typeof reread.hash !== "string" || reread.hash.toLowerCase() !== observedBlockHash) {
    throw new Error("RMT rejected replaced Across deployment evidence.");
  }
  return {
    proxyRuntimeCode,
    implementationAddress,
    implementationRuntimeCode,
    observedBlockNumber: BigInt(blockNumber).toString(),
    observedBlockHash
  };
}

export function evaluateAcrossFundingWalletReadiness(input: {
  sourceBalanceAtomic: string;
  nativeGasBalanceAtomic: string;
  requestedInputAtomic: string;
}) {
  if (![input.sourceBalanceAtomic, input.nativeGasBalanceAtomic, input.requestedInputAtomic]
    .every((value) => /^(?:0|[1-9][0-9]{0,77})$/.test(value))) {
    throw new Error("RMT rejected malformed source funding balances.");
  }
  const sufficientSourceBalance = BigInt(input.sourceBalanceAtomic) >= BigInt(input.requestedInputAtomic);
  const hasNativeGas = BigInt(input.nativeGasBalanceAtomic) > 0n;
  return {
    ...input,
    sufficientSourceBalance,
    hasNativeGas,
    fundedPreflightReady: sufficientSourceBalance && hasNativeGas
  } as const;
}

export async function readAcrossFundingWalletReadiness(input: {
  sourceChainId: AcrossFundingSourceChainId;
  sourceToken: Address;
  wallet: Address;
  requestedInputAtomic: string;
}, env: NodeJS.ProcessEnv = process.env) {
  if (!trustedAcrossFundingPair(input.sourceChainId, input.sourceToken)
    || !isAddress(input.wallet)
    || !/^[1-9][0-9]{0,77}$/.test(input.requestedInputAtomic)) {
    throw new Error("RMT rejected an unsupported funding readiness request.");
  }
  const balanceCall = encodeFunctionData({ abi: erc20BalanceAbi, functionName: "balanceOf", args: [input.wallet] });
  const [sourceBalanceHex, nativeGasBalanceHex] = await Promise.all([
    rpcResult(input.sourceChainId, "eth_call", [{ to: input.sourceToken, data: balanceCall }, "latest"], env),
    rpcResult(input.sourceChainId, "eth_getBalance", [input.wallet, "latest"], env)
  ]);
  if (!/^0x[0-9a-fA-F]+$/.test(sourceBalanceHex) || !/^0x[0-9a-fA-F]+$/.test(nativeGasBalanceHex)) {
    throw new Error("RMT received malformed source funding balances.");
  }
  return evaluateAcrossFundingWalletReadiness({
    sourceBalanceAtomic: BigInt(sourceBalanceHex).toString(),
    nativeGasBalanceAtomic: BigInt(nativeGasBalanceHex).toString(),
    requestedInputAtomic: input.requestedInputAtomic
  });
}

async function fetchAcrossFundingQuote(request: AcrossFundingRequest, configuration: AcrossFundingConfiguration) {
  const url = new URL("/api/swap/approval", ACROSS_API_URL);
  url.search = new URLSearchParams({
    tradeType: "exactInput",
    amount: request.inputAmountAtomic,
    inputToken: request.sourceToken,
    outputToken: TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG,
    originChainId: String(request.sourceChainId),
    destinationChainId: String(ROBINHOOD_MAINNET_CHAIN_ID),
    depositor: request.depositor,
    recipient: request.recipient,
    refundAddress: request.depositor,
    refundOnOrigin: "true",
    strictTradeType: "true",
    slippage: "0.005",
    integratorId: configuration.integratorId
  }).toString();
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${configuration.apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(ACROSS_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Across funding quote failed with ${response.status}.`);
  return body;
}

export async function prepareAcrossFundingPreflightQuote(request: AcrossFundingRequest, env: NodeJS.ProcessEnv = process.env) {
  const configuration = acrossFundingConfiguration(env);
  if (!configuration) throw new Error("Across funding preflight is not configured.");
  assertFundingRequest(request);
  const [body, observedSourceDeployment, observedDestinationDeployment] = await Promise.all([
    fetchAcrossFundingQuote(request, configuration),
    readAcrossSpokePoolDeployment(request.sourceChainId, ACROSS_SPOKE_POOLS[request.sourceChainId], env),
    readAcrossSpokePoolDeployment(ROBINHOOD_MAINNET_CHAIN_ID, ACROSS_SPOKE_POOLS[ROBINHOOD_MAINNET_CHAIN_ID], env)
  ]);
  return verifyAcrossFundingQuoteResponse({ body, request, configuration, observedSourceDeployment, observedDestinationDeployment, nowMs: Date.now() });
}

export async function prepareAcrossFundingQuote(request: AcrossFundingRequest) {
  const state = acrossFundingOperationalState();
  const configuration = acrossFundingConfiguration();
  if (!state.quotingEnabled || !configuration) throw new Error("Across funding quotes are release-locked.");
  return prepareAcrossFundingPreflightQuote(request);
}

export function acrossFundingSourceChain(value: number): AcrossFundingSourceChainId | null {
  return value === ETHEREUM_MAINNET_CHAIN_ID || value === ARBITRUM_MAINNET_CHAIN_ID || value === BASE_MAINNET_CHAIN_ID
    ? value
    : null;
}

export function trustedAcrossFundingPair(sourceChainId: number, sourceToken: string) {
  const source = acrossFundingSourceChain(sourceChainId);
  if (!source || !isAddress(sourceToken, { strict: false })) return null;
  const input = trustedPaymentAsset(source, sourceToken);
  const output = trustedSettlementAsset(ROBINHOOD_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG);
  return input?.symbol === "USDC" && input.issuer === "Circle" && output
    ? { input, output }
    : null;
}

export type { AcrossFundingConfiguration };
