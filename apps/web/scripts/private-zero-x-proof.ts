import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getAddress, zeroAddress } from "viem";
import { vNextZeroXSwapAdapter } from "../lib/server/vnext-zero-x-adapter";
import { verifyZeroXSwapFirmQuote, zeroXSwapFirmQuoteVerificationConfiguration, ZeroXRepriceRequiredError, type ZeroXFirmDiagnostic } from "../lib/server/vnext-zero-x-firm-quote-verifier";
import { quoteVNextExecutionProviders, verifyVNextExecutionProvider, type VNextProviderQuoteRequest } from "../lib/server/vnext-provider-adapter";
import { requireVNextPublicExecutionSettlement } from "../lib/server/vnext-public-execution-provider-scope";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../lib/vnext/execution-settlement";
import { RMT_ZERO_X_FEE_BPS, RMT_ZERO_X_FEE_TREASURY, zeroXIntegratorFeeAmount } from "../lib/vnext/zero-x-settlement";
import { TRUSTED_ASSET_ADDRESSES } from "../lib/vnext/trusted-asset-registry";
import { TradeExecutionFailure } from "../lib/vnext/trade-failure";

// No dotenv/env pull, credential transfer, endpoint, signer or authorization call.
// Execute only inside an already-authorized server environment, never in a browser.
const atomic = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) ? v : null;
const address = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? getAddress(v) : null;
const hash = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v) ? v.toLowerCase() : null;
const quantity = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v) ? v : null;

export function privateProofConfiguration() {
  const failures: string[] = [];
  const key = process.env.RMT_ZEROX_API_KEY?.trim();
  if (!key) failures.push("ZEROX_CREDENTIAL_MISSING");
  else if (!/^[\x21-\x7e]{1,512}$/.test(key)) failures.push("ZEROX_CREDENTIAL_MALFORMED");
  if (process.env.RMT_VNEXT_ZEROX_OBSERVATION_ENABLED !== "true") failures.push("OBSERVATION_DISABLED");
  if (!zeroXSwapFirmQuoteVerificationConfiguration()) failures.push("FIRM_CONFIGURATION_MISSING_OR_MALFORMED");
  try { requireVNextPublicExecutionSettlement("zero-x-swap", VNEXT_PROVIDER_NATIVE_INPUT_FEE); }
  catch { failures.push("PUBLIC_PROVIDER_SCOPE_MISMATCH"); }
  // Validate every supplied override without emitting even its host/path.
  const rpcNames = ["RMT_RPC_URL", "RMT_MAINNET_RPC_URL", "ROBINHOOD_MAINNET_RPC_URL", "NEXT_PUBLIC_RMT_RPC_URL"] as const;
  for (const name of rpcNames) {
    if (process.env[name] === undefined) continue;
    try {
      const url = new URL(process.env[name]!.trim());
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    } catch { failures.push("RPC_CONFIGURATION_MALFORMED"); break; }
  }
  return { status: failures.length ? "BLOCKED" : "READY", failures,
    credential: key ? "PRESENT_VALIDITY_UNPROVEN" : "MISSING",
    executionRpc: rpcNames.some(name => Boolean(process.env[name]?.trim())) ? "EXISTING_OVERRIDE" : "EXISTING_PUBLIC_DEFAULT" };
}

export function privateProofFailure(cause: unknown) {
  if (cause instanceof ZeroXRepriceRequiredError) return "REPRICE_REQUIRED";
  if (!(cause instanceof TradeExecutionFailure)) return "FIRM_QUOTE_REJECTED";
  const codes = {
    NO_ROUTE: "NO_ROUTE", RATE_LIMITED: "RATE_LIMITED", PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
    RPC_UNAVAILABLE: "RPC_UNAVAILABLE", CONTRACT_VERSION_UNSUPPORTED: "RUNTIME_REJECTED",
    SETTLER_UNREGISTERED: "SETTLER_UNREGISTERED", SETTLER_REGISTRY_UNAVAILABLE: "SETTLER_REGISTRY_UNAVAILABLE",
    PROVIDER_POLICY_REJECTED: "FIRM_QUOTE_REJECTED", EXECUTION_ENVELOPE_REJECTED: "FIRM_QUOTE_REJECTED",
    QUOTE_EXPIRED: "QUOTE_EXPIRED"
  } as const;
  return Object.hasOwn(codes, cause.code) ? codes[cause.code as keyof typeof codes] : "FIRM_QUOTE_REJECTED";
}

// Both event producers and this last output boundary use explicit field allowlists.
export function safePrivateProofEvent(event: ZeroXFirmDiagnostic) {
  if (event.kind === "http") return { httpStatus: Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : null };
  if (event.kind === "simulation") return { RMTExactSimulationState: event.state === "PASS" ? "PASS" : "FAILED" };
  if (event.kind === "deployment") {
    const e = event.evidence;
    return { block: quantity(e.block), blockHash: hash(e.blockHash), blockTimestamp: quantity(e.blockTimestamp),
      registryCurrent: address(e.current), registryPrevious: address(e.previous), quotedSettler: address(e.target),
      quotedRuntimeHash: hash(e.runtimeHash), runtimeAdmitted: e.runtimeAdmitted === true };
  }
  return { allowanceTarget: address(event.allowanceTarget), transactionTarget: address(event.transactionTarget),
    transactionValue: atomic(event.transactionValue), calldataHash: hash(event.calldataHash), decodedSettler: address(event.decodedSettler),
    protectedExecutableMinimum: atomic(event.protectedExecutableMinimum), providerFeeAsset: address(event.providerFeeAsset),
    providerFeeAmount: atomic(event.providerFeeAmount), providerSimulationState: event.providerSimulationIncomplete === false ? "COMPLETE" : "INCOMPLETE",
    providerInsufficientBalance: event.providerInsufficientBalance === true, providerInsufficientAllowance: event.providerInsufficientAllowance === true };
}

/** Actual adapter + verifier, with the same indicative floor and chain deadline. No commitment is created. */
export async function observePrivateZeroXCase(request: VNextProviderQuoteRequest) {
  if (privateProofConfiguration().status !== "READY") throw new Error("PRIVATE_PROOF_CONFIGURATION_BLOCKED");
  const record = {
    chainId: request.chainId, sellAsset: request.inputAsset, buyAsset: request.outputAsset,
    taker: request.recipient, recipient: request.recipient, grossSellAmount: request.inputAmountAtomic,
    RMTFeeBps: RMT_ZERO_X_FEE_BPS, RMTFeeAsset: request.inputAsset,
    RMTFeeAmount: zeroXIntegratorFeeAmount(request.inputAmountAtomic), feeEvidence: "REQUEST_ONLY",
    indicativeStatus: "NOT_TESTED", firmStatus: "NOT_TESTED", failureClass: null as string | null,
    RMTExactSimulationState: "NOT_RUN", firmQuote: null as ReturnType<typeof safePrivateProofEvent> | null,
    deployment: null as ReturnType<typeof safePrivateProofEvent> | null,
    firmHttpStatus: null as number | null, startedAt: new Date().toISOString(), completedAt: ""
  };
  try {
    const [price] = await quoteVNextExecutionProviders(request, [vNextZeroXSwapAdapter]);
    record.indicativeStatus = price.status === "indicative" ? "INDICATIVE_ROUTE_AVAILABLE"
      : price.status === "no_route" ? "NO_ROUTE" : price.status === "invalid_response" ? "PRICE_REJECTED" : "PROVIDER_UNAVAILABLE";
    if (price.status !== "indicative" || !price.protectedOutputAtomic) {
      record.failureClass = "INDICATIVE_FLOOR_UNAVAILABLE";
      return record; // Never invent a floor just to obtain a firm quote.
    }
    const { readVNextAuthorizationChainTimestamp, VNEXT_AUTHORIZATION_WINDOW_SECONDS } = await import("../lib/server/vnext-authorization-time");
    const deadline = await readVNextAuthorizationChainTimestamp();
    if (Date.now() >= price.expiresAtMs!) { record.failureClass = "QUOTE_EXPIRED"; return record; }
    const observer = (event: ZeroXFirmDiagnostic) => {
      if (event.kind === "http") {
        record.firmHttpStatus = event.status;
        record.firmStatus = event.status >= 200 && event.status < 300 ? "FIRM_QUOTE_RETURNED" : "FIRM_QUOTE_REJECTED";
      } else if (event.kind === "simulation") {
        record.RMTExactSimulationState = event.state;
      } else if (event.kind === "quote") {
        record.firmQuote = safePrivateProofEvent(event);
        record.feeEvidence = "VALIDATED_FIRM_QUOTE_NOT_SETTLEMENT";
      } else record.deployment = safePrivateProofEvent(event);
    };
    const evidence = await verifyVNextExecutionProvider("zero-x-swap", {
      ...request, indicativeProtectedOutputFloorAtomic: BigInt(price.protectedOutputAtomic),
      settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE, deadlineSeconds: deadline + VNEXT_AUTHORIZATION_WINDOW_SECONDS, nowMs: Date.now()
    }, [{ ...vNextZeroXSwapAdapter, verify: input => verifyZeroXSwapFirmQuote(input, observer) }]);
    const statuses = { verified: "VERIFIED", approval_required: "INSUFFICIENT_ALLOWANCE", insufficient_balance: "INSUFFICIENT_BALANCE",
      insufficient_gas: "INSUFFICIENT_GAS", simulation_failed: "SIMULATION_FAILED" } as const;
    record.failureClass = Object.hasOwn(statuses, evidence.status) ? statuses[evidence.status as keyof typeof statuses] : "FIRM_QUOTE_REJECTED";
  } catch (cause) {
    record.failureClass = privateProofFailure(cause);
    if (record.firmStatus === "FIRM_QUOTE_REJECTED" && ["NO_ROUTE", "RATE_LIMITED", "PROVIDER_UNAVAILABLE"].includes(record.failureClass)) record.firmStatus = record.failureClass;
  }
  finally { record.completedAt = new Date().toISOString(); }
  return record;
}

export async function runPrivateZeroXProof() {
  const configuration = privateProofConfiguration();
  const report = { schema: "RMT_PRIVATE_CURRENT_QUOTE_PROOF_V1", evidenceClass: "NOT_TESTED",
    startedAt: new Date().toISOString(), configuration, status: "BLOCKED", cases: [] as Record<string, unknown>[],
    authorizations: 0, walletRequests: 0, signatures: 0, approvals: 0, transactions: 0,
    sourceAttestation: "HASHED_SOURCE_FILES_NOT_FULL_DEPLOYMENT_ATTESTATION", sourceFilesSha256: {} as Record<string, string>,
    firmQuotesReturned: 0, diagnosticHeaderReadsPerFirm: 2 };
  if (configuration.status !== "READY") return report;
  // Hash the bytes executing here, independently comparable with the reviewed Git tree.
  // This deliberately does not assert that every transitive dependency/uploaded byte matches.
  for (const path of ["scripts/private-zero-x-proof.ts", "lib/server/vnext-zero-x-adapter.ts",
    "lib/server/vnext-zero-x-firm-quote-verifier.ts", "lib/server/vnext-zero-x-deployment-authority.ts",
    "lib/server/vnext-zero-x-execution-decoder.ts", "lib/server/vnext-provider-adapter.ts", "lib/vnext/zero-x-settlement.ts"]) {
    report.sourceFilesSha256[path] = createHash("sha256").update(await readFile(new URL(`../${path}`, import.meta.url))).digest("hex");
  }
  report.evidenceClass = "READ_ONLY_LIVE";
  const { readVNextVerifiedAssetIdentity } = await import("../lib/server/vnext-asset-identity");
  const { requireProjectIdentityExecutionAdmitted } = await import("../lib/server/project-identity-admission");
  const { requireVNextStockTokenExecutionEligible } = await import("../lib/server/robinhood-stock-token-registry");
  // Previously used public read-only identity; no claim that it owns spendable assets.
  const recipient = getAddress(RMT_ZERO_X_FEE_TREASURY);
  const usdg = TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG;
  const weth = TRUSTED_ASSET_ADDRESSES.ROBINHOOD_WETH;
  for (const [direction, inputAsset, outputAsset, amount] of [
    ["ETH_TO_ERC20", zeroAddress, usdg, "1000000000000000"],
    ["ERC20_TO_ETH", usdg, zeroAddress, "5000000"],
    ["ERC20_TO_ERC20", usdg, weth, "5000000"]
  ] as const) {
    let stage = "IDENTITY";
    try {
      const inputIdentity = await readVNextVerifiedAssetIdentity(inputAsset);
      const outputIdentity = await readVNextVerifiedAssetIdentity(outputAsset);
      if (!inputIdentity || !outputIdentity) throw new Error();
      stage = "PROJECT_IDENTITY";
      const candidates = [inputIdentity, outputIdentity].filter(i => !i.native).map(i => ({ address: i.address, verifiedIdentity: i }));
      const revalidations: (() => Promise<void>)[] = [];
      await requireProjectIdentityExecutionAdmitted(candidates, work => { revalidations.push(work); });
      // Own and await the existing bounded revalidation before this one-shot exits.
      for (const work of revalidations) await work();
      await requireProjectIdentityExecutionAdmitted(candidates, () => {});
      stage = "STOCK_TOKEN_POLICY";
      await requireVNextStockTokenExecutionEligible({ inputAsset, outputAsset });
      stage = "QUOTE";
      report.cases.push({ direction, ...await observePrivateZeroXCase({ chainId: 4663, inputAsset, outputAsset,
        inputAmountAtomic: amount, amountIn: BigInt(amount), recipient, inputIdentity, outputIdentity }) });
    } catch { report.cases.push({ direction, status: "NOT_TESTED", failureClass: `${stage}_BLOCKED` }); }
  }
  report.firmQuotesReturned = report.cases.filter(item => item.firmStatus === "FIRM_QUOTE_RETURNED").length;
  report.status = report.firmQuotesReturned > 0 ? "BOUNDED_OBSERVATION_COMPLETE" : "BLOCKED_NO_FIRM_QUOTES";
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const finish = (report: unknown, code: number) => process.stdout.write(`${JSON.stringify(report)}\n`, () => process.exit(code));
  // No accidental network execution on import or from a package/build lifecycle.
  if (process.argv.length !== 3 || process.argv[2] !== "--execute-read-only") {
    finish({ status: "NOT_RUN", requiredArgument: "--execute-read-only", configuration: privateProofConfiguration() }, 1);
  } else {
    // Hard process lifetime bounds orphaned provider reads; never schedules a rerun.
    setTimeout(() => { finish({ status: "PROOF_DEADLINE_EXCEEDED" }, 1); }, 180_000);
    void runPrivateZeroXProof().then(report => {
      finish(report, report.status === "BOUNDED_OBSERVATION_COMPLETE" ? 0 : 1);
    }, () => { finish({ status: "PROOF_FAILED_SANITIZED" }, 1); });
  }
}
