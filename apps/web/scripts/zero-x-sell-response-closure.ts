import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, zeroAddress } from "viem";
import { createZeroXSwapDiagnosticAdapter } from "../lib/server/vnext-zero-x-adapter";
import type { ZeroXPriceDiagnostic } from "../lib/server/vnext-zero-x-response-diagnostics";
import { verifyZeroXSwapFirmQuote } from "../lib/server/vnext-zero-x-firm-quote-verifier";
import type { VNextProviderQuoteRequest } from "../lib/server/vnext-provider-adapter";
import { parseVNextUniversalMarketSearchResult, type VNextUniversalMarketSearchResultItem } from "../lib/vnext/universal-market-search-contract";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../lib/vnext/execution-settlement";
import { zeroXIntegratorFeeAmount } from "../lib/vnext/zero-x-settlement";
import { simulateFundedZeroXEnvelope } from "./zero-x-read-only-funded-simulation";

// Frozen contracts, fresh current admission, paired fresh economic amounts. No
// wallet, authentication bypass, signer, or transaction submission is used.
type Row = Record<string, any>;
const root = resolve("../../evidence/trading-hardening");
const baseline = JSON.parse(readFileSync(resolve(root, "zero-x-50-token-matrix.json"), "utf8"));
const out = resolve(root, "sell-response-closure");
const rows: Row[] = [], peepCases: Row[] = [], originalInvalidCases: Row[] = [], admissions: Row[] = [];
const recipient = getAddress(baseline.testWallet);
const seen: ZeroXPriceDiagnostic[] = [];
const adapter = createZeroXSwapDiagnosticAdapter(value => seen.push(value));
let complete = false;
const policyReasons = new Set(["WRONG_INTEGRATOR_FEE_AMOUNT", "MISSING_INTEGRATOR_FEE", "INVALID_INTEGRATOR_FEE",
  "INVALID_TOKEN_BINDING", "CHANGED_SELL_AMOUNT", "INVALID_EXPECTED_OUTPUT", "INVALID_MINIMUM_OUTPUT", "MISSING_FEE_DISCLOSURE",
  "INVALID_PROVIDER_FEE", "DUPLICATE_INTEGRATOR_FEE", "WRONG_INTEGRATOR_FEE_TOKEN", "INVALID_INTEGRATOR_FEE_TYPE",
  "MISSING_NETWORK_FEE", "CONTRADICTORY_NETWORK_FEE"]);
function save() {
  mkdirSync(out, { recursive: true });
  for (const row of [...rows, ...peepCases]) row.caseOutcome = row.zeroXQuoteStatus === "FIRM_RETURNED" ? "FIRM_VERIFIED"
    : row.zeroXQuoteStatus === "no_route" ? "NO_ROUTE" : row.zeroXQuoteStatus === "temporarily_unavailable" ? "PROVIDER_UNAVAILABLE"
    : row.zeroXQuoteStatus === "invalid_response" && row.invalidResponseReason ? `POLICY_REJECTED_${row.invalidResponseReason}` : "UNRESOLVED";
  const report = { schemaVersion: 1, seed: baseline.seed, baseSha: baseline.baseSha,
    originalHead: "3a8bc7f8ee266c0f350a477334df93888df8c00c", observedAt: new Date().toISOString(), complete,
    source: "Frozen original 50 contracts; current exact-contract canonical search admission; fresh BUY output funds paired SELL amount; no replacement sampling",
    firmVerifiedMeaning: "Strict executable-envelope verification reached; actual test wallet remains unfunded and is NOT authorized. Funded read-only simulation is separate evidence.",
    distribution: baseline.distribution, admissions, rows, peepCases, originalInvalidCases,
    legacyExecutorCalls: 0, walletRequests: 0, signatures: 0, transactions: 0 };
  writeFileSync(resolve(out, "matrix.json"), JSON.stringify(report, null, 2) + "\n");
  const all = [...rows.map(row => ({ ...row, section: "matrix" })), ...peepCases.map(row => ({ ...row, section: "peep" })),
    ...originalInvalidCases.map(row => ({ ...row, section: "original_invalid_replay" }))];
  const columns = [...new Set(all.flatMap(Object.keys))];
  const cell = (value: unknown) => `"${(typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "")).replaceAll('"', '""')}"`;
  writeFileSync(resolve(out, "matrix.csv"), [columns.map(cell).join(","), ...all.map(row => columns.map(key => cell((row as Row)[key])).join(","))].join("\n") + "\n");
}
async function admit(address: string): Promise<VNextUniversalMarketSearchResultItem | null> {
  try {
    const response = await fetch(`https://www.rmtlaunch.fun/api/vnext/market-search?q=${address}`, { signal: AbortSignal.timeout(12000) });
    const body = parseVNextUniversalMarketSearchResult(await response.json());
    const item = body?.status === "found" ? body.results.find(item => item.address.toLowerCase() === address.toLowerCase()) : null;
    const admitted = response.ok && item && item.markets.some(pool => [pool.token0, pool.token1].some(token => token.toLowerCase() === address.toLowerCase()))
      && !baseline.stockControls.some((stock: Row) => stock.address.toLowerCase() === address.toLowerCase());
    admissions.push({ assetContract: address, status: admitted ? "ADMITTED" : body?.status ?? "UNAVAILABLE", observedAt: new Date().toISOString() });
    return admitted ? item : null;
  } catch { admissions.push({ assetContract: address, status: "UNAVAILABLE" }); return null; }
}
async function runCase(template: Row, identity: VNextUniversalMarketSearchResultItem | null, amount: string, firmRequired: boolean): Promise<Row> {
  const row: Row = { sampleIndex: template.sampleIndex, randomSeed: baseline.seed, assetContract: template.assetContract,
    tokenSymbol: template.tokenSymbol, canonicalProtocol: template.canonicalProtocol, canonicalVersion: template.canonicalVersion,
    canonicalPool: template.canonicalPool, allCanonicalEvidence: template.allCanonicalEvidence,
    direction: template.direction, inputAsset: template.inputAsset, outputAsset: template.outputAsset, testAmount: amount,
    recipient, chainId: 4663, provider: "zero-x-swap", rmtFeeBps: 25, feeAsset: template.inputAsset,
    providerSlippagePpm: 9900, maximumUserSlippagePpm: 10000, zeroXQuoteStatus: "NOT_REACHED",
    zeroXRouteStatus: "IDENTITY_REJECTED", invalidResponseReason: null, policyViolation: "NOT_APPLICABLE", rmtParserDefect: "NO",
    expectedIntegratorFee: zeroXIntegratorFeeAmount(amount), readOnlySimulationStatus: "NOT_REACHED" };
  if (!identity) return row;
  const token = getAddress(identity.address);
  const identityFor = (asset: string) => ({ address: getAddress(asset), symbol: asset.toLowerCase() === token.toLowerCase() ? identity.symbol : /^0x0{40}$/i.test(asset) ? "ETH" : "USDG",
    decimals: asset.toLowerCase() === token.toLowerCase() ? identity.decimals : /^0x0{40}$/i.test(asset) ? 18 : 6 });
  const request: VNextProviderQuoteRequest = { chainId: 4663, inputAsset: getAddress(template.inputAsset), outputAsset: getAddress(template.outputAsset),
    inputAmountAtomic: amount, amountIn: BigInt(amount), recipient, inputIdentity: identityFor(template.inputAsset), outputIdentity: identityFor(template.outputAsset) };
  seen.length = 0;
  const attempt = await adapter.quote(request);
  const diagnostic = seen[0];
  row.indicativeStatus = attempt.status;
  row.zeroXQuoteStatus = attempt.status;
  row.zeroXRouteStatus = attempt.status === "indicative" ? "ROUTABLE" : attempt.status === "no_route" ? "NO_ROUTE" : attempt.status === "temporarily_unavailable" ? "PROVIDER_UNAVAILABLE" : "REJECTED";
  row.indicativeExpectedOutput = attempt.expectedOutputAtomic ?? null;
  row.invalidResponseReason = attempt.status === "invalid_response" ? diagnostic?.reason ?? "OTHER_SCHEMA_VIOLATION" : null;
  row.responseEconomics = diagnostic?.economics ?? null;
  if (row.invalidResponseReason) row.policyViolation = policyReasons.has(row.invalidResponseReason) ? "YES" : "UNRESOLVED";
  if (diagnostic?.economics.integratorFee?.amount) {
    row.integratorFeeDifferenceAtomic = (BigInt(diagnostic.economics.integratorFee.amount) - BigInt(row.expectedIntegratorFee)).toString();
  }
  if (attempt.status !== "indicative" || !firmRequired) return row;
  try {
    const nowMs = Date.now();
    const firm = await verifyZeroXSwapFirmQuote({ ...request, indicativeProtectedOutputFloorAtomic: BigInt(attempt.protectedOutputAtomic!),
      settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE, nowMs, deadlineSeconds: BigInt(Math.floor(nowMs / 1000) + 120) });
    Object.assign(row, { zeroXQuoteStatus: "FIRM_RETURNED", expectedOutput: firm.expectedOutputAtomic,
      providerReportedMinimum: firm.providerReportedMinBuyAmount, protectedOutput: firm.encodedExecutableMinBuyAmount,
      executableBound: BigInt(firm.encodedExecutableMinBuyAmount) * 1000000n >= BigInt(firm.expectedOutputAtomic!) * 990000n,
      allowanceTarget: firm.providerNativeFee?.firmQuote?.allowanceTarget ?? null, transactionTarget: firm.router,
      transactionValue: firm.swapTransactionValueAtomic, calldataHash: firm.calldataHash,
      settlerTarget: firm.executableSettlerTarget, settlerRuntimeHash: firm.executableSettlerRuntimeHash,
      targetRuntimeHash: firm.routerRuntimeHash, firmStatus: firm.status,
      readOnlySimulationStatus: firm.exactSimulationPassed ? "PASS" : `NOT_RUN_${firm.status.toUpperCase()}`,
      fundedSimulation: await simulateFundedZeroXEnvelope(firm) });
  } catch { row.zeroXQuoteStatus = "FIRM_REJECTED"; row.firmErrorClassification = "FIRM_VERIFICATION_REJECTED"; }
  return row;
}
function pairedAmount(buy: Row, identity: VNextUniversalMarketSearchResultItem | null, oldSell: Row) {
  if (typeof buy.indicativeExpectedOutput === "string" && BigInt(buy.indicativeExpectedOutput) >= 400n) return buy.indicativeExpectedOutput;
  if (!identity) return oldSell.testAmount;
  const unit = 10n ** BigInt(identity.decimals);
  return (unit < 400n ? 400n : unit).toString();
}
async function main() {
  if (!process.env.RMT_ZEROX_API_KEY) process.loadEnvFile(".env.local");
  if (!process.env.RMT_ZEROX_API_KEY) throw new Error("CREDENTIAL_UNAVAILABLE");
  process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED = "true";
  process.env.RMT_ZEROX_ALLOWANCE_HOLDER = "0x0000000000001fF3684f28c67538d4D072C22734";
  process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH = "0x99f5e8edaceacfdd183eb5f1da8a7757b322495b80cf7928db289a1b1a09f799";
  if (baseline.seed !== 5272840 || baseline.rows.length !== 100) throw new Error("FROZEN_SAMPLE_MISMATCH");
  for (const oldBuy of baseline.rows.filter((row: Row) => row.direction === "BUY")) {
    const oldSell = baseline.rows.find((row: Row) => row.sampleIndex === oldBuy.sampleIndex && row.direction === "SELL");
    const identity = await admit(oldBuy.assetContract);
    for (const old of [oldBuy, oldSell].filter(row => row.errorClassification === "invalid_response")) {
      originalInvalidCases.push({ ...await runCase(old, identity, old.testAmount, false), originalStatus: "invalid_response", originalInputAmount: old.testAmount });
    }
    const buy = await runCase(oldBuy, identity, oldBuy.testAmount, true); rows.push(buy);
    rows.push(await runCase(oldSell, identity, pairedAmount(buy, identity, oldSell), true));
    save();
    console.log(JSON.stringify({ sample: oldBuy.sampleIndex, cases: rows.length, buy: buy.zeroXQuoteStatus, sell: rows.at(-1)?.zeroXQuoteStatus }));
  }
  const identity = await admit(baseline.peepCases[0].assetContract);
  for (let index = 0; index < 4; index += 2) {
    const oldBuy = baseline.peepCases[index], oldSell = baseline.peepCases[index + 1];
    if (oldSell.errorClassification === "invalid_response") originalInvalidCases.push({ ...await runCase(oldSell, identity, oldSell.testAmount, false), originalStatus: "invalid_response", originalInputAmount: oldSell.testAmount, peepExtra: true });
    const buy = await runCase(oldBuy, identity, oldBuy.testAmount, true); peepCases.push(buy);
    peepCases.push(await runCase(oldSell, identity, pairedAmount(buy, identity, oldSell), true));
  }
  complete = true; save();
  console.log(JSON.stringify({ complete, cases: rows.length, originalInvalidCases: originalInvalidCases.length, peep: peepCases.length }));
}
void main().catch(() => { save(); console.error("CLOSURE_RUN_INCOMPLETE_NO_RAW_ERROR_RETAINED"); process.exitCode = 1; });
