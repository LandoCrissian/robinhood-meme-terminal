import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  isHex,
  keccak256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import type {
  VNextPreparedProviderAuthorization,
  VNextProviderAuthorizationRequest,
  VNextProviderVerificationEvidence,
  VNextProviderVerificationRequest
} from "./vnext-provider-adapter";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../vnext/execution-settlement";
import {
  createVNextZeroXProviderNativeFee,
  fromZeroXToken,
  RMT_ZERO_X_FEE_BPS,
  RMT_ZERO_X_FEE_TREASURY,
  toZeroXToken,
  zeroXIntegratorFeeAmount
} from "../vnext/zero-x-settlement";

const ZERO_X_API_URL = "https://api.0x.org";
const ZERO_X_TIMEOUT_MS = 4_000;
const ZERO_X_RPC_TIMEOUT_MS = 8_000;
const EVIDENCE_TTL_MS = 10_000;
const DEFAULT_ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com/";

type JsonObject = Record<string, unknown>;
type ZeroXFee = { asset: Address; amountAtomic: string };

type ZeroXSwapFirmQuoteVerificationConfiguration = {
  allowanceHolder: Address;
  runtimeHash: Hex;
};

type ParsedFirmQuote = {
  allowanceActualAtomic: string | null;
  allowanceSpender: Address | null;
  balanceActualAtomic: string | null;
  blockNumber: string | null;
  calldata: Hex;
  expectedOutputAtomic: string;
  gasLimitUnits: string;
  gasPriceWei: string | null;
  networkFeeNativeAtomic: string;
  protectedOutputAtomic: string;
  providerFee: ZeroXFee | null;
  simulationIncomplete: boolean;
  transactionTarget: Address;
  transactionValueAtomic: string;
  zid: string | null;
};

export type ZeroXSwapFirmQuoteVerificationEvidence = VNextProviderVerificationEvidence & {
  provider: "zero-x-swap";
  route: "aggregated";
  transactionData: Hex;
  swapTransactionValueAtomic: string;
  providerFeeAsset: Address | null;
  providerFeeAtomic: string | null;
  providerQuoteId: string | null;
  blockNumber: string | null;
  providerSimulationIncomplete: boolean;
  strictVerificationAvailable: true;
  walletAuthorizationAvailable: true;
  admissionReady: boolean;
};

class ZeroXInvalidResponseError extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveAtomic(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
}

function nonNegativeAtomic(value: unknown) {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? value : null;
}

function parseProviderFee(value: unknown, request: VNextProviderVerificationRequest): ZeroXFee | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || typeof value.token !== "string" || !isAddress(value.token, { strict: false }) || !positiveAtomic(value.amount)) {
    throw new ZeroXInvalidResponseError("0x returned an invalid provider fee.");
  }
  const asset = fromZeroXToken(value.token);
  if (asset !== request.inputAsset && asset !== request.outputAsset) throw new ZeroXInvalidResponseError("0x returned a provider fee in an unrelated token.");
  return { asset, amountAtomic: value.amount as string };
}

function parseIntegratorFee(fees: JsonObject, request: VNextProviderVerificationRequest) {
  const singular = fees.integratorFee == null ? [] : [fees.integratorFee];
  const plural = fees.integratorFees == null ? [] : Array.isArray(fees.integratorFees) ? fees.integratorFees : [fees.integratorFees];
  if (plural.length > 1) throw new ZeroXInvalidResponseError("0x returned duplicate integrator fees.");
  const parse = (value: unknown) => {
    if (!isObject(value) || typeof value.token !== "string" || !isAddress(value.token, { strict: false }) || !positiveAtomic(value.amount)) {
      throw new ZeroXInvalidResponseError("0x returned an invalid integrator fee.");
    }
    if (value.type !== undefined && value.type !== "volume") throw new ZeroXInvalidResponseError("0x returned an invalid integrator fee type.");
    const token = fromZeroXToken(value.token);
    const amount = value.amount as string;
    if (token !== request.inputAsset) throw new ZeroXInvalidResponseError("0x returned the integrator fee in the wrong token.");
    if (amount !== zeroXIntegratorFeeAmount(request.inputAmountAtomic)) throw new ZeroXInvalidResponseError("0x returned the wrong integrator fee amount.");
    return `${token}:${amount}:${String(value.type ?? "")}`;
  };
  const singularKey = singular.map(parse)[0] ?? null;
  const pluralKey = plural.map(parse)[0] ?? null;
  if (!singularKey && !pluralKey) throw new ZeroXInvalidResponseError("0x omitted the RMT integrator fee.");
  if (singularKey && pluralKey && singularKey !== pluralKey) throw new ZeroXInvalidResponseError("0x returned duplicate integrator fees.");
}

function rpcUrl() {
  return process.env.RMT_RPC_URL?.trim()
    || process.env.RMT_MAINNET_RPC_URL?.trim()
    || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || process.env.NEXT_PUBLIC_RMT_RPC_URL?.trim()
    || DEFAULT_ROBINHOOD_RPC_URL;
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(ZERO_X_RPC_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isObject(body) || body.error !== undefined || body.result === undefined) throw new Error(`Robinhood RPC ${method} failed.`);
  return body.result;
}

export function zeroXSwapFirmQuoteVerificationConfiguration(): ZeroXSwapFirmQuoteVerificationConfiguration | null {
  if (process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED !== "true") return null;
  const configuredAddress = process.env.RMT_ZEROX_ALLOWANCE_HOLDER?.trim();
  const configuredHash = process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH?.trim();
  if (!configuredAddress || !isAddress(configuredAddress, { strict: false }) || /^0x0{40}$/i.test(configuredAddress) || !configuredHash || !/^0x[0-9a-fA-F]{64}$/.test(configuredHash)) return null;
  return { allowanceHolder: getAddress(configuredAddress), runtimeHash: configuredHash.toLowerCase() as Hex };
}

async function runtimeCode(address: Address) {
  const result = await rpc("eth_getCode", [address, "latest"]);
  if (typeof result !== "string" || !isHex(result) || !/^0x(?:[0-9a-fA-F]{2})+$/.test(result)) throw new Error("0x transaction target has no contract code.");
  return result as Hex;
}

async function requireAllowanceHolderRuntime(configuration: ZeroXSwapFirmQuoteVerificationConfiguration) {
  const code = await runtimeCode(configuration.allowanceHolder);
  if (keccak256(code).toLowerCase() !== configuration.runtimeHash.toLowerCase()) throw new Error("0x AllowanceHolder runtime bytecode is not approved.");
  return configuration.runtimeHash;
}

async function nativeBalance(address: Address) {
  const result = await rpc("eth_getBalance", [address, "latest"]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error("Robinhood RPC returned an invalid native balance.");
  return BigInt(result);
}

async function estimateApprovalGas(account: Address, token: Address, data: Hex) {
  const result = await rpc("eth_estimateGas", [{ from: account, to: token, data, value: "0x0" }]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result) || BigInt(result) <= 0n) throw new Error("0x approval gas estimate is unavailable.");
  const estimate = BigInt(result);
  return { estimated: estimate, limit: (estimate * 120n + 99n) / 100n };
}

async function tokenUint(token: Address, data: Hex) {
  const result = await rpc("eth_call", [{ to: token, data }, "latest"]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error("Robinhood RPC returned invalid ERC20 balance or allowance evidence.");
  return BigInt(result);
}

async function simulate(input: { account: Address; target: Address; calldata: Hex; valueAtomic: string; gasLimitUnits: string; gasPriceWei: string | null }) {
  const result = await rpc("eth_call", [{
    from: input.account,
    to: input.target,
    data: input.calldata,
    value: `0x${BigInt(input.valueAtomic).toString(16)}`,
    gas: `0x${BigInt(input.gasLimitUnits).toString(16)}`,
    ...(input.gasPriceWei !== null ? { gasPrice: `0x${BigInt(input.gasPriceWei).toString(16)}` } : {})
  }, "latest"]);
  if (typeof result !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) throw new Error("Robinhood RPC returned an invalid simulation result.");
}

function parseFirmQuote(body: unknown, request: VNextProviderVerificationRequest, configuration: ZeroXSwapFirmQuoteVerificationConfiguration): ParsedFirmQuote {
  if (!isObject(body) || body.liquidityAvailable !== true) throw new ZeroXInvalidResponseError("0x did not return a complete firm quote.");
  if ((body.chainId !== undefined && body.chainId !== 4_663 && body.chainId !== "4663")
    || (body.taker !== undefined && (typeof body.taker !== "string" || getAddress(body.taker) !== request.recipient))
    || (body.recipient !== undefined && (typeof body.recipient !== "string" || getAddress(body.recipient) !== request.recipient))
  ) throw new ZeroXInvalidResponseError("0x changed the chain, taker or recipient binding.");
  const expectedOutputAtomic = positiveAtomic(body.buyAmount);
  const protectedOutputAtomic = positiveAtomic(body.minBuyAmount);
  const networkFeeNativeAtomic = nonNegativeAtomic(body.totalNetworkFee);
  const nativeInput = request.inputAsset === zeroAddress;
  if (
    typeof body.sellToken !== "string" || fromZeroXToken(body.sellToken) !== request.inputAsset
    || typeof body.buyToken !== "string" || fromZeroXToken(body.buyToken) !== request.outputAsset
    || body.sellAmount !== request.inputAmountAtomic
    || (body.mode !== undefined && body.mode !== "exact-in")
    || !expectedOutputAtomic || !protectedOutputAtomic || networkFeeNativeAtomic === null
    || BigInt(protectedOutputAtomic) > BigInt(expectedOutputAtomic)
    || BigInt(protectedOutputAtomic) < request.indicativeProtectedOutputFloorAtomic
  ) throw new ZeroXInvalidResponseError("0x changed the requested firm-quote economics.");

  const issues = isObject(body.issues) ? body.issues : null;
  if (!issues || !Object.hasOwn(issues, "allowance") || !Object.hasOwn(issues, "balance")
    || typeof issues.simulationIncomplete !== "boolean" || !Array.isArray(issues.invalidSourcesPassed) || issues.invalidSourcesPassed.length !== 0
  ) throw new ZeroXInvalidResponseError("0x returned incomplete firm-quote validation evidence.");
  const issueSpender = isObject(issues.allowance) ? issues.allowance.spender : null;
  const allowanceTarget = body.allowanceTarget ?? issueSpender;
  if (!nativeInput && (typeof allowanceTarget !== "string" || !isAddress(allowanceTarget, { strict: false }) || getAddress(allowanceTarget) !== configuration.allowanceHolder)) {
    throw new ZeroXInvalidResponseError("0x returned an unapproved AllowanceHolder.");
  }
  if (nativeInput && allowanceTarget != null && (typeof allowanceTarget !== "string" || !isAddress(allowanceTarget, { strict: false }) || getAddress(allowanceTarget) !== configuration.allowanceHolder)) {
    throw new ZeroXInvalidResponseError("0x returned an invalid native allowance target.");
  }

  const fees = isObject(body.fees) ? body.fees : null;
  if (!fees) throw new ZeroXInvalidResponseError("0x omitted fee disclosure.");
  parseIntegratorFee(fees, request);
  if (fees.gasFee != null) throw new ZeroXInvalidResponseError("0x returned a gas-sponsorship fee for a wallet-paid swap.");
  const providerFee = parseProviderFee(fees.zeroExFee, request);

  const allowance = issues.allowance;
  let allowanceActualAtomic: string | null = null;
  let allowanceSpender: Address | null = null;
  if (nativeInput && allowance != null) throw new ZeroXInvalidResponseError("0x returned an allowance issue for native ETH.");
  if (!nativeInput && allowance != null) {
    if (!isObject(allowance) || !nonNegativeAtomic(allowance.actual) || typeof allowance.spender !== "string" || !isAddress(allowance.spender, { strict: false })) {
      throw new ZeroXInvalidResponseError("0x returned an invalid allowance issue.");
    }
    allowanceSpender = getAddress(allowance.spender);
    allowanceActualAtomic = allowance.actual as string;
    if (allowanceSpender !== configuration.allowanceHolder || allowanceActualAtomic === request.inputAmountAtomic || BigInt(allowanceActualAtomic) >= request.amountIn) {
      throw new ZeroXInvalidResponseError("0x returned an inconsistent AllowanceHolder issue.");
    }
  }
  if (!nativeInput && allowanceSpender && typeof allowanceTarget === "string" && getAddress(allowanceTarget) !== allowanceSpender) {
    throw new ZeroXInvalidResponseError("0x allowance target and issue spender disagree.");
  }

  const balanceIssue = issues.balance;
  let balanceActualAtomic: string | null = null;
  if (balanceIssue != null) {
    if (!isObject(balanceIssue) || typeof balanceIssue.token !== "string" || fromZeroXToken(balanceIssue.token) !== request.inputAsset || !nonNegativeAtomic(balanceIssue.actual) || balanceIssue.expected !== request.inputAmountAtomic) {
      throw new ZeroXInvalidResponseError("0x returned an invalid balance issue.");
    }
    balanceActualAtomic = balanceIssue.actual as string;
  }

  const transaction = isObject(body.transaction) ? body.transaction : null;
  const gasLimitUnits = transaction ? positiveAtomic(transaction.gas) : null;
  const gasPriceWei = transaction ? positiveAtomic(transaction.gasPrice) : null;
  const transactionValueAtomic = transaction ? nonNegativeAtomic(transaction.value) : null;
  if (!transaction || typeof transaction.to !== "string" || !isAddress(transaction.to, { strict: false }) || getAddress(transaction.to) === zeroAddress || typeof transaction.data !== "string" || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(transaction.data) || !gasLimitUnits || (transaction.gasPrice !== undefined && !gasPriceWei) || transactionValueAtomic === null
    || (transaction.chainId !== undefined && transaction.chainId !== 4_663 && transaction.chainId !== "4663")
    || (transaction.from !== undefined && (typeof transaction.from !== "string" || getAddress(transaction.from) !== request.recipient))) {
    throw new ZeroXInvalidResponseError("0x returned an invalid transaction envelope.");
  }
  const transactionTarget = getAddress(transaction.to);
  if (!nativeInput && (transactionTarget !== configuration.allowanceHolder || transactionValueAtomic !== "0")) {
    throw new ZeroXInvalidResponseError("0x returned an invalid AllowanceHolder transaction envelope.");
  }
  if (nativeInput && transactionValueAtomic === "0") throw new ZeroXInvalidResponseError("0x returned zero transaction value for native ETH.");

  const blockNumber = body.blockNumber == null ? null : positiveAtomic(typeof body.blockNumber === "number" && Number.isSafeInteger(body.blockNumber) ? String(body.blockNumber) : body.blockNumber);
  if (body.blockNumber != null && !blockNumber) throw new ZeroXInvalidResponseError("0x returned an invalid quote block.");
  const zid = body.zid == null ? null : typeof body.zid === "string" && /^(?:0x[0-9a-fA-F]{1,128}|[A-Za-z0-9_-]{8,128})$/.test(body.zid) ? body.zid : null;
  if (body.zid != null && !zid) throw new ZeroXInvalidResponseError("0x returned an invalid quote identity.");
  return {
    allowanceActualAtomic, allowanceSpender, balanceActualAtomic, blockNumber,
    calldata: transaction.data as Hex, expectedOutputAtomic, gasLimitUnits, gasPriceWei,
    networkFeeNativeAtomic, protectedOutputAtomic, providerFee,
    simulationIncomplete: issues.simulationIncomplete, transactionTarget, transactionValueAtomic, zid
  };
}

async function fetchFirmQuote(request: VNextProviderVerificationRequest) {
  const apiKey = process.env.RMT_ZEROX_API_KEY?.trim();
  if (!apiKey) throw new Error("0x server credential is not configured.");
  const url = new URL("/swap/allowance-holder/quote", ZERO_X_API_URL);
  url.search = new URLSearchParams({
    chainId: String(request.chainId), sellToken: toZeroXToken(request.inputAsset), buyToken: toZeroXToken(request.outputAsset),
    sellAmount: request.inputAmountAtomic, taker: request.recipient, recipient: request.recipient, slippageBps: "100",
    swapFeeRecipient: RMT_ZERO_X_FEE_TREASURY, swapFeeBps: String(RMT_ZERO_X_FEE_BPS), swapFeeToken: toZeroXToken(request.inputAsset)
  }).toString();
  const response = await fetch(url, { headers: { Accept: "application/json", "0x-api-key": apiKey, "0x-version": "v2" }, cache: "no-store", signal: AbortSignal.timeout(ZERO_X_TIMEOUT_MS) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 400 && isObject(body) && body.name === "NO_LIQUIDITY_AVAILABLE") return null;
    throw new Error(`0x firm-quote request failed with ${response.status}.`);
  }
  return body;
}

export async function verifyZeroXSwapFirmQuote(request: VNextProviderVerificationRequest): Promise<ZeroXSwapFirmQuoteVerificationEvidence> {
  const configuration = zeroXSwapFirmQuoteVerificationConfiguration();
  if (!configuration) throw new Error("0x Swap firm-quote verification is not configured.");
  if (request.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE || !request.deadlineSeconds || !request.nowMs) throw new Error("0x provider-native verification authority is incomplete.");
  if (request.chainId !== 4_663 || request.amountIn <= 0n || request.inputAmountAtomic !== request.amountIn.toString()
    || request.indicativeProtectedOutputFloorAtomic <= 0n || request.inputAsset === request.outputAsset
    || getAddress(request.recipient) === zeroAddress || request.executionId !== undefined
  ) throw new Error("RMT rejected an inconsistent 0x request binding.");
  const chainId = await rpc("eth_chainId", []);
  if (typeof chainId !== "string" || !/^0x[0-9a-fA-F]+$/.test(chainId) || BigInt(chainId) !== 4_663n) throw new Error("Robinhood RPC chain identity changed.");
  const observedAtMs = Date.now();
  const body = await fetchFirmQuote(request);
  if (body === null) throw new Error("No complete 0x Swap route is available for firm-quote verification.");
  const quote = parseFirmQuote(body, request, configuration);
  const nativeInput = request.inputAsset === zeroAddress;
  const [balance, targetCode, holderHash, tokenBalance, tokenAllowance] = await Promise.all([
    nativeBalance(request.recipient),
    runtimeCode(quote.transactionTarget),
    nativeInput ? Promise.resolve(null) : requireAllowanceHolderRuntime(configuration),
    nativeInput ? Promise.resolve(null) : tokenUint(request.inputAsset, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [request.recipient] })),
    nativeInput ? Promise.resolve(null) : tokenUint(request.inputAsset, encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [request.recipient, configuration.allowanceHolder] }))
  ]);
  const targetRuntimeHash = keccak256(targetCode);
  if (!nativeInput && holderHash !== targetRuntimeHash) throw new Error("0x AllowanceHolder execution target changed.");

  const needsApproval = !nativeInput && (tokenAllowance! < request.amountIn || quote.allowanceActualAtomic !== null);
  const approvalData = needsApproval ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [configuration.allowanceHolder, request.amountIn] }) : null;
  const approvalGas = approvalData ? await estimateApprovalGas(request.recipient, request.inputAsset, approvalData) : null;
  const estimatedGas = approvalGas?.estimated ?? BigInt(quote.gasLimitUnits);
  const gasLimit = approvalGas?.limit ?? BigInt(quote.gasLimitUnits);
  const networkFeeCeiling = BigInt(quote.networkFeeNativeAtomic);
  const rpcGasPrice = quote.gasPriceWei === null ? await rpc("eth_gasPrice", []) : null;
  if (quote.gasPriceWei === null && (typeof rpcGasPrice !== "string" || !/^0x[0-9a-fA-F]+$/.test(rpcGasPrice) || BigInt(rpcGasPrice) <= 0n)) throw new Error("Robinhood RPC gas price is unavailable.");
  const quotedGasPrice = quote.gasPriceWei === null ? BigInt(rpcGasPrice as string) : BigInt(quote.gasPriceWei);
  const feeCeiling = networkFeeCeiling > gasLimit * quotedGasPrice
    ? (networkFeeCeiling + gasLimit - 1n) / gasLimit
    : quotedGasPrice;
  const estimatedNetworkCost = gasLimit * feeCeiling;
  const nextValue = approvalData ? 0n : BigInt(quote.transactionValueAtomic);
  const enoughNative = balance >= nextValue + estimatedNetworkCost;
  const sufficientSellBalance = quote.balanceActualAtomic === null && (nativeInput ? balance >= BigInt(quote.transactionValueAtomic) : tokenBalance! >= request.amountIn);

  let status: ZeroXSwapFirmQuoteVerificationEvidence["status"];
  let exactSimulationPassed = false;
  if (!sufficientSellBalance) status = "insufficient_balance";
  else if (!enoughNative) status = "insufficient_gas";
  else if (approvalData) status = "approval_required";
  else if (quote.simulationIncomplete) status = "simulation_failed";
  else {
    try {
      await simulate({ account: request.recipient, target: quote.transactionTarget, calldata: quote.calldata, valueAtomic: quote.transactionValueAtomic, gasLimitUnits: quote.gasLimitUnits, gasPriceWei: quote.gasPriceWei });
      exactSimulationPassed = true;
      status = "verified";
    } catch {
      status = "simulation_failed";
    }
  }

  const authorizationState = status === "approval_required" ? "approval_required" : status === "verified" ? "verified" : "blocked";
  const providerNativeFee = createVNextZeroXProviderNativeFee({
    inputAsset: request.inputAsset, outputAsset: request.outputAsset, userGrossInputAtomic: request.inputAmountAtomic,
    expectedOutputAtomic: quote.expectedOutputAtomic, protectedOutputAtomic: quote.protectedOutputAtomic,
    recipient: request.recipient, providerFeeAsset: quote.providerFee?.asset ?? null,
    providerFeeAtomic: quote.providerFee?.amountAtomic ?? null, transactionTarget: quote.transactionTarget,
    transactionCalldataHash: keccak256(quote.calldata), transactionValueAtomic: quote.transactionValueAtomic,
    authorizationState,
    firmQuote: {
      zid: quote.zid, observedAtMs, expiresAtMs: observedAtMs + EVIDENCE_TTL_MS,
      swapGasLimitUnits: quote.gasLimitUnits, nextActionGasLimitUnits: gasLimit.toString(), gasPriceWei: quote.gasPriceWei,
      targetRuntimeHash, allowanceTarget: nativeInput ? null : configuration.allowanceHolder,
      allowanceHolderRuntimeHash: holderHash, providerSimulationIncomplete: quote.simulationIncomplete, exactSimulationPassed
    }
  });
  const verifiedAtMs = Date.now();
  if (verifiedAtMs >= observedAtMs + EVIDENCE_TTL_MS) throw new Error("0x firm quote expired during validation; requote and retry.");
  const nextData = approvalData ?? quote.calldata;
  const nextTarget = approvalData ? request.inputAsset : quote.transactionTarget;
  return {
    provider: "zero-x-swap", status, chainId: 4_663, inputAsset: request.inputAsset, outputAsset: request.outputAsset,
    inputAmountAtomic: request.inputAmountAtomic, indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic.toString(),
    expectedOutputAtomic: quote.expectedOutputAtomic, protectedOutputAtomic: quote.protectedOutputAtomic,
    recipient: request.recipient, router: quote.transactionTarget, approvalSpender: nativeInput ? quote.transactionTarget : configuration.allowanceHolder,
    approvalRequired: approvalData !== null, sufficientBalance: sufficientSellBalance,
    allowanceAtomic: nativeInput ? "0" : (quote.allowanceActualAtomic !== null && BigInt(quote.allowanceActualAtomic) < tokenAllowance! ? quote.allowanceActualAtomic : tokenAllowance!.toString()),
    balanceAtomic: quote.balanceActualAtomic ?? (nativeInput ? balance.toString() : tokenBalance!.toString()),
    route: "aggregated", fees: [], pools: [], deadline: request.deadlineSeconds.toString(),
    calldataHash: keccak256(quote.calldata), nextAction: status === "verified" ? "swap" : status === "approval_required" ? "approval" : null,
    nextActionTarget: status === "verified" || status === "approval_required" ? nextTarget : null,
    nextActionCalldataHash: status === "verified" || status === "approval_required" ? keccak256(nextData) : null,
    transactionValueAtomic: (approvalData ? 0n : BigInt(quote.transactionValueAtomic)).toString(),
    nativeBalanceWei: balance.toString(), gasPriceWei: quotedGasPrice.toString(), feeCeilingWei: feeCeiling.toString(),
    estimatedGasUnits: estimatedGas.toString(), gasLimitUnits: gasLimit.toString(), estimatedNetworkCostWei: estimatedNetworkCost.toString(),
    estimatedNetworkCostUsdgAtomic: null, networkCostValuationSource: null, networkCostValuedAtMs: null, networkCostValuationExpiresAtMs: null,
    gasState: enoughNative ? "sufficient" : "insufficient", routerRuntimeHash: targetRuntimeHash, factoryRuntimeHash: null,
    quoterRuntimeHash: null, exactSimulationPassed, userPaysGas: true, rmtFeeEnabled: true,
    settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE, providerNativeFee,
    approvalKind: approvalData ? "erc20_to_allowance_holder" : null,
    transactionData: quote.calldata, swapTransactionValueAtomic: quote.transactionValueAtomic,
    providerFeeAsset: quote.providerFee?.asset ?? null, providerFeeAtomic: quote.providerFee?.amountAtomic ?? null,
    providerQuoteId: quote.zid, blockNumber: quote.blockNumber, providerSimulationIncomplete: quote.simulationIncomplete,
    strictVerificationAvailable: true, walletAuthorizationAvailable: true, admissionReady: status === "verified",
    verifiedAtMs, expiresAtMs: observedAtMs + EVIDENCE_TTL_MS, authorizationReady: status === "verified"
  };
}

export async function prepareZeroXSwapAuthorization(request: VNextProviderAuthorizationRequest): Promise<VNextPreparedProviderAuthorization> {
  const evidence = await verifyZeroXSwapFirmQuote(request);
  if (BigInt(evidence.protectedOutputAtomic) < request.protectedOutputFloorAtomic) throw new Error("0x firm quote weakened the accepted protected output; requote and retry.");
  if (evidence.status !== "verified" && evidence.status !== "approval_required") throw new Error("0x exact next action is not ready; requote and retry.");
  if (evidence.status === "approval_required") {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [evidence.approvalSpender, request.amountIn] });
    return { evidence, transaction: { kind: "erc20_approval", target: request.inputAsset, data, value: "0", gasLimit: evidence.gasLimitUnits!, ...(evidence.providerNativeFee!.firmQuote!.gasPriceWei !== null ? { gasPrice: evidence.providerNativeFee!.firmQuote!.gasPriceWei } : {}) } };
  }
  return { evidence, transaction: { kind: "swap", target: evidence.router, data: evidence.transactionData, value: evidence.swapTransactionValueAtomic, gasLimit: evidence.gasLimitUnits!, ...(evidence.providerNativeFee!.firmQuote!.gasPriceWei !== null ? { gasPrice: evidence.providerNativeFee!.firmQuote!.gasPriceWei } : {}) } };
}
