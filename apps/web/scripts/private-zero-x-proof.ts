import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getAddress, keccak256, zeroAddress } from "viem";
import { vNextZeroXSwapAdapter } from "../lib/server/vnext-zero-x-adapter";
import { verifyZeroXSwapFirmQuote, zeroXSwapFirmQuoteVerificationConfiguration, ZeroXRepriceRequiredError, type ZeroXFirmDiagnostic, type ZeroXExecutableInspection } from "../lib/server/vnext-zero-x-firm-quote-verifier";
import { inspectActions, addressRole } from "./private-zero-x-actions";
import { ProofJsonl, installProofDeadline } from "./private-zero-x-jsonl";
import { quoteVNextExecutionProviders, verifyVNextExecutionProvider, type VNextProviderQuoteRequest } from "../lib/server/vnext-provider-adapter";
import { requireVNextPublicExecutionSettlement } from "../lib/server/vnext-public-execution-provider-scope";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../lib/vnext/execution-settlement";
import { RMT_ZERO_X_FEE_BPS, RMT_ZERO_X_FEE_TREASURY } from "../lib/vnext/zero-x-settlement";
import { TRUSTED_ASSET_ADDRESSES } from "../lib/vnext/trusted-asset-registry";
import { ExecutionEnvelopeFailure, TradeExecutionFailure } from "../lib/vnext/trade-failure";

// No dotenv/env pull, credential transfer, endpoint, signer or authorization call.
// Execute only inside an already-authorized server environment, never in a browser.
const atomic = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) ? v : null;
const address = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? getAddress(v) : null;
const hash = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v) ? v.toLowerCase() : null;
const quantity = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v) ? v : null;

export const CANNACAT_CASE = Object.freeze({ direction: "USDG_TO_CANNACAT",
  inputAsset: TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG,
  outputAsset: getAddress("0x1139d423C1706BDeaD91f03507F521635591eD92"), amount: "1000000" });

// Bound actual transport attempts; never retry to obtain a different route.
export function installPrivateProofReadBudget() {
  const original = globalThis.fetch;
  const counts = { price: 0, firm: 0, rpc: 0, otherReads: 0 };
  globalThis.fetch = async (raw, init) => {
    const url = new URL(String(raw));
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.origin === "https://api.0x.org") {
      const kind = url.pathname === "/swap/allowance-holder/quote" ? "firm" : url.pathname === "/swap/allowance-holder/price" ? "price" : null;
      if (!kind || method !== "GET" || counts[kind] >= 1
        || url.searchParams.get("chainId") !== "4663"
        || url.searchParams.get("sellToken")?.toLowerCase() !== CANNACAT_CASE.inputAsset.toLowerCase()
        || url.searchParams.get("buyToken")?.toLowerCase() !== CANNACAT_CASE.outputAsset.toLowerCase()
        || url.searchParams.get("sellAmount") !== CANNACAT_CASE.amount
        || url.searchParams.get("taker")?.toLowerCase() !== RMT_ZERO_X_FEE_TREASURY.toLowerCase()
        || url.searchParams.get("recipient")?.toLowerCase() !== RMT_ZERO_X_FEE_TREASURY.toLowerCase()) throw new Error("PRIVATE_PROOF_REQUEST_BLOCKED");
      counts[kind]++;
    } else if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      const calls = Array.isArray(body) ? body : [body];
      const allowed = ["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getBalance", "eth_gasPrice", "eth_estimateGas"];
      if (!calls.length || calls.length > 32 || counts.rpc + calls.length > 64
        || calls.some(c => c.jsonrpc !== "2.0" || !allowed.includes(c.method))) throw new Error("PRIVATE_PROOF_RPC_BLOCKED");
      counts.rpc += calls.length;
    } else {
      if (!["GET", "HEAD"].includes(method) || ++counts.otherReads > 16) throw new Error("PRIVATE_PROOF_READ_BLOCKED");
    }
    return original(raw, init);
  };
  return { counts, restore: () => { globalThis.fetch = original; } };
}

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
    PROVIDER_POLICY_REJECTED: "FIRM_QUOTE_REJECTED", EXECUTION_ENVELOPE_REJECTED: "EXECUTION_ENVELOPE_REJECTED",
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
export async function observePrivateZeroXCase(request: VNextProviderQuoteRequest, collectActions = false) {
  if (privateProofConfiguration().status !== "READY") throw new Error("PRIVATE_PROOF_CONFIGURATION_BLOCKED");
  const record = {
    chainId: request.chainId, sellAsset: request.inputAsset, buyAsset: request.outputAsset,
    taker: "USER_RECIPIENT", recipient: "USER_RECIPIENT", grossSellAmount: request.inputAmountAtomic,
    RMTFeeBps: RMT_ZERO_X_FEE_BPS, RMTFeeAsset: request.inputAsset,
    feeEvidence: "REQUEST_ONLY",
    indicativeStatus: "NOT_TESTED", firmStatus: "NOT_TESTED", failureClass: null as string | null,
    RMTExactSimulationState: "NOT_RUN", firmQuote: null as ReturnType<typeof safePrivateProofEvent> | null,
    deployment: null as ReturnType<typeof safePrivateProofEvent> | null,
    firmHttpStatus: null as number | null, startedAt: new Date().toISOString(), completedAt: "",
    actions: null as ReturnType<typeof inspectActions> | null, actionInspection: "NOT_OBSERVED",
    envelopeDiagnostic: null as ExecutionEnvelopeFailure["envelope"] | null,
    structuralQuote: null as { transactionTargetRole: string; allowanceRole: string | null; transactionValue: string | null; calldataHash: string } | null
  };
  const executable: { value: ZeroXExecutableInspection | null } = { value: null };
  let observedRuntime: string | null = null;
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
        record.feeEvidence = "QUOTED_FEE_NOT_ENCODED_VALIDATION_OR_SETTLEMENT";
      } else { record.deployment = safePrivateProofEvent(event); observedRuntime = event.evidence.runtimeHash; }
    };
    const evidence = await verifyVNextExecutionProvider("zero-x-swap", {
      ...request, indicativeProtectedOutputFloorAtomic: BigInt(price.protectedOutputAtomic),
      settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE, deadlineSeconds: deadline + VNEXT_AUTHORIZATION_WINDOW_SECONDS, nowMs: Date.now()
    }, [{ ...vNextZeroXSwapAdapter, verify: input => verifyZeroXSwapFirmQuote(input, observer, collectActions ? envelope => {
      if (envelope.data.length <= 524_288) executable.value = envelope;
      else record.actionInspection = "INPUT_SIZE_LIMIT";
    } : undefined) }]);
    const statuses = { verified: "VERIFIED", approval_required: "INSUFFICIENT_ALLOWANCE", insufficient_balance: "INSUFFICIENT_BALANCE",
      insufficient_gas: "INSUFFICIENT_GAS", simulation_failed: "SIMULATION_FAILED" } as const;
    record.failureClass = Object.hasOwn(statuses, evidence.status) ? statuses[evidence.status as keyof typeof statuses] : "FIRM_QUOTE_REJECTED";
  } catch (cause) {
    record.failureClass = privateProofFailure(cause);
    if (cause instanceof ExecutionEnvelopeFailure) record.envelopeDiagnostic = cause.envelope;
    if (record.firmStatus === "FIRM_QUOTE_REJECTED" && ["NO_ROUTE", "RATE_LIMITED", "PROVIDER_UNAVAILABLE"].includes(record.failureClass)) record.firmStatus = record.failureClass;
  }
  finally {
    if (executable.value) {
      const roles = { sell: request.inputAsset, buy: request.outputAsset, user: request.recipient, settler: zeroAddress };
      record.structuralQuote = { transactionTargetRole: addressRole(executable.value.target, roles),
        allowanceRole: executable.value.allowanceTarget ? addressRole(executable.value.allowanceTarget, roles) : null,
        transactionValue: executable.value.value === BigInt(request.recipient).toString() ? null : executable.value.value, calldataHash: keccak256(executable.value.data) };
      try {
        record.actions = inspectActions(executable.value, { sell: request.inputAsset, buy: request.outputAsset,
          user: request.recipient, settler: zeroAddress }, observedRuntime);
        record.actionInspection = "STRUCTURAL_ONLY_NOT_FEE_VALIDATION";
      } catch { record.actionInspection = "INSPECTION_FAILED_SANITIZED"; }
    }
    executable.value = null;
    record.completedAt = new Date().toISOString();
  }
  return record;
}

export function emitObservedCase(writer: ProofJsonl, record: Awaited<ReturnType<typeof observePrivateZeroXCase>>) {
  const quote = record.firmQuote && "decodedSettler" in record.firmQuote ? record.firmQuote : null;
  const roles = { sell: record.sellAsset, buy: record.buyAsset, user: RMT_ZERO_X_FEE_TREASURY,
    settler: quote?.decodedSettler ?? record.actions?.settler ?? zeroAddress };
  const role = (value: string | null | undefined) => value ? addressRole(value, roles) : null;
  const decodedSettler = quote?.decodedSettler ?? record.actions?.settler;
  const publicSettler = decodedSettler && decodedSettler.toLowerCase() !== roles.user.toLowerCase() ? decodedSettler : decodedSettler ? "USER_RECIPIENT" : null;
  const blockQuantity = (value: string | null | undefined) => value && /^0x[0-9a-f]{1,16}$/i.test(value) ? BigInt(value).toString() : null;
  const deployment = record.deployment && "quotedRuntimeHash" in record.deployment ? record.deployment : null;
  writer.emit("QUOTE", { chainId: 4663, user: "USER_RECIPIENT", grossSellAmount: record.grossSellAmount,
    rmtFeeBps: 25, rmtFeeTokenRole: record.sellAsset === zeroAddress ? "NATIVE_ETH" : "SELL_TOKEN",
    feeEvidence: record.feeEvidence, httpStatus: record.firmHttpStatus, failureClass: record.failureClass,
    allowanceRole: role(quote?.allowanceTarget) ?? record.structuralQuote?.allowanceRole ?? null, transactionTargetRole: role(quote?.transactionTarget) ?? record.structuralQuote?.transactionTargetRole ?? null,
    quotedSettler: publicSettler,
    transactionValue: quote?.transactionValue ?? record.structuralQuote?.transactionValue ?? null, calldataHash: quote?.calldataHash ?? record.structuralQuote?.calldataHash ?? null,
    minimum: quote?.protectedExecutableMinimum ?? null, providerFeeTokenRole: role(quote?.providerFeeAsset),
    providerFeeAmount: quote?.providerFeeAmount ?? null, providerFeeRecipient: "UNKNOWN_NOT_IN_RESPONSE",
    runtimeHash: deployment?.quotedRuntimeHash ?? null, runtimeAdmitted: deployment?.runtimeAdmitted ?? null,
    block: blockQuantity(deployment?.block), blockHash: deployment?.blockHash ?? null, blockTimestamp: blockQuantity(deployment?.blockTimestamp),
    registryCurrentRole: role(deployment?.registryCurrent), registryPreviousRole: role(deployment?.registryPrevious),
    actionCount: record.actions?.actionCount ?? null, actionInspection: record.actionInspection,
    providerSimulation: quote?.providerSimulationState ?? "UNKNOWN", exactSimulation: record.RMTExactSimulationState,
    envelopeReason: record.envelopeDiagnostic?.envelopeReason ?? null, envelopeFunction: record.envelopeDiagnostic?.envelopeFunction ?? null,
    actionIndex: record.envelopeDiagnostic?.actionIndex ?? null, actionKind: record.envelopeDiagnostic?.actionKind ?? null });
  if (record.actions) {
    for (const action of record.actions.records) { if (!writer.emit("ACTION", action)) break; }
    writer.emit("FINAL_MINIMUM", record.actions.final);
  }
  writer.endCase(record.failureClass ?? "UNKNOWN", record.actions?.actionCount ?? null,
    Boolean(record.actions && record.actions.omitted === 0 && record.actions.records.every(r => r.semanticsComplete === true)));
}

export async function runPrivateZeroXProof(writer = new ProofJsonl(() => {})) {
  const configuration = privateProofConfiguration();
  const report = { schema: "RMT_CANNACAT_ROUTE_PROOF_V1", evidenceClass: "NOT_TESTED",
    startedAt: new Date().toISOString(), configuration, status: "BLOCKED", cases: [] as Record<string, unknown>[],
    authorizations: 0, walletRequests: 0, signatures: 0, approvals: 0, transactions: 0,
    sourceAttestation: "HASHED_SOURCE_FILES_NOT_FULL_DEPLOYMENT_ATTESTATION", sourceFilesSha256: {} as Record<string, string>,
    firmQuotesReturned: 0, diagnosticHeaderReadsPerFirm: 2 };
  writer.emit("PROOF_START", { version: 1, status: configuration.status, configurationFailures: configuration.failures,
    sourceAttestation: report.sourceAttestation, maxCases: 1, maximumPriceRequests: 1, maximumFirmRequests: 1, maxDurationMs: 180000, authorizationIssuance: 0 });
  // Hash the bytes executing here, independently comparable with the reviewed Git tree.
  // This deliberately does not assert that every transitive dependency/uploaded byte matches.
  for (const path of ["scripts/private-zero-x-proof.ts", "scripts/private-zero-x-actions.ts", "scripts/private-zero-x-jsonl.ts", "lib/server/vnext-zero-x-adapter.ts",
    "lib/server/vnext-zero-x-firm-quote-verifier.ts", "lib/server/vnext-zero-x-deployment-authority.ts",
    "lib/server/vnext-zero-x-execution-decoder.ts", "lib/server/vnext-provider-adapter.ts", "lib/vnext/zero-x-settlement.ts",
    "lib/vnext/execution-envelope-diagnostic.ts", "lib/vnext/trade-failure.ts", "scripts/private-zero-x-proof.vercel.json"]) {
    report.sourceFilesSha256[path] = createHash("sha256").update(await readFile(new URL(`../${path}`, import.meta.url))).digest("hex");
    writer.emit("SOURCE_FINGERPRINT", { path, sha256: report.sourceFilesSha256[path] });
  }
  if (configuration.status !== "READY") { writer.finish("BLOCKED"); return report; }
  report.evidenceClass = "READ_ONLY_LIVE";
  const { readVNextVerifiedAssetIdentity } = await import("../lib/server/vnext-asset-identity");
  const { requireProjectIdentityExecutionAdmitted } = await import("../lib/server/project-identity-admission");
  const { requireVNextStockTokenExecutionEligible } = await import("../lib/server/robinhood-stock-token-registry");
  // Previously used public read-only identity; no claim that it owns spendable assets.
  const recipient = getAddress(RMT_ZERO_X_FEE_TREASURY);
  for (const {direction, inputAsset, outputAsset, amount} of [CANNACAT_CASE]) {
    if (writer.truncated) break; // Do not spend on another quote after output exhaustion.
    writer.beginCase(direction);
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
      const observed = await observePrivateZeroXCase({ chainId: 4663, inputAsset, outputAsset,
        inputAmountAtomic: amount, amountIn: BigInt(amount), recipient, inputIdentity, outputIdentity }, true);
      emitObservedCase(writer, observed);
      report.cases.push({ direction, firmStatus: observed.firmStatus, failureClass: observed.failureClass });
    } catch { report.cases.push({ direction, status: "NOT_TESTED", failureClass: `${stage}_BLOCKED` }); writer.endCase(`${stage}_BLOCKED`); }
  }
  report.firmQuotesReturned = report.cases.filter(item => item.firmStatus === "FIRM_QUOTE_RETURNED").length;
  report.status = report.firmQuotesReturned > 0 ? "BOUNDED_OBSERVATION_COMPLETE" : "BLOCKED_NO_FIRM_QUOTES";
  writer.finish("COMPLETE");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const writer = new ProofJsonl(line => process.stdout.write(line));
  // Third-party read helpers must not print unsanitized exceptions or URLs.
  console.log = console.info = console.warn = console.error = console.debug = () => {};
  const exit = (code: number) => process.stdout.write("", () => process.exit(code));
  // No accidental network execution on import or from a package/build lifecycle.
  if (process.argv.length !== 3 || process.argv[2] !== "--execute-read-only") {
    writer.emit("PROOF_START", { status: "NOT_RUN", requiredArgument: "--execute-read-only" }); writer.finish("NOT_RUN"); exit(1);
  } else {
    // Hard process lifetime bounds orphaned provider reads; never schedules a rerun.
    const budget = installPrivateProofReadBudget();
    const timer = installProofDeadline(writer, () => exit(1));
    void runPrivateZeroXProof(writer).then(report => {
      clearTimeout(timer); budget.restore(); exit(report.status === "BOUNDED_OBSERVATION_COMPLETE" ? 0 : 1);
    }, () => { clearTimeout(timer); budget.restore(); writer.finish("FAILED"); exit(1); });
  }
}
