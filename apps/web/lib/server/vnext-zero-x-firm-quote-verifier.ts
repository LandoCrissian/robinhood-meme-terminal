import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
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
  RMT_ZERO_X_MAX_SLIPPAGE_PPM,
  RMT_ZERO_X_PROVIDER_REQUEST_SLIPPAGE_PPM,
  toZeroXToken,
  zeroXFeeAsset,
  zeroXMinimumRespectsSlippage
} from "../vnext/zero-x-settlement";
import { isCanonicalZeroXAllowanceHolder, RMT_ZERO_X_CANONICAL_ALLOWANCE_HOLDER } from "../vnext/zero-x-authority";
import { TradeExecutionFailure } from "../vnext/trade-failure";
import { committedZeroXAuthorizationEvidence } from "./vnext-zero-x-firm-quote-commitment";

export class ZeroXRepriceRequiredError extends Error {
  constructor() { super("Price moved. Review the refreshed quote."); }
}

const ZERO_X_API_URL = "https://api.0x.org";
const ZERO_X_TIMEOUT_MS = 4_000;
const APPROVAL_GAS_TIMEOUT_MS = 8_000;
const EVIDENCE_TTL_MS = 10_000;
const DEFAULT_ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com/";

type JsonObject = Record<string, unknown>;
type ZeroXFee = { asset: Address; amountAtomic: string };
type ZeroXSwapFirmQuoteVerificationConfiguration = { allowanceHolder: Address };

type ParsedFirmQuote = {
  quotedIntegratorFeeAtomic: string;
  allowanceActualAtomic: string | null;
  allowanceSpender: Address | null;
  balanceActualAtomic: string | null;
  blockNumber: string | null;
  providerReportedMinBuyAmount: string;
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
  providerRequestedSlippagePpm: typeof RMT_ZERO_X_PROVIDER_REQUEST_SLIPPAGE_PPM;
  maximumUserSlippagePpm: typeof RMT_ZERO_X_MAX_SLIPPAGE_PPM;
  providerReportedMinBuyAmount: string;
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

class ZeroXInvalidResponseError extends TradeExecutionFailure {
  constructor(_detail: string) { super("PROVIDER_POLICY_REJECTED"); }
}

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
    if (!isObject(value) || typeof value.token !== "string" || !isAddress(value.token, { strict: false }) || nonNegativeAtomic(value.amount) === null) {
      throw new ZeroXInvalidResponseError("0x returned an invalid integrator fee.");
    }
    if (value.type !== undefined && value.type !== "volume") throw new ZeroXInvalidResponseError("0x returned an invalid integrator fee type.");
    const token = fromZeroXToken(value.token);
    const amount = value.amount as string;
    if (token !== zeroXFeeAsset(request.inputAsset, request.outputAsset)) throw new ZeroXInvalidResponseError("0x returned the integrator fee in the wrong token.");
    if (token === request.inputAsset && BigInt(amount) >= request.amountIn) throw new ZeroXInvalidResponseError("0x returned an invalid fee disclosure.");
    return `${token}:${amount}:${String(value.type ?? "")}`;
  };
  const singularKey = singular.map(parse)[0] ?? null;
  const pluralKey = plural.map(parse)[0] ?? null;
  if (!singularKey && !pluralKey) throw new ZeroXInvalidResponseError("0x omitted the RMT integrator fee.");
  if (singularKey && pluralKey && singularKey !== pluralKey) throw new ZeroXInvalidResponseError("0x returned contradictory integrator fees.");
  return (singularKey ?? pluralKey)!.split(":")[1];
}

export function zeroXSwapFirmQuoteVerificationConfiguration(): ZeroXSwapFirmQuoteVerificationConfiguration | null {
  if (process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED !== "true") return null;
  const configuredAddress = process.env.RMT_ZEROX_ALLOWANCE_HOLDER?.trim();
  if (!isCanonicalZeroXAllowanceHolder(configuredAddress)) return null;
  return { allowanceHolder: RMT_ZERO_X_CANONICAL_ALLOWANCE_HOLDER };
}

function approvalRpcUrl() {
  return process.env.RMT_RPC_URL?.trim()
    || process.env.RMT_MAINNET_RPC_URL?.trim()
    || process.env.ROBINHOOD_MAINNET_RPC_URL?.trim()
    || process.env.NEXT_PUBLIC_RMT_RPC_URL?.trim()
    || DEFAULT_ROBINHOOD_RPC_URL;
}

async function estimateApprovalGas(account: Address, token: Address, data: Hex) {
  const response = await fetch(approvalRpcUrl(), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_estimateGas", params: [{ from: account, to: token, data, value: "0x0" }] }),
    cache: "no-store",
    signal: AbortSignal.timeout(APPROVAL_GAS_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isObject(body) || body.error !== undefined || typeof body.result !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.result) || BigInt(body.result) <= 0n) {
    throw new TradeExecutionFailure("RPC_UNAVAILABLE");
  }
  const estimate = BigInt(body.result);
  return { estimated: estimate, limit: (estimate * 120n + 99n) / 100n };
}

function parseFirmQuote(body: unknown, request: VNextProviderVerificationRequest, configuration: ZeroXSwapFirmQuoteVerificationConfiguration): ParsedFirmQuote {
  if (!isObject(body) || body.liquidityAvailable !== true) throw new ZeroXInvalidResponseError("0x did not return a complete firm quote.");
  if ((body.chainId !== undefined && body.chainId !== 4_663 && body.chainId !== "4663")
    || (body.taker !== undefined && (typeof body.taker !== "string" || getAddress(body.taker) !== request.recipient))
    || (body.recipient !== undefined && (typeof body.recipient !== "string" || getAddress(body.recipient) !== request.recipient))
  ) throw new ZeroXInvalidResponseError("0x changed the chain, taker or recipient binding.");

  const expectedOutputAtomic = positiveAtomic(body.buyAmount);
  const providerReportedMinBuyAmount = positiveAtomic(body.minBuyAmount);
  const networkFeeNativeAtomic = nonNegativeAtomic(body.totalNetworkFee);
  const nativeInput = request.inputAsset === zeroAddress;
  if (typeof body.sellToken !== "string" || fromZeroXToken(body.sellToken) !== request.inputAsset
    || typeof body.buyToken !== "string" || fromZeroXToken(body.buyToken) !== request.outputAsset
    || body.sellAmount !== request.inputAmountAtomic
    || (body.mode !== undefined && body.mode !== "exact-in")
    || !expectedOutputAtomic || !providerReportedMinBuyAmount || networkFeeNativeAtomic === null
    || !zeroXMinimumRespectsSlippage(expectedOutputAtomic, providerReportedMinBuyAmount)
  ) throw new ZeroXInvalidResponseError("0x changed the requested firm-quote economics.");

  const issues = isObject(body.issues) ? body.issues : null;
  if (!issues || (issues.simulationIncomplete !== undefined && typeof issues.simulationIncomplete !== "boolean")) {
    throw new ZeroXInvalidResponseError("0x returned invalid quote issues.");
  }
  const simulationIncomplete = issues.simulationIncomplete === true;
  const bodyAllowanceTarget = body.allowanceTarget;
  if (bodyAllowanceTarget != null && (typeof bodyAllowanceTarget !== "string" || !isAddress(bodyAllowanceTarget, { strict: false }) || !isCanonicalZeroXAllowanceHolder(bodyAllowanceTarget))) {
    throw new ZeroXInvalidResponseError("0x returned an unapproved AllowanceHolder.");
  }

  const allowance = issues.allowance;
  let allowanceActualAtomic: string | null = null;
  let allowanceSpender: Address | null = null;
  if (nativeInput && allowance != null) throw new ZeroXInvalidResponseError("0x returned an allowance issue for native ETH.");
  if (!nativeInput && allowance != null) {
    if (!isObject(allowance) || nonNegativeAtomic(allowance.actual) === null || typeof allowance.spender !== "string" || !isCanonicalZeroXAllowanceHolder(allowance.spender)) {
      throw new ZeroXInvalidResponseError("0x returned an invalid AllowanceHolder issue.");
    }
    allowanceSpender = getAddress(allowance.spender);
    allowanceActualAtomic = allowance.actual as string;
    if (BigInt(allowanceActualAtomic) >= request.amountIn) throw new ZeroXInvalidResponseError("0x returned a contradictory allowance issue.");
    if (bodyAllowanceTarget != null && getAddress(bodyAllowanceTarget as string) !== allowanceSpender) {
      throw new ZeroXInvalidResponseError("0x allowance target and issue spender disagree.");
    }
  }

  const balanceIssue = issues.balance;
  let balanceActualAtomic: string | null = null;
  if (balanceIssue != null) {
    if (!isObject(balanceIssue) || typeof balanceIssue.token !== "string" || fromZeroXToken(balanceIssue.token) !== request.inputAsset
      || nonNegativeAtomic(balanceIssue.actual) === null || balanceIssue.expected !== request.inputAmountAtomic) {
      throw new ZeroXInvalidResponseError("0x returned an invalid balance issue.");
    }
    balanceActualAtomic = balanceIssue.actual as string;
  }

  const fees = isObject(body.fees) ? body.fees : null;
  if (!fees) throw new ZeroXInvalidResponseError("0x omitted fee disclosure.");
  const quotedIntegratorFeeAtomic = parseIntegratorFee(fees, request);
  if (fees.gasFee != null) throw new ZeroXInvalidResponseError("0x returned a gas-sponsorship fee for a wallet-paid swap.");
  const providerFee = parseProviderFee(fees.zeroExFee, request);

  const transaction = isObject(body.transaction) ? body.transaction : null;
  const gasLimitUnits = transaction ? positiveAtomic(transaction.gas) : null;
  const gasPriceWei = transaction?.gasPrice === undefined || transaction.gasPrice === null ? null : positiveAtomic(transaction.gasPrice);
  const transactionValueAtomic = transaction ? nonNegativeAtomic(transaction.value) : null;
  if (!transaction || typeof transaction.to !== "string" || !isAddress(transaction.to, { strict: false }) || getAddress(transaction.to) === zeroAddress
    || typeof transaction.data !== "string" || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(transaction.data)
    || !gasLimitUnits || (transaction.gasPrice !== undefined && transaction.gasPrice !== null && !gasPriceWei) || transactionValueAtomic === null
    || (transaction.chainId !== undefined && transaction.chainId !== 4_663 && transaction.chainId !== "4663")
    || (transaction.from !== undefined && (typeof transaction.from !== "string" || getAddress(transaction.from) !== request.recipient))
    || (nativeInput ? transactionValueAtomic !== request.inputAmountAtomic : transactionValueAtomic !== "0")) {
    throw new ZeroXInvalidResponseError("0x returned an invalid transaction envelope.");
  }

  const blockNumber = body.blockNumber == null ? null : positiveAtomic(typeof body.blockNumber === "number" && Number.isSafeInteger(body.blockNumber) ? String(body.blockNumber) : body.blockNumber);
  if (body.blockNumber != null && !blockNumber) throw new ZeroXInvalidResponseError("0x returned an invalid quote block.");
  const zid = body.zid == null ? null : typeof body.zid === "string" && /^(?:0x[0-9a-fA-F]{1,128}|[A-Za-z0-9_-]{8,128})$/.test(body.zid) ? body.zid : null;
  if (body.zid != null && !zid) throw new ZeroXInvalidResponseError("0x returned an invalid quote identity.");
  return {
    quotedIntegratorFeeAtomic, allowanceActualAtomic, allowanceSpender, balanceActualAtomic, blockNumber,
    providerReportedMinBuyAmount, calldata: transaction.data as Hex, expectedOutputAtomic, gasLimitUnits,
    gasPriceWei, networkFeeNativeAtomic, protectedOutputAtomic: providerReportedMinBuyAmount, providerFee,
    simulationIncomplete, transactionTarget: getAddress(transaction.to), transactionValueAtomic, zid
  };
}

async function fetchFirmQuote(request: VNextProviderVerificationRequest) {
  const apiKey = process.env.RMT_ZEROX_API_KEY?.trim();
  if (!apiKey) throw new Error("0x server credential is not configured.");
  const url = new URL("/swap/allowance-holder/quote", ZERO_X_API_URL);
  url.search = new URLSearchParams({
    chainId: String(request.chainId),
    sellToken: toZeroXToken(request.inputAsset),
    buyToken: toZeroXToken(request.outputAsset),
    sellAmount: request.inputAmountAtomic,
    taker: request.recipient,
    recipient: request.recipient,
    slippagePpm: String(RMT_ZERO_X_PROVIDER_REQUEST_SLIPPAGE_PPM),
    swapFeeRecipient: RMT_ZERO_X_FEE_TREASURY,
    swapFeeBps: String(RMT_ZERO_X_FEE_BPS),
    swapFeeToken: toZeroXToken(zeroXFeeAsset(request.inputAsset, request.outputAsset))
  }).toString();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "0x-api-key": apiKey, "0x-version": "v2" },
    cache: "no-store",
    signal: AbortSignal.timeout(ZERO_X_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 400 && isObject(body) && body.name === "NO_LIQUIDITY_AVAILABLE") return null;
    throw new TradeExecutionFailure(response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_POLICY_REJECTED");
  }
  if (isObject(body) && body.liquidityAvailable === false) return null;
  return body;
}

export async function verifyZeroXSwapFirmQuote(request: VNextProviderVerificationRequest): Promise<ZeroXSwapFirmQuoteVerificationEvidence> {
  const configuration = zeroXSwapFirmQuoteVerificationConfiguration();
  if (!configuration) throw new Error("0x Swap firm-quote response validation is not configured.");
  if (request.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE || !request.nowMs) throw new Error("0x provider-native verification authority is incomplete.");
  if (request.chainId !== 4_663 || request.amountIn <= 0n || request.inputAmountAtomic !== request.amountIn.toString()
    || request.indicativeProtectedOutputFloorAtomic <= 0n || request.inputAsset === request.outputAsset
    || getAddress(request.recipient) === zeroAddress || request.executionId !== undefined
  ) throw new Error("RMT rejected an inconsistent 0x request binding.");

  const observedAtMs = Date.now();
  const body = await fetchFirmQuote(request);
  if (body === null) throw new TradeExecutionFailure("NO_ROUTE");
  const quote = parseFirmQuote(body, request, configuration);
  if (BigInt(quote.expectedOutputAtomic) < request.indicativeProtectedOutputFloorAtomic) throw new ZeroXRepriceRequiredError();

  const nativeInput = request.inputAsset === zeroAddress;
  const approvalData = quote.allowanceSpender
    ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [quote.allowanceSpender, request.amountIn] })
    : null;
  const approvalGas = approvalData ? await estimateApprovalGas(request.recipient, request.inputAsset, approvalData) : null;
  const nextGasLimit = approvalGas?.limit.toString() ?? quote.gasLimitUnits;
  const nextEstimatedGas = approvalGas?.estimated.toString() ?? quote.gasLimitUnits;
  const blockedByBalance = quote.balanceActualAtomic !== null;
  const status: ZeroXSwapFirmQuoteVerificationEvidence["status"] = blockedByBalance
    ? "insufficient_balance"
    : approvalData ? "approval_required" : "verified";
  const authorizationState = status === "approval_required" ? "approval_required" : status === "verified" ? "verified" : "blocked";
  const expiresAtMs = observedAtMs + EVIDENCE_TTL_MS;
  const deadline = BigInt(Math.ceil(expiresAtMs / 1_000)).toString();
  const providerNativeFee = createVNextZeroXProviderNativeFee({
    quotedFeeAmountAtomic: quote.quotedIntegratorFeeAtomic,
    inputAsset: request.inputAsset,
    outputAsset: request.outputAsset,
    userGrossInputAtomic: request.inputAmountAtomic,
    expectedOutputAtomic: quote.expectedOutputAtomic,
    protectedOutputAtomic: quote.protectedOutputAtomic,
    recipient: request.recipient,
    providerFeeAsset: quote.providerFee?.asset ?? null,
    providerFeeAtomic: quote.providerFee?.amountAtomic ?? null,
    transactionTarget: quote.transactionTarget,
    transactionCalldataHash: keccak256(quote.calldata),
    transactionValueAtomic: quote.transactionValueAtomic,
    authorizationState,
    firmQuote: {
      zid: quote.zid,
      observedAtMs,
      expiresAtMs,
      swapGasLimitUnits: quote.gasLimitUnits,
      nextActionGasLimitUnits: nextGasLimit,
      gasPriceWei: quote.gasPriceWei,
      allowanceTarget: quote.allowanceSpender,
      providerSimulationIncomplete: quote.simulationIncomplete,
      exactSimulationPassed: false,
      exactSimulationState: "not_run"
    }
  });
  const verifiedAtMs = Date.now();
  if (verifiedAtMs >= expiresAtMs) throw new Error("0x firm quote expired during validation; requote and retry.");
  const nextData = approvalData ?? quote.calldata;
  const nextTarget = approvalData ? request.inputAsset : quote.transactionTarget;
  const impliedFeeCeiling = ((BigInt(quote.networkFeeNativeAtomic) + BigInt(quote.gasLimitUnits) - 1n) / BigInt(quote.gasLimitUnits)).toString();
  return {
    provider: "zero-x-swap",
    status,
    chainId: 4_663,
    inputAsset: request.inputAsset,
    outputAsset: request.outputAsset,
    inputAmountAtomic: request.inputAmountAtomic,
    indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic.toString(),
    expectedOutputAtomic: quote.expectedOutputAtomic,
    protectedOutputAtomic: quote.protectedOutputAtomic,
    recipient: request.recipient,
    router: quote.transactionTarget,
    approvalSpender: quote.allowanceSpender ?? configuration.allowanceHolder,
    approvalRequired: approvalData !== null,
    sufficientBalance: !blockedByBalance,
    allowanceAtomic: nativeInput ? "0" : quote.allowanceActualAtomic,
    balanceAtomic: quote.balanceActualAtomic,
    route: "aggregated",
    fees: [],
    pools: [],
    deadline,
    calldataHash: keccak256(quote.calldata),
    nextAction: status === "verified" ? "swap" : status === "approval_required" ? "approval" : null,
    nextActionTarget: status === "verified" || status === "approval_required" ? nextTarget : null,
    nextActionCalldataHash: status === "verified" || status === "approval_required" ? keccak256(nextData) : null,
    transactionValueAtomic: approvalData ? "0" : quote.transactionValueAtomic,
    nativeBalanceWei: null,
    gasPriceWei: quote.gasPriceWei,
    feeCeilingWei: quote.gasPriceWei ?? impliedFeeCeiling,
    estimatedGasUnits: nextEstimatedGas,
    gasLimitUnits: nextGasLimit,
    estimatedNetworkCostWei: approvalData ? null : quote.networkFeeNativeAtomic,
    estimatedNetworkCostUsdgAtomic: null,
    networkCostValuationSource: null,
    networkCostValuedAtMs: null,
    networkCostValuationExpiresAtMs: null,
    gasState: "not_checked",
    routerRuntimeHash: null,
    factoryRuntimeHash: null,
    quoterRuntimeHash: null,
    exactSimulationPassed: false,
    exactSimulationState: "not_run",
    userPaysGas: true,
    rmtFeeEnabled: true,
    settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE,
    providerNativeFee,
    approvalKind: approvalData ? "erc20_to_allowance_holder" : null,
    providerRequestedSlippagePpm: RMT_ZERO_X_PROVIDER_REQUEST_SLIPPAGE_PPM,
    maximumUserSlippagePpm: RMT_ZERO_X_MAX_SLIPPAGE_PPM,
    providerReportedMinBuyAmount: quote.providerReportedMinBuyAmount,
    transactionData: quote.calldata,
    swapTransactionValueAtomic: quote.transactionValueAtomic,
    providerFeeAsset: quote.providerFee?.asset ?? null,
    providerFeeAtomic: quote.providerFee?.amountAtomic ?? null,
    providerQuoteId: quote.zid,
    blockNumber: quote.blockNumber,
    providerSimulationIncomplete: quote.simulationIncomplete,
    strictVerificationAvailable: true,
    walletAuthorizationAvailable: true,
    admissionReady: status === "verified",
    verifiedAtMs,
    expiresAtMs,
    authorizationReady: status === "verified"
  };
}

export async function prepareZeroXSwapAuthorization(request: VNextProviderAuthorizationRequest): Promise<VNextPreparedProviderAuthorization> {
  const evidence = committedZeroXAuthorizationEvidence(request);
  if (BigInt(evidence.protectedOutputAtomic) < request.protectedOutputFloorAtomic) throw new Error("0x firm quote weakened the accepted protected output; requote and retry.");
  if (evidence.status !== "verified" && evidence.status !== "approval_required") throw new Error("0x exact next action is not ready; requote and retry.");
  if (evidence.status === "approval_required") {
    const allowanceTarget = evidence.providerNativeFee?.firmQuote?.allowanceTarget;
    if (!allowanceTarget || !isCanonicalZeroXAllowanceHolder(allowanceTarget) || evidence.inputAsset === zeroAddress) {
      throw new Error("0x committed AllowanceHolder authority is unavailable or changed.");
    }
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [allowanceTarget, request.amountIn] });
    return {
      evidence,
      transaction: {
        kind: "erc20_approval",
        target: request.inputAsset,
        data,
        value: "0",
        gasLimit: evidence.gasLimitUnits!,
        ...(evidence.providerNativeFee!.firmQuote!.gasPriceWei !== null ? { gasPrice: evidence.providerNativeFee!.firmQuote!.gasPriceWei } : {})
      }
    };
  }
  return {
    evidence,
    transaction: {
      kind: "swap",
      target: evidence.router,
      data: evidence.transactionData,
      value: evidence.swapTransactionValueAtomic,
      gasLimit: evidence.gasLimitUnits!,
      ...(evidence.providerNativeFee!.firmQuote!.gasPriceWei !== null ? { gasPrice: evidence.providerNativeFee!.firmQuote!.gasPriceWei } : {})
    }
  };
}
