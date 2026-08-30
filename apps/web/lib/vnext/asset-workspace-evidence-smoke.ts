import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExternalMarket, RobinhoodStockAssetRelationship, UniversalMarketResolution } from "../external-market";
import {
  exactWorkspaceMarket,
  mergeWorkspaceStockAssetRelationships,
  workspaceTokenPresentation
} from "../../app/vnext/use-vnext-asset-workspace";
import { tokenRiskEvidenceRequestUrl } from "../use-token-risk-evidence";
import { tokenRiskCoverageLabel, tokenRiskFreshnessLabel } from "../token-risk-evidence";
import type { VNextUniversalMarketSearchPool } from "./universal-market-search-contract";

const selected = "0x1111111111111111111111111111111111111111";
const exactPair = "0x2222222222222222222222222222222222222222";
const mismatchedPair = "0x3333333333333333333333333333333333333333";
const ponsContract = "0x39dbed3a2bd333467115de45665cc57f813c4571";
const ponsCanonicalPool = "0x10cc6bd38112cac182db90b6a71d8bb5939526ba";
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
const visualQaSource = readFileSync(new URL("../../../../scripts/visual-qa/legion-visual-qa.mjs", import.meta.url), "utf8");
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
assert.match(workspaceSource, /aria-expanded=\{linksOpen\}/,
  "Additional safe links must use an explicit accessible disclosure control");
assert.match(workspaceSource, /More links \{moreLinkCount\}/,
  "The disclosure count must come from the actual safe rendered links");
assert.match(workspaceSource, /linksOpen && moreLinkCount/,
  "A zero-link disclosure must not reserve empty workspace space");
assert.match(workspaceSource, /Observed from market metadata/,
  "Observed links must preserve their provider-metadata provenance");
assert.match(workspaceSource, /tokenIdentityVerified[\s\S]*Onchain verified/,
  "Safety must reuse the selected workspace token-identity authority");
assert.match(workspaceSource, /Contract risk evidence unavailable/,
  "A full risk transport failure must collapse to one truthful compact state");
assert.match(workspaceSource, /riskUnavailable \|\| !domainAvailable\("liquidity"\)/,
  "A complete risk outage must use the compact liquidity-unavailable branch");
assert.match(workspaceSource, /poolShareBps !== null[\s\S]*Liquidity-control evidence unavailable/,
  "Known holder-derived pool share must survive an unavailable liquidity-control domain");
assert.match(workspaceSource, /Displayed market liquidity and exact pool identity remain available where shown/,
  "The compact liquidity outage must preserve truthful displayed-market and pool evidence");
assert.doesNotMatch(workspaceSource, /Source published[\s\S]*Bytecode change[\s\S]*Contract controls[\s\S]*Coverage/,
  "A transport failure must not render the legacy wall of Unknown fields");
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
const ponsRiskUrl = tokenRiskEvidenceRequestUrl(
  ponsContract,
  undefined,
  { ...canonicalPool(3, "uniswap"), poolKey: ponsCanonicalPool }
);
assert.equal(new URL(tokenOnlyRiskUrl!, "http://localhost").searchParams.get("pair"), null);
assert.equal(new URL(uniswapV4RiskUrl!, "http://localhost").searchParams.get("pair"), null);
assert.equal(new URL(uniswapV2RiskUrl!, "http://localhost").searchParams.get("pair"), exactPair);
assert.equal(new URL(uniswapV3RiskUrl!, "http://localhost").searchParams.get("pair"), exactPair);
assert.equal(new URL(sushiRiskUrl!, "http://localhost").searchParams.get("venue"), "sushi");
assert.deepEqual(Object.fromEntries(new URL(ponsRiskUrl!, "http://localhost").searchParams), {
  token: ponsContract,
  pair: ponsCanonicalPool,
  venue: "uniswap",
  sourceId: "pons"
}, "PONS risk evidence must retain exact canonical request authority without provider metadata");
assert.equal(tokenRiskCoverageLabel("complete"), "Complete evidence");
assert.equal(tokenRiskCoverageLabel("partial"), "Partial evidence");
assert.equal(tokenRiskFreshnessLabel("fresh"), "Fresh");
assert.equal(tokenRiskFreshnessLabel("stale"), "Stale");
assert.match(workspaceSource, /<small>Coverage<\/small>/);
assert.match(workspaceSource, /<small>Evidence freshness<\/small><strong>\{tokenRiskFreshnessLabel\(evidence\.freshness\)\}/);
assert.doesNotMatch(workspaceSource, /<small>Evidence freshness<\/small><strong>\{[^}]*evidence\.coverage/);
assert.match(workspaceSource, /Concentration details are temporarily unavailable/);
assert.match(workspaceSource, /LP ownership\/control · Not verified/);
assert.match(workspaceSource, /Largest non-pool holder/,
  "An address-style market must label concentration without inferring an EOA wallet");
assert.match(workspaceSource, /Largest visible holder/,
  "Token-only evidence must retain a neutral visible-holder label");
assert.doesNotMatch(workspaceSource, /Largest wallet/,
  "Unknown holder classification must never be promoted to wallet evidence");
assert.match(workspaceSource, /isContract === false \? "Wallet" : "Classification unknown"/,
  "Only explicit non-contract classification may render a holder row as Wallet");
assert.match(workspaceSource, /className="vnEvidenceFact"><small>Pool token share/,
  "A no-position pool share must use one compact fact instead of a multi-column grid");
assert.match(stylesSource, /\.vnEvidenceFact\s*\{[\s\S]*display:\s*flex/,
  "The compact liquidity fact must not reserve an empty grid companion cell");
assert.match(visualQaSource, /coverage: riskMode === "partial" \|\| countOnly \? "partial" : "complete"/,
  "Count-only fixtures must downgrade overall coverage to partial");
assert.match(visualQaSource, /sell: countOnly \? "unavailable" : "ready"/,
  "Count-only fixtures must not claim a ready sell domain");
assert.match(visualQaSource, /countOnly \? \{ status: "not-run"[\s\S]*\} : \{ status: "passed"/,
  "Ready fixtures must complete the sell check while count-only fixtures remain not-run");
assert.match(workspaceSource, /Pool swap fee ·/);
assert.doesNotMatch(workspaceSource, /% live fee/);
assert.match(workspaceSource, /Other verified venues · \{markets\.length\}/);
assert.match(workspaceSource, /Venue evidence does not prove project origin/);
assert.match(workspaceSource, /hasVerifiedRwaRelationship \? \[\{ id: "rwa"/);
assert.match(chartSource, /Sparse \$\{labels\[range\]\} market history/);
assert.match(chartSource, /candles\.length >= 1/);
assert.match(chartSource, /vnChartSparsePoint/);
assert.match(chartSource, /candles\.length === 1[\s\S]*left \+ usableWidth \/ 2/,
  "A single real observation must be centered instead of looking like a broken left-edge chart");
assert.match(chartSource, /const volumeWidth = Math\.max\(2, Math\.min\(11,/,
  "Sparse volume bars must remain visually bounded without inventing observations");
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
