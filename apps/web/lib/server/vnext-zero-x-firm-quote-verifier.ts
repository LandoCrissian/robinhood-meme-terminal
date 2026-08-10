import { getAddress, isAddress, isHex, keccak256, type Address, type Hex } from "viem";
import type { VNextProviderVerificationRequest } from "./vnext-provider-adapter";

const ZERO_X_API_URL = "https://api.0x.org";
const ZERO_X_TIMEOUT_MS = 4_000;
const ZERO_X_RPC_TIMEOUT_MS = 8_000;
const EVIDENCE_TTL_MS = 10_000;
const DEFAULT_ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com/";

type JsonObject = Record<string, unknown>;

type ZeroXSwapFirmQuoteVerificationConfiguration = {
  allowanceHolder: Address;
  runtimeHash: Hex;
};

type ZeroXAllowanceIssue = {
  actualAtomic: string;
  spender: Address;
};

type ZeroXBalanceIssue = {
  actualAtomic: string;
  expectedAtomic: string;
  token: Address;
};

type ZeroXFirmQuote = {
  allowanceIssue: ZeroXAllowanceIssue | null;
  balanceIssue: ZeroXBalanceIssue | null;
  blockNumber: string;
  calldata: Hex;
  expectedOutputAtomic: string;
  gasLimitUnits: string;
  gasPriceWei: string;
  gasCostCeilingNativeAtomic: string;
  networkFeeNativeAtomic: string;
  protectedOutputAtomic: string;
  providerFee: { asset: Address; amountAtomic: string } | null;
  simulationIncomplete: boolean;
  transactionTarget: Address;
  transactionValueAtomic: string;
  zid: string | null;
};

export type ZeroXSwapFirmQuoteVerificationEvidence = {
  provider: "zero-x-swap";
  status:
    | "envelope_verified"
    | "approval_required"
    | "insufficient_balance"
    | "insufficient_gas"
    | "provider_simulation_incomplete"
    | "simulation_failed";
  chainId: 4_663;
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  indicativeProtectedOutputFloorAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  requestedRecipient: Address;
  allowanceHolder: Address;
  transactionTarget: Address;
  approvalSpender: Address;
  calldataHash: Hex;
  gasLimitUnits: string;
  gasPriceWei: string;
  gasCostCeilingNativeAtomic: string;
  networkFeeNativeAtomic: string;
  transactionValueAtomic: string;
  providerFeeAsset: Address | null;
  providerFeeAtomic: string | null;
  providerQuoteId: string | null;
  blockNumber: string;
  allowanceActualAtomic: string | null;
  balanceActualAtomic: string | null;
  providerRuntimeHash: Hex;
  providerSimulationIncomplete: boolean;
  exactTransactionSimulationPassed: boolean;
  recipientCalldataDecoded: false;
  outputCalldataDecoded: false;
  strictVerificationAvailable: false;
  walletAuthorizationAvailable: false;
  admissionReady: false;
  rmtFeeEnabled: false;
  userPaysGas: true;
  verifiedAtMs: number;
  expiresAtMs: number;
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

function optionalFee(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || typeof value.token !== "string" || !isAddress(value.token) || !positiveAtomic(value.amount)) {
    throw new ZeroXInvalidResponseError("0x returned an invalid fee.");
  }
  return { asset: getAddress(value.token), amountAtomic: value.amount as string };
}

function integratorFeePresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(integratorFeePresent);
  if (!isObject(value)) throw new ZeroXInvalidResponseError("0x returned an invalid integrator fee.");
  if (value.amount === null || value.amount === undefined) return false;
  const amount = nonNegativeAtomic(value.amount);
  if (amount === null) throw new ZeroXInvalidResponseError("0x returned an invalid integrator fee.");
  return BigInt(amount) > 0n;
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
  if (!response.ok || !isObject(body) || body.error !== undefined || body.result === undefined) {
    throw new Error(`Robinhood RPC ${method} failed.`);
  }
  return body.result;
}

export function zeroXSwapFirmQuoteVerificationConfiguration(): ZeroXSwapFirmQuoteVerificationConfiguration | null {
  if (process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED !== "true") return null;
  const configuredAddress = process.env.RMT_ZEROX_ALLOWANCE_HOLDER?.trim();
  const configuredHash = process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH?.trim();
  if (
    !configuredAddress
    || !isAddress(configuredAddress, { strict: false })
    || /^0x0{40}$/i.test(configuredAddress)
    || !configuredHash
    || !/^0x[0-9a-fA-F]{64}$/.test(configuredHash)
  ) return null;
  return {
    allowanceHolder: getAddress(configuredAddress),
    runtimeHash: configuredHash.toLowerCase() as Hex
  };
}

async function requireRuntime(configuration: ZeroXSwapFirmQuoteVerificationConfiguration) {
  const result = await rpc("eth_getCode", [configuration.allowanceHolder, "latest"]);
  if (typeof result !== "string" || !isHex(result) || result === "0x" || keccak256(result as Hex) !== configuration.runtimeHash) {
    throw new Error("0x AllowanceHolder runtime bytecode is not approved.");
  }
  return configuration.runtimeHash;
}

async function nativeBalance(address: Address) {
  const result = await rpc("eth_getBalance", [address, "latest"]);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]+$/.test(result)) {
    throw new Error("Robinhood RPC returned an invalid native balance.");
  }
  return BigInt(result);
}

async function simulate(input: {
  account: Address;
  target: Address;
  calldata: Hex;
  valueAtomic: string;
  gasLimitUnits: string;
  gasPriceWei: string;
}) {
  await rpc("eth_call", [{
    from: input.account,
    to: input.target,
    data: input.calldata,
    value: `0x${BigInt(input.valueAtomic).toString(16)}`,
    gas: `0x${BigInt(input.gasLimitUnits).toString(16)}`,
    gasPrice: `0x${BigInt(input.gasPriceWei).toString(16)}`
  }, "latest"]);
}

function parseAllowanceIssue(value: unknown, allowanceHolder: Address): ZeroXAllowanceIssue | null {
  if (value === null) return null;
  if (
    !isObject(value)
    || !nonNegativeAtomic(value.actual)
    || typeof value.spender !== "string"
    || !isAddress(value.spender)
    || getAddress(value.spender) !== allowanceHolder
  ) throw new ZeroXInvalidResponseError("0x returned an invalid allowance issue.");
  return { actualAtomic: value.actual as string, spender: allowanceHolder };
}

function parseBalanceIssue(value: unknown, request: VNextProviderVerificationRequest): ZeroXBalanceIssue | null {
  if (value === null) return null;
  if (
    !isObject(value)
    || typeof value.token !== "string"
    || !isAddress(value.token)
    || getAddress(value.token) !== request.inputAsset
    || !nonNegativeAtomic(value.actual)
    || value.expected !== request.inputAmountAtomic
  ) throw new ZeroXInvalidResponseError("0x returned an invalid balance issue.");
  return {
    actualAtomic: value.actual as string,
    expectedAtomic: request.inputAmountAtomic,
    token: request.inputAsset
  };
}

function parseFirmQuote(
  body: unknown,
  request: VNextProviderVerificationRequest,
  configuration: ZeroXSwapFirmQuoteVerificationConfiguration
): ZeroXFirmQuote {
  if (!isObject(body) || body.liquidityAvailable !== true) {
    throw new ZeroXInvalidResponseError("0x did not return a complete firm quote.");
  }
  const expectedOutputAtomic = positiveAtomic(body.buyAmount);
  const protectedOutputAtomic = positiveAtomic(body.minBuyAmount);
  const blockNumber = positiveAtomic(body.blockNumber);
  const networkFeeNativeAtomic = nonNegativeAtomic(body.totalNetworkFee);
  if (
    typeof body.sellToken !== "string" || !isAddress(body.sellToken) || getAddress(body.sellToken) !== request.inputAsset
    || typeof body.buyToken !== "string" || !isAddress(body.buyToken) || getAddress(body.buyToken) !== request.outputAsset
    || body.sellAmount !== request.inputAmountAtomic
    || (body.mode !== undefined && body.mode !== "exact-in")
    || !expectedOutputAtomic || !protectedOutputAtomic || !blockNumber || networkFeeNativeAtomic === null
    || BigInt(protectedOutputAtomic) > BigInt(expectedOutputAtomic)
    || BigInt(protectedOutputAtomic) < request.indicativeProtectedOutputFloorAtomic
  ) throw new ZeroXInvalidResponseError("0x changed the requested firm-quote economics.");

  if (
    typeof body.allowanceTarget !== "string"
    || !isAddress(body.allowanceTarget)
    || getAddress(body.allowanceTarget) !== configuration.allowanceHolder
  ) throw new ZeroXInvalidResponseError("0x returned an unapproved AllowanceHolder.");

  const fees = isObject(body.fees) ? body.fees : null;
  if (!fees || integratorFeePresent(fees.integratorFee) || integratorFeePresent(fees.integratorFees)) {
    throw new ZeroXInvalidResponseError("0x returned an unexpected integrator fee.");
  }
  if (fees.gasFee !== null && fees.gasFee !== undefined) {
    throw new ZeroXInvalidResponseError("0x returned a gas-sponsorship fee for a wallet-paid swap.");
  }
  const providerFee = optionalFee(fees.zeroExFee);

  const issues = isObject(body.issues) ? body.issues : null;
  if (
    !issues
    || typeof issues.simulationIncomplete !== "boolean"
    || !Array.isArray(issues.invalidSourcesPassed)
    || issues.invalidSourcesPassed.length !== 0
  ) throw new ZeroXInvalidResponseError("0x returned incomplete firm-quote validation evidence.");
  const allowanceIssue = parseAllowanceIssue(issues.allowance, configuration.allowanceHolder);
  const balanceIssue = parseBalanceIssue(issues.balance, request);

  const transaction = isObject(body.transaction) ? body.transaction : null;
  const gasLimitUnits = transaction ? positiveAtomic(transaction.gas) : null;
  const gasPriceWei = transaction ? positiveAtomic(transaction.gasPrice) : null;
  const transactionValueAtomic = transaction ? nonNegativeAtomic(transaction.value) : null;
  if (
    !transaction
    || typeof transaction.to !== "string"
    || !isAddress(transaction.to)
    || getAddress(transaction.to) !== configuration.allowanceHolder
    || typeof transaction.data !== "string"
    || !/^0x(?:[0-9a-fA-F]{2})+$/.test(transaction.data)
    || !gasLimitUnits || !gasPriceWei || transactionValueAtomic !== "0"
  ) throw new ZeroXInvalidResponseError("0x returned an invalid AllowanceHolder transaction envelope.");

  const transactionGasCost = BigInt(gasLimitUnits) * BigInt(gasPriceWei);
  const gasCostCeilingNativeAtomic = transactionGasCost > BigInt(networkFeeNativeAtomic)
    ? transactionGasCost.toString()
    : networkFeeNativeAtomic;

  return {
    allowanceIssue,
    balanceIssue,
    blockNumber,
    calldata: transaction.data as Hex,
    expectedOutputAtomic,
    gasLimitUnits,
    gasPriceWei,
    gasCostCeilingNativeAtomic,
    networkFeeNativeAtomic,
    protectedOutputAtomic,
    providerFee,
    simulationIncomplete: issues.simulationIncomplete,
    transactionTarget: configuration.allowanceHolder,
    transactionValueAtomic,
    zid: typeof body.zid === "string" && /^0x[0-9a-fA-F]+$/.test(body.zid) ? body.zid : null
  };
}

async function fetchFirmQuote(request: VNextProviderVerificationRequest) {
  const apiKey = process.env.RMT_ZEROX_API_KEY?.trim();
  if (!apiKey) throw new Error("0x server credential is not configured.");
  const url = new URL("/swap/allowance-holder/quote", ZERO_X_API_URL);
  url.search = new URLSearchParams({
    chainId: String(request.chainId),
    sellToken: request.inputAsset,
    buyToken: request.outputAsset,
    sellAmount: request.inputAmountAtomic,
    taker: request.recipient,
    recipient: request.recipient,
    slippageBps: "100"
  }).toString();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "0x-api-key": apiKey, "0x-version": "v2" },
    cache: "no-store",
    signal: AbortSignal.timeout(ZERO_X_TIMEOUT_MS)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 400 && isObject(body) && body.name === "NO_LIQUIDITY_AVAILABLE") return null;
    throw new Error(`0x firm-quote request failed with ${response.status}.`);
  }
  return body;
}

export async function verifyZeroXSwapFirmQuote(
  request: VNextProviderVerificationRequest
): Promise<ZeroXSwapFirmQuoteVerificationEvidence> {
  const configuration = zeroXSwapFirmQuoteVerificationConfiguration();
  if (!configuration) throw new Error("0x Swap firm-quote verification is not configured.");
  const [body, runtimeHash, balance] = await Promise.all([
    fetchFirmQuote(request),
    requireRuntime(configuration),
    nativeBalance(request.recipient)
  ]);
  if (body === null) throw new Error("No complete 0x Swap route is available for firm-quote verification.");
  const quote = parseFirmQuote(body, request, configuration);

  let status: ZeroXSwapFirmQuoteVerificationEvidence["status"];
  let exactTransactionSimulationPassed = false;
  if (quote.balanceIssue) {
    status = "insufficient_balance";
  } else if (quote.allowanceIssue) {
    status = "approval_required";
  } else if (quote.simulationIncomplete) {
    status = "provider_simulation_incomplete";
  } else if (balance < BigInt(quote.gasCostCeilingNativeAtomic)) {
    status = "insufficient_gas";
  } else {
    try {
      await simulate({
        account: request.recipient,
        target: quote.transactionTarget,
        calldata: quote.calldata,
        valueAtomic: quote.transactionValueAtomic,
        gasLimitUnits: quote.gasLimitUnits,
        gasPriceWei: quote.gasPriceWei
      });
      exactTransactionSimulationPassed = true;
      status = "envelope_verified";
    } catch {
      status = "simulation_failed";
    }
  }

  const verifiedAtMs = Date.now();
  return {
    provider: "zero-x-swap",
    status,
    chainId: request.chainId,
    inputAsset: request.inputAsset,
    outputAsset: request.outputAsset,
    inputAmountAtomic: request.inputAmountAtomic,
    indicativeProtectedOutputFloorAtomic: request.indicativeProtectedOutputFloorAtomic.toString(),
    expectedOutputAtomic: quote.expectedOutputAtomic,
    protectedOutputAtomic: quote.protectedOutputAtomic,
    requestedRecipient: request.recipient,
    allowanceHolder: configuration.allowanceHolder,
    transactionTarget: quote.transactionTarget,
    approvalSpender: configuration.allowanceHolder,
    calldataHash: keccak256(quote.calldata),
    gasLimitUnits: quote.gasLimitUnits,
    gasPriceWei: quote.gasPriceWei,
    gasCostCeilingNativeAtomic: quote.gasCostCeilingNativeAtomic,
    networkFeeNativeAtomic: quote.networkFeeNativeAtomic,
    transactionValueAtomic: quote.transactionValueAtomic,
    providerFeeAsset: quote.providerFee?.asset ?? null,
    providerFeeAtomic: quote.providerFee?.amountAtomic ?? null,
    providerQuoteId: quote.zid,
    blockNumber: quote.blockNumber,
    allowanceActualAtomic: quote.allowanceIssue?.actualAtomic ?? null,
    balanceActualAtomic: quote.balanceIssue?.actualAtomic ?? null,
    providerRuntimeHash: runtimeHash,
    providerSimulationIncomplete: quote.simulationIncomplete,
    exactTransactionSimulationPassed,
    recipientCalldataDecoded: false,
    outputCalldataDecoded: false,
    strictVerificationAvailable: false,
    walletAuthorizationAvailable: false,
    admissionReady: false,
    rmtFeeEnabled: false,
    userPaysGas: true,
    verifiedAtMs,
    expiresAtMs: verifiedAtMs + EVIDENCE_TTL_MS
  };
}
