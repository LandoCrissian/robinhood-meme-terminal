import assert from "node:assert/strict";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID,
  TRUSTED_ASSETS,
  TRUSTED_ASSET_ADDRESSES,
  requireTrustedAsset,
  trustedAsset,
  trustedAssetId,
  trustedPaymentAsset,
  trustedSettlementAsset
} from "./trusted-asset-registry";

assert.equal(TRUSTED_ASSETS.length, 9);
assert.equal(new Set(TRUSTED_ASSETS.map((asset) => asset.id)).size, TRUSTED_ASSETS.length);
assert.equal(trustedAssetId(BASE_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.BASE_USDC), `eip155:8453:${TRUSTED_ASSET_ADDRESSES.BASE_USDC.toLowerCase()}`);
assert.equal(trustedAsset(BASE_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.BASE_USDC)?.issuer, "Circle");
assert.equal(trustedAsset(ARBITRUM_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.BASE_USDC), null);
assert.equal(trustedAsset(ETHEREUM_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.ETHEREUM_USDC)?.paymentEligible, true);
assert.equal(trustedSettlementAsset(ROBINHOOD_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG)?.symbol, "USDG");
assert.equal(trustedSettlementAsset(ROBINHOOD_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDE), null);
assert.equal(trustedPaymentAsset(ROBINHOOD_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.ROBINHOOD_CANONICAL_GATEWAY_USDC), null);
assert.equal(trustedPaymentAsset(BASE_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.BASE_USDC)?.userVisible, false);
assert.equal(requireTrustedAsset(ROBINHOOD_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES.ROBINHOOD_SYRUP_USDG).risk.yieldBearing, true);
assert.throws(() => requireTrustedAsset(ROBINHOOD_MAINNET_CHAIN_ID, "0x0000000000000000000000000000000000000001"), /trusted chain-qualified registry/);

for (const asset of TRUSTED_ASSETS) {
  assert.equal(asset.id, `eip155:${asset.chainId}:${asset.address.toLowerCase()}`);
  assert.ok(asset.provenance.evidenceUrls.length > 0);
  assert.ok(asset.risk.disclosure.length > 12);
  if (asset.symbol === "USDC" && asset.chainId === ROBINHOOD_MAINNET_CHAIN_ID) {
    assert.equal(asset.userVisible, false);
    assert.equal(asset.paymentEligible, false);
    assert.equal(asset.settlementEligible, false);
  }
}

console.log("RMT trusted chain-qualified asset registry smoke checks passed.");
