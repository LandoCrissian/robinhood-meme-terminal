import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExternalMarket, RobinhoodStockAssetRelationship, UniversalMarketResolution } from "../external-market";
import {
  exactWorkspaceMarket,
  mergeWorkspaceStockAssetRelationships,
  workspaceTokenPresentation
} from "../../app/vnext/use-vnext-asset-workspace";
import { tokenRiskEvidenceRequestUrl } from "../use-token-risk-evidence";
import type { VNextUniversalMarketSearchPool } from "./universal-market-search-contract";

const selected = "0x1111111111111111111111111111111111111111";
const exactPair = "0x2222222222222222222222222222222222222222";
const mismatchedPair = "0x3333333333333333333333333333333333333333";
const stockAsset: RobinhoodStockAssetRelationship = {
  relationship: "canonical-stock-token",
  assetId: "stock-spcx",
  tokenSymbol: "SPCX",
  tokenName: "SpaceX · Robinhood Token",
  contractAddress: selected,
  currentMultiplier: "1.250000000000000000",
  status: "active",
  logoUrl: "https://cdn.robinhood.com/spcx.png",
  provenance: "robinhood-live-asset-registry"
};
const pairedAsset: RobinhoodStockAssetRelationship = {
  ...stockAsset,
  relationship: "paired-market-asset",
  assetId: "stock-tsla",
  tokenSymbol: "TSLA",
  tokenName: "Tesla · Robinhood Token",
  contractAddress: "0x4444444444444444444444444444444444444444"
};
const providerMarket = {
  address: selected,
  name: "Provider placeholder",
  symbol: "PAIR",
  pairAddress: mismatchedPair,
  primaryMarket: { pool: { kind: "evm-address", value: mismatchedPair } },
  stockAssetRelationships: [stockAsset, pairedAsset]
} as ExternalMarket;
const payload = { markets: [providerMarket] };

assert.equal(exactWorkspaceMarket(payload, selected, exactPair), undefined, "A mismatched provider pair must be discarded");
const tokenOnly = mergeWorkspaceStockAssetRelationships(selected, [stockAsset], undefined);
assert.deepEqual(tokenOnly, [stockAsset], "Pair mismatch must preserve canonical token-level stock identity");
assert.equal(tokenOnly.some((relationship) => relationship.relationship === "paired-market-asset"), false);
const exact = { ...providerMarket, pairAddress: exactPair, primaryMarket: { pool: { kind: "evm-address", value: exactPair } } } as ExternalMarket;
const exactMarket = exactWorkspaceMarket({ markets: [exact] }, selected, exactPair);
const merged = mergeWorkspaceStockAssetRelationships(selected, [stockAsset], exactMarket);
assert.deepEqual(merged.map((relationship) => relationship.relationship), ["canonical-stock-token", "paired-market-asset"]);

const resolution = {
  chainId: 4_663,
  requestedAddress: selected,
  requestedKind: "token",
  status: "token-only",
  token: { address: selected, name: "Verified NVIDIA Token", symbol: "NVDA", decimals: 18, totalSupply: "1" },
  pools: [],
  marketData: "identity-only",
  execution: "view-only",
  provenance: "robinhood-chain-contract-reads",
  resolvedAt: new Date(0).toISOString()
} satisfies UniversalMarketResolution;
assert.deepEqual(workspaceTokenPresentation({
  address: selected,
  resolution,
  canonicalIdentity: { address: selected, name: "Canonical name", symbol: "CAN" },
  provider: { name: "Provider name", symbol: "PROV" },
  fallback: { name: "Address placeholder", symbol: "0x1111" }
}), { name: "Verified NVIDIA Token", symbol: "NVDA", verified: true });

const workspaceSource = readFileSync(new URL("../../app/vnext/vnext-asset-workspace.tsx", import.meta.url), "utf8");
const chartSource = readFileSync(new URL("../../app/vnext/vnext-market-chart.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../../app/vnext/vnext-terminal.css", import.meta.url), "utf8");
const riskHookSource = readFileSync(new URL("../use-token-risk-evidence.ts", import.meta.url), "utf8");
const constellationHookSource = readFileSync(new URL("../use-wallet-constellation.ts", import.meta.url), "utf8");
assert.equal((workspaceSource.match(/currentMultiplier/g) ?? []).length, 1, "Stock multiplier must be displayed exactly once");
assert.doesNotMatch(workspaceSource, /priceUsd\s*\*\s*[^\n]*currentMultiplier|currentMultiplier\s*\*\s*[^\n]*priceUsd/);
assert.match(workspaceSource, /last known, non-authoritative/, "Stale registry presentation must be explicitly non-authoritative");
assert.match(workspaceSource, /canonicalChartIdentity = selectedCanonicalMarket[\s\S]*selectedCanonicalMarket\.poolAddress \?\? selectedCanonicalMarket\.poolKey/,
  "Canonical V2/V3 pool addresses and V4 PoolIds must define canonical chart identity");
assert.match(workspaceSource, /selectedChartIdentity = canonicalChartIdentity \?\? observedChartPool/,
  "Canonical chart authority must precede provider-observed chart evidence");
assert.match(workspaceSource, /pair=\{selectedChartIdentity\}/,
  "The chart request must use the authority-separated selected chart identity");
assert.doesNotMatch(workspaceSource, /PoolManager.*VNextMarketChart/,
  "V4 chart coverage must not fabricate an address-style pool");
assert.match(workspaceSource, /canonicalPool=\{selectedCanonicalMarket\?\.poolAddress \?\? undefined\}/,
  "Canonical quick links must receive only canonical inventory pool addresses");
assert.match(workspaceSource, /!canonicalMarket && observedPool[\s\S]*Observed pool ↗/,
  "Provider-only chart pools must be labeled observed rather than canonical");
assert.doesNotMatch(workspaceSource, /primaryPool=\{selected/,
  "One ambiguous selected pool must not drive both canonical and observed labels");
assert.match(workspaceSource, /referencePriceUsd=\{directoryMarket\.priceUsd\}/,
  "The resting chart headline must use the selected Token Market price authority");
assert.match(chartSource, /hovered\?\.close \?\? referencePriceUsd \?\? latest/,
  "Hover must retain exact historical candle close while rest uses the selected market price");
assert.match(chartSource, /Math\.abs\(change\)\.toFixed\(2\)\}% · \{range\}/,
  "Chart movement must be explicitly scoped to its selected range");
assert.doesNotMatch(chartSource, /"LIVE"/, "The chart must not expose a false LIVE range");
assert.match(workspaceSource, /vnMarketEvidenceStack[\s\S]*<VerifiedMarkets[\s\S]*<WorkspaceEcosystemIntelligence/,
  "up. venue evidence must remain nested under Markets");
assert.doesNotMatch(workspaceSource, /id: "ecosystem", label: "up\."/,
  "up. must not remain a permanent top-level workspace tab");
assert.match(workspaceSource, /marketHost[\s\S]*DexScreener[\s\S]*GeckoTerminal/,
  "Market actions must truthfully identify recognized external hosts");
assert.match(stylesSource, /\.vnEvidencePane \{ min-height: 0; \}/,
  "Unavailable holder evidence must not reserve an artificial 300px pane");
assert.doesNotMatch(stylesSource, /\.vnEvidencePane\s*\{\s*min-height:\s*300px/,
  "The legacy stretched Safety empty state must remain removed");
assert.match(stylesSource, /\.rmtMobileAssetView\s*\{\s*padding-bottom:\s*calc\(82px \+ env\(safe-area-inset-bottom\)\)/,
  "Mobile content must clear the fixed safe-area-aware trade dock");
const canonicalPool = (version: 2 | 3 | 4, protocol: "uniswap" | "sushiswap") => ({
  protocol,
  version,
  poolKey: version === 4 ? `0x${"ab".repeat(32)}` : exactPair
}) as VNextUniversalMarketSearchPool;
const tokenOnlyRiskUrl = tokenRiskEvidenceRequestUrl(selected);
const uniswapV2RiskUrl = tokenRiskEvidenceRequestUrl(selected, providerMarket, canonicalPool(2, "uniswap"));
const uniswapV3RiskUrl = tokenRiskEvidenceRequestUrl(selected, providerMarket, canonicalPool(3, "uniswap"));
const sushiRiskUrl = tokenRiskEvidenceRequestUrl(selected, providerMarket, canonicalPool(2, "sushiswap"));
const uniswapV4RiskUrl = tokenRiskEvidenceRequestUrl(selected, providerMarket, canonicalPool(4, "uniswap"));
assert.equal(new URL(tokenOnlyRiskUrl!, "http://localhost").searchParams.get("pair"), null);
assert.equal(new URL(uniswapV4RiskUrl!, "http://localhost").searchParams.get("pair"), null);
assert.equal(new URL(uniswapV2RiskUrl!, "http://localhost").searchParams.get("pair"), exactPair);
assert.equal(new URL(uniswapV3RiskUrl!, "http://localhost").searchParams.get("pair"), exactPair);
assert.equal(new URL(sushiRiskUrl!, "http://localhost").searchParams.get("venue"), "sushi");
assert.match(riskHookSource, /canonicalMarket && canonicalMarket\.version !== 4/,
  "PoolId-only V4 markets must not be passed into an address validator");
assert.match(workspaceSource, /useTokenRiskEvidence\(directoryMarket\.address/,
  "Token findings must use the selected asset identity instead of depending on provider market evidence");
assert.match(constellationHookSource, /canonicalMarket && canonicalMarket\.version !== 4/,
  "PoolId-only V4 markets must not call the address-pool constellation route");
for (const source of [riskHookSource, constellationHookSource]) {
  assert.doesNotMatch(source, /dexId\.toLowerCase/,
    "market findings must use explicit canonical protocol evidence instead of display strings");
}
const policySource = readFileSync(new URL("../server/robinhood-stock-token-registry.ts", import.meta.url), "utf8");
assert.match(policySource, /asset \? \{ status: "view-only", asset \}/, "Canonical stock tokens must remain view-only");

console.log("VNext asset workspace keeps token-level stock authority independent from exact-pair evidence.");
