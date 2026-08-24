import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExternalMarket, RobinhoodStockAssetRelationship, UniversalMarketResolution } from "../external-market";
import {
  exactWorkspaceMarket,
  mergeWorkspaceStockAssetRelationships,
  workspaceTokenPresentation
} from "../../app/vnext/use-vnext-asset-workspace";

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
assert.equal((workspaceSource.match(/currentMultiplier/g) ?? []).length, 1, "Stock multiplier must be displayed exactly once");
assert.doesNotMatch(workspaceSource, /priceUsd\s*\*\s*[^\n]*currentMultiplier|currentMultiplier\s*\*\s*[^\n]*priceUsd/);
assert.match(workspaceSource, /last known, non-authoritative/, "Stale registry presentation must be explicitly non-authoritative");
const policySource = readFileSync(new URL("../server/robinhood-stock-token-registry.ts", import.meta.url), "utf8");
assert.match(policySource, /asset \? \{ status: "view-only", asset \}/, "Canonical stock tokens must remain view-only");

console.log("VNext asset workspace keeps token-level stock authority independent from exact-pair evidence.");
