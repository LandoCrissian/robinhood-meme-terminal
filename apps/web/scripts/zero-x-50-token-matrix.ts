import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, zeroAddress, type Address } from "viem";
import { parseVNextCanonicalDirectoryResponse, vNextSelectedMarketExecutionState, type VNextDirectoryMarket } from "../lib/vnext/market-directory";
import { vNextZeroXSwapAdapter } from "../lib/server/vnext-zero-x-adapter";
import { verifyZeroXSwapFirmQuote } from "../lib/server/vnext-zero-x-firm-quote-verifier";
import { VNEXT_PROVIDER_NATIVE_INPUT_FEE } from "../lib/vnext/execution-settlement";
import { ROBINHOOD_USDG_ADDRESS } from "../lib/vnext/robinhood-assets";
import type { VNextProviderQuoteRequest } from "../lib/server/vnext-provider-adapter";
import { RMT_CURATED_MARKET_REGISTRY } from "../lib/vnext/curated-market-registry";
import { parseVNextUniversalMarketSearchPool } from "../lib/vnext/universal-market-search-contract";
import { simulateFundedZeroXEnvelope } from "./zero-x-read-only-funded-simulation";

// Run from apps/web. Credentials stay in process memory; artifacts contain an
// explicit allowlist only. No wallet client, signing, or dispatch is imported.
const seed = 0x507508;
const recipient = "0x1111111111111111111111111111111111111111" as Address;
const peep = "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f";
const out = resolve(process.env.RMT_MATRIX_OUTPUT ?? "../../evidence/trading-hardening");
const directoryOrigin = "https://www.rmtlaunch.fun";
const rows: Record<string, unknown>[] = [];
const extraRows: Record<string, unknown>[] = [];
const stocks: Record<string, unknown>[] = [];
const inventory: VNextDirectoryMarket[] = [];
const pages: Record<string, unknown>[] = [];
const searchAdmissions: Record<string, unknown>[] = [];
let inventoryHasMore = false;
let inventoryBoundary: string | null = null;
let randomState = seed;
function random() { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; }
function shuffle<T>(items: T[]) { for (let i = items.length - 1; i > 0; --i) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; }
function evidence(market: VNextDirectoryMarket) {
  return [...(market.canonicalMarkets ?? [])].filter((pool) => [pool.token0, pool.token1].some((address) => address.toLowerCase() === market.address.toLowerCase()))
    .sort((a, b) => `${a.protocol}:${a.version}:${a.poolKey}`.localeCompare(`${b.protocol}:${b.version}:${b.poolKey}`));
}
function bucket(market: VNextDirectoryMarket) { const primary = evidence(market)[0]; return primary?.protocol === "uniswap" && [2, 3, 4].includes(primary.version) ? `V${primary.version}` : "OTHER"; }
function save(blocker: string | null, selected: VNextDirectoryMarket[] = []) {
  mkdirSync(out, { recursive: true });
  const summary = { schemaVersion: 1, seed, observedAt: new Date().toISOString(), baseSha: "df77bafe05417426baff0ea139649e6d7be951ae",
    directoryOrigin, pages, searchAdmissions, inventoryHasMore, inventoryBoundary, eligibleInventory: inventory.length, testWallet: recipient,
    samplingPopulation: inventory.map((market) => ({ address: market.address, symbol: market.symbol,
      bucket: bucket(market), evidence: evidence(market).map((pool) => ({ protocol: pool.protocol, version: pool.version, pool: pool.poolKey })) })),
    testWalletFunding: "UNFUNDED_READ_ONLY_TEST_IDENTITY; insufficient balance/allowance is not a simulation pass",
    selectionRule: "Bounded first eight current canonical pages plus current exact-contract search admission of the existing curated bootstrap contracts; exact-address deduplication; primary evidence sorted protocol/version/pool; seeded Fisher-Yates per bucket; round-robin V2/V3/V4/OTHER. Distribution describes this admitted window, not unavailable later inventory.",
    tokensSampled: selected.length, totalCases: rows.length, distribution: Object.fromEntries(["V2", "V3", "V4", "OTHER"].map((key) => [key, selected.filter((market) => bucket(market) === key).length])),
    stockControls: stocks, peepCases: extraRows, legacyExecutorCalls: 0, walletRequests: 0, signatures: 0, transactions: 0, blocker, rows };
  writeFileSync(resolve(out, "zero-x-50-token-matrix.json"), JSON.stringify(summary, null, 2) + "\n");
  const columns = [...new Set([...rows, ...extraRows].flatMap(Object.keys))];
  const cell = (value: unknown) => JSON.stringify(typeof value === "object" && value !== null ? JSON.stringify(value) : value == null ? "" : String(value));
  writeFileSync(resolve(out, "zero-x-50-token-matrix.csv"), [columns.map(cell).join(","), ...[...rows, ...extraRows].map((row) => columns.map((key) => cell(row[key])).join(","))].join("\n") + "\n");
  console.log(JSON.stringify({ tokens: selected.length, cases: rows.length, peepCases: extraRows.length, blocker, output: out }));
}

async function runCase(market: VNextDirectoryMarket, direction: "BUY" | "SELL", sampleIndex: number, base: "ETH" | "USDG", sellAmount?: string) {
  const primary = evidence(market)[0];
  const baseAsset = base === "ETH" ? zeroAddress : ROBINHOOD_USDG_ADDRESS;
  const baseAmount = base === "ETH" ? "500000000000000" : "1000000";
  const identity = market.verifiedIdentity!;
  const tokenAmount = sellAmount ?? (10n ** BigInt(identity.decimals) < 400n ? 400n : 10n ** BigInt(identity.decimals)).toString();
  const amount = direction === "BUY" ? baseAmount : tokenAmount;
  const tokenIdentity = { address: getAddress(market.address), symbol: identity.symbol, decimals: identity.decimals };
  const baseIdentity = { address: getAddress(baseAsset), symbol: base, decimals: base === "ETH" ? 18 : 6 };
  const request: VNextProviderQuoteRequest = { chainId: 4663, inputAsset: direction === "BUY" ? baseIdentity.address : tokenIdentity.address,
    outputAsset: direction === "BUY" ? tokenIdentity.address : baseIdentity.address, inputAmountAtomic: amount, amountIn: BigInt(amount), recipient,
    inputIdentity: direction === "BUY" ? baseIdentity : tokenIdentity, outputIdentity: direction === "BUY" ? tokenIdentity : baseIdentity };
  const row: Record<string, unknown> = { sampleIndex, randomSeed: seed, assetContract: tokenIdentity.address, tokenSymbol: identity.symbol,
    canonicalProtocol: primary.protocol, canonicalVersion: primary.version, canonicalPool: primary.poolKey,
    allCanonicalEvidence: evidence(market).map((pool) => ({ protocol: pool.protocol, version: pool.version, pool: pool.poolKey })),
    direction, inputAsset: request.inputAsset, outputAsset: request.outputAsset, testAmount: amount, recipient, chainId: 4663,
    provider: "zero-x-swap", rmtFeeBps: 25, feeAsset: request.inputAsset, providerSlippagePpm: 9900, maximumUserSlippagePpm: 10000,
    zeroXRouteStatus: "OTHER_EXACT_CLASSIFICATION", zeroXQuoteStatus: "NOT_REACHED", allowanceTarget: null, transactionTarget: null,
    protectedOutput: null, readOnlySimulationStatus: "NOT_REACHED", errorClassification: null };
  const price = await vNextZeroXSwapAdapter.quote(request);
  row.zeroXQuoteStatus = price.status;
  row.zeroXRouteStatus = price.status === "indicative" ? "ROUTABLE" : price.status === "no_route" ? "NO_ROUTE" : price.status === "temporarily_unavailable" ? "PROVIDER_UNAVAILABLE" : "OTHER_EXACT_CLASSIFICATION";
  row.indicativeExpectedOutput = price.expectedOutputAtomic;
  if (price.status !== "indicative" || !price.protectedOutputAtomic) { row.errorClassification = price.status; return row; }
  try {
    const nowMs = Date.now();
    const firm = await verifyZeroXSwapFirmQuote({ ...request, settlementMode: VNEXT_PROVIDER_NATIVE_INPUT_FEE,
      indicativeProtectedOutputFloorAtomic: BigInt(price.protectedOutputAtomic), nowMs, deadlineSeconds: BigInt(Math.floor(nowMs / 1000) + 120) });
    row.zeroXQuoteStatus = "FIRM_RETURNED";
    row.expectedOutput = firm.expectedOutputAtomic;
    row.providerReportedMinimum = firm.providerReportedMinBuyAmount;
    row.protectedOutput = firm.encodedExecutableMinBuyAmount;
    row.executableBound = BigInt(firm.encodedExecutableMinBuyAmount) * 1000000n >= BigInt(firm.expectedOutputAtomic!) * 990000n;
    row.allowanceTarget = firm.providerNativeFee?.firmQuote?.allowanceTarget ?? null;
    row.transactionTarget = firm.router;
    row.transactionValue = firm.swapTransactionValueAtomic;
    row.calldataHash = firm.calldataHash;
    row.settlerTarget = firm.executableSettlerTarget;
    row.settlerRuntimeHash = firm.executableSettlerRuntimeHash;
    row.targetRuntimeHash = firm.routerRuntimeHash;
    row.firmStatus = firm.status;
    row.approvalKind = firm.approvalKind;
    row.approvalAmount = firm.approvalKind ? amount : null;
    row.approvalSpender = firm.approvalKind ? firm.approvalSpender : null;
    row.readOnlySimulationStatus = firm.exactSimulationPassed === true ? "PASS" : firm.status === "simulation_failed" ? "FAIL" : `NOT_RUN_${firm.status.toUpperCase()}`;
    row.errorClassification = firm.status === "verified" ? null : firm.status;
    row.fundedSimulation = await simulateFundedZeroXEnvelope(firm);
  } catch (error) {
    // Provider/RPC implementations may wrap URLs or payloads. Do not serialize errors/messages.
    row.zeroXQuoteStatus = "FIRM_REJECTED";
    row.errorClassification = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "UNKNOWN_ERROR";
  }
  return row;
}

async function main() {
  if (!process.env.RMT_ZEROX_API_KEY) process.loadEnvFile(".env.local");
  if (!process.env.RMT_ZEROX_API_KEY) { save("ZERO_X_CREDENTIAL_UNAVAILABLE"); process.exitCode = 1; return; }
  // Test-process-only configuration, identical to the authorized execution policy.
  process.env.RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED = "true";
  process.env.RMT_ZEROX_ALLOWANCE_HOLDER = "0x0000000000001fF3684f28c67538d4D072C22734";
  process.env.RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH = "0x99f5e8edaceacfdd183eb5f1da8a7757b322495b80cf7928db289a1b1a09f799";
  const seen = new Map<string, VNextDirectoryMarket>();
  const quarantined = new Set<string>();
  let cursor: string | null = null;
  const cursors = new Set<string>();
  for (let page = 0; page < 8; ++page) {
    const url = new URL("/api/vnext/market-directory", directoryOrigin);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const raw = await response.json();
    const body = parseVNextCanonicalDirectoryResponse(raw);
    if (!response.ok || !body || !Array.isArray(body.markets) || body.inventorySource !== "indexed" || body.revalidationComplete !== true) {
      inventoryBoundary = `INDEXED_PAGE_${page}_UNAVAILABLE`;
      inventoryHasMore = true;
      // Already validated admitted pages are a usable sampling population. A
      // missing later page limits coverage, not the authority of earlier rows.
      break;
    }
    pages.push({ page, count: body.markets.length, source: body.inventorySource, coverage: body.coverage, stale: body.stale ?? false, observedAt: body.updatedAt });
    for (const address of body.quarantinedAddresses ?? []) quarantined.add(address.toLowerCase());
    for (const market of body.markets) {
      if (vNextSelectedMarketExecutionState(market) === "stock-token-view-only") {
        if (!stocks.some((row) => row.address === market.address)) stocks.push({ address: market.address, symbol: market.symbol, state: "VIEW_ONLY", quoteRequests: 0 });
      } else if (market.verifiedIdentity && evidence(market).length && ![zeroAddress.toLowerCase(), ROBINHOOD_USDG_ADDRESS.toLowerCase()].includes(market.address.toLowerCase())) seen.set(market.address.toLowerCase(), market);
    }
    cursor = body.nextCursor;
    inventoryHasMore = Boolean(cursor);
    if (!cursor) break;
    if (cursors.has(cursor)) throw Error("Repeated directory cursor");
    cursors.add(cursor);
  }
  // A recorded population is only a discovery hint, never admission authority.
  // Re-admit each exact contract through the current canonical search endpoint
  // when a degraded root response prevents a usable paginated population.
  const hints: string[] = RMT_CURATED_MARKET_REGISTRY.map((market) => market.token);
  if (seen.size < 50 && process.env.RMT_MATRIX_DISCOVERY_MANIFEST) {
    const manifest = JSON.parse(readFileSync(resolve(process.env.RMT_MATRIX_DISCOVERY_MANIFEST), "utf8"));
    for (const item of (manifest.samplingPopulation ?? []).slice(0, 100)) {
      if (typeof item.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(item.address)) hints.push(item.address);
    }
    for (const control of manifest.stockControls ?? []) {
      stocks.push({ address: control.address, symbol: control.symbol, state: "VIEW_ONLY", quoteRequests: 0,
        evidenceObservedAt: manifest.observedAt, source: "previously_observed_canonical_stock_control" });
    }
  }
  for (const token of [...new Set(hints.map((address) => address.toLowerCase()))]) {
    try {
      const response = await fetch(`${directoryOrigin}/api/vnext/market-search?q=${token}`, { signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      const item = body.status === "found" && body.results?.find((candidate: { address?: string }) => candidate.address?.toLowerCase() === token);
      if (!response.ok || !item || !Array.isArray(item.markets) || !Number.isInteger(item.decimals) || item.decimals < 0 || item.decimals > 36) continue;
      if (stocks.some((control) => String(control.address).toLowerCase() === token)) continue;
      const markets = item.markets.map(parseVNextUniversalMarketSearchPool).filter((pool: unknown) => pool !== null);
      if (!markets.length) continue;
      const parsed = parseVNextCanonicalDirectoryResponse({ canonical: true, inventorySource: "indexed", revalidationComplete: true,
        coverage: "partial", nextCursor: null, updatedAt: new Date().toISOString(), markets: [{ ...item,
          ...Object.fromEntries(["priceUsd", "liquidityUsd", "marketCapUsd", "fdvUsd", "volume5m", "volume1h", "volume24h",
            "priceChange5m", "priceChange1h", "priceChange24h", "buys5m", "sells5m", "buys1h", "sells1h", "buys24h", "sells24h",
            "pairCreatedAt", "ageMinutes", "momentumScore", "buyPressureBps", "riskFlags", "signal"].map((field) => [field, null])),
          canonicalMarkets: markets, verifiedIdentity: { address: item.address, name: item.name, symbol: item.symbol, decimals: item.decimals } }] });
      const market = parsed?.markets?.[0];
      if (!market || !evidence(market).length || quarantined.has(market.address.toLowerCase())) continue;
      const existing = seen.get(market.address.toLowerCase());
      seen.set(market.address.toLowerCase(), existing ? { ...market, canonicalMarkets: [...(existing.canonicalMarkets ?? []), ...markets] } : market);
      searchAdmissions.push({ address: market.address, source: "current_exact_contract_search", observedAt: new Date().toISOString() });
    } catch { /* Missing search admission never invents a candidate. */ }
  }
  inventory.push(...[...seen.entries()].filter(([address]) => !quarantined.has(address)).map(([, market]) => market).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())));
  if (inventory.length < 50) { save("FEWER_THAN_50_ADMITTED_UNIQUE_TOKENS"); process.exitCode = 1; return; }
  const buckets = ["V2", "V3", "V4", "OTHER"].map((key) => shuffle(inventory.filter((market) => bucket(market) === key)));
  const selected: VNextDirectoryMarket[] = [];
  while (selected.length < 50) for (const candidates of buckets) { if (selected.length < 50 && candidates.length) selected.push(candidates.shift()!); }
  for (const [index, market] of selected.entries()) {
    const buy = await runCase(market, "BUY", index + 1, "ETH"); rows.push(buy);
    const amount = typeof buy.indicativeExpectedOutput === "string" && BigInt(buy.indicativeExpectedOutput) >= 400n ? buy.indicativeExpectedOutput : undefined;
    rows.push(await runCase(market, "SELL", index + 1, "ETH", amount));
    save("MATRIX_IN_PROGRESS", selected);
  }
  const peepMarket = inventory.find((market) => market.address.toLowerCase() === peep);
  if (peepMarket) for (const base of ["ETH", "USDG"] as const) {
    const buy = await runCase(peepMarket, "BUY", 0, base); extraRows.push(buy);
    extraRows.push(await runCase(peepMarket, "SELL", 0, base, typeof buy.indicativeExpectedOutput === "string" && BigInt(buy.indicativeExpectedOutput) >= 400n ? buy.indicativeExpectedOutput : undefined));
  }
  save(peepMarket ? null : "PEEP_NOT_IN_CURRENT_ADMITTED_INVENTORY_WINDOW", selected);
}
void main().catch(() => { save("BOUNDED_MATRIX_RUN_FAILED"); process.exitCode = 1; });
