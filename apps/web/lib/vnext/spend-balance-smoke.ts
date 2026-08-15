import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assetKey, spendableAtomic } from "./execution-domain";
import type { ExternalMarketResponse } from "../external-market";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_USDG,
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH,
  ROBINHOOD_WETH_ADDRESS,
  confirmedBalanceSnapshot,
  robinhoodWalletAccount
} from "./robinhood-assets";
import {
  detectedWalletAssets,
  importedWalletCandidate,
  trustedPaymentMetadataFromDetectedWalletAsset,
  walletAssetCandidates
} from "./wallet-assets";

const component = readFileSync(new URL("../../app/vnext/spend-balance.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../app/vnext/use-vnext-wallet-assets.ts", import.meta.url), "utf8");
const wallet = robinhoodWalletAccount("0x1111111111111111111111111111111111111111");
const balance = confirmedBalanceSnapshot({
  account: wallet,
  asset: ROBINHOOD_USDG,
  settledAtomic: 428_160_000n,
  observedAtMs: 1_700_000_000_000
});

assert.equal(ROBINHOOD_MAINNET_CHAIN_ID, 4_663);
assert.equal(ROBINHOOD_USDG_ADDRESS, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
assert.equal(ROBINHOOD_WETH_ADDRESS, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
assert.equal(ROBINHOOD_USDG.decimals, 6);
assert.equal(ROBINHOOD_WETH.decimals, 18);
assert.equal(assetKey(ROBINHOOD_USDG.id), `eip155:4663/contract:${ROBINHOOD_USDG_ADDRESS.toLowerCase()}`);
assert.equal(spendableAtomic(balance), "428160000");
assert.equal(balance.pendingIncomingAtomic, "0");
assert.equal(balance.pendingOutgoingAtomic, "0");
const candidates = walletAssetCandidates([{
  address: "0x2222222222222222222222222222222222222222",
  name: "Live directory token",
  symbol: "LIVE",
  priceUsd: 1,
  liquidityUsd: 1,
  marketCapUsd: 1,
  volume24h: 1,
  priceChange24h: 0,
  ageMinutes: 1,
  signal: "active"
}]);
assert.equal(candidates.length, 4);
const imported = importedWalletCandidate({
  resolution: {
    chainId: 4_663,
    requestedAddress: "0x3333333333333333333333333333333333333333",
    requestedKind: "token",
    status: "token-only",
    token: {
      address: "0x3333333333333333333333333333333333333333",
      name: "Imported asset",
      symbol: "IMPT",
      decimals: 8,
      totalSupply: "100000000"
    },
    pools: [],
    marketData: "identity-only",
    execution: "view-only",
    provenance: "robinhood-chain-contract-reads",
    resolvedAt: "2026-08-08T00:00:00.000Z"
  }
} as ExternalMarketResponse, "0x3333333333333333333333333333333333333333");
assert.equal(imported?.source, "manual_import");
assert.equal(imported?.decimals, 8);
assert.equal(importedWalletCandidate({} as ExternalMarketResponse, "0x3333333333333333333333333333333333333333"), null);
assert.deepEqual(detectedWalletAssets([
  { candidate: candidates[0], balance: 0n },
  { candidate: candidates[3], balance: 42n, decimals: 18, symbol: "LIVE", name: "Live directory token" }
]).map((asset) => ({ symbol: asset.symbol, balance: asset.balanceAtomic, routeState: asset.routeState })), [
  { symbol: "LIVE", balance: "42", routeState: "detected" }
]);
const canonicalPayment = trustedPaymentMetadataFromDetectedWalletAsset({
  ...candidates[0],
  balanceAtomic: "1000000",
  routeState: "detected"
});
assert.equal(canonicalPayment?.symbol, "USDG");
assert.equal(canonicalPayment?.decimals, 6);
assert.equal(trustedPaymentMetadataFromDetectedWalletAsset({
  ...candidates[1],
  balanceAtomic: "1000000000000000000",
  routeState: "detected"
})?.symbol, "WETH");
assert.equal(trustedPaymentMetadataFromDetectedWalletAsset({
  ...candidates[0],
  reputation: "suspicious",
  balanceAtomic: "1000000",
  routeState: "detected"
}), null);
assert.equal(trustedPaymentMetadataFromDetectedWalletAsset({
  ...candidates[3],
  decimals: 18,
  identityState: "verified",
  balanceAtomic: "42",
  routeState: "detected"
}), null);
assert.equal(trustedPaymentMetadataFromDetectedWalletAsset({
  ...candidates[0],
  address: "0x4444444444444444444444444444444444444444",
  symbol: "USDG",
  name: "Counterfeit USDG",
  source: "wallet_index",
  decimals: 6,
  identityState: "verified",
  balanceAtomic: "1000000",
  routeState: "detected"
}), null);
assert.match(component, /Confirmed wallet-held USDG/);
assert.match(component, /<FundWalletButton variant="inline" label="Add funds" target="mainnet" \/>/);
assert.doesNotMatch(component, /Verify USDG/);
assert.match(component, /Unconfirmed proceeds are never spendable/);
assert.match(component, /executionRecord\?\.state === "submitted"/);
assert.match(component, /executionRecord\.state !== "confirmed"/);
assert.match(component, /SETTLEMENT_BALANCE_REFRESH_DELAYS_MS = \[0, 900, 2_500\]/);
assert.match(component, /executionRecord\.kind !== "swap"/);
assert.match(component, /void refreshBalances\.current\(false\)/);
assert.match(component, /Indexer finds assets; onchain reads confirm balances/);
assert.match(component, /route not checked/);
assert.match(component, /useVNextWalletAssets/);
assert.match(component, /onNativeBalanceChange\?\.\(nativeBalance\)/);
assert.match(component, /\/api\/vnext\/asset-identity/);
assert.match(component, /functionName: "balanceOf"/);
assert.match(component, /balance <= 0n/);
assert.match(component, /Its execution route has not been checked/);
assert.match(hook, /publicClient\.multicall/);
assert.match(hook, /balanceRequestId/);
assert.match(hook, /discoveryRequestId/);
assert.doesNotMatch(hook, /const requestId = useRef/);
assert.match(hook, /functionName: "balanceOf"/);
assert.match(hook, /getBalance/);
assert.match(hook, /\/api\/vnext\/wallet-assets/);
assert.match(hook, /normalizeWalletDiscoveryResponse/);
assert.match(hook, /walletDiscoveryCandidate/);
assert.match(hook, /positive\.filter/);
assert.match(hook, /const EMPTY_WALLET_ASSETS: VNextDetectedWalletAsset\[\] = \[\]/);
assert.match(hook, /assets: snapshotIsCurrent \? assets : EMPTY_WALLET_ASSETS/);
assert.doesNotMatch(hook, /assets: snapshotIsCurrent \? assets : \[\]/);
assert.doesNotMatch(hook, /\/api\/trade|\/api\/vnext\/quotes/);
assert.doesNotMatch(component, /writeContract|sendTransaction|signTypedData|useSendTransaction/);
assert.doesNotMatch(hook, /writeContract|sendTransaction|signTypedData|useSendTransaction/);
assert.doesNotMatch(component, /localStorage|sessionStorage|firestore|database|\/api\/vnext\/quotes/);
assert.doesNotMatch(component, /\$428\.16|\$1,862\.34|\+\$102\.82/);

console.log("RMT VNext Spend Balance smoke checks passed.");
