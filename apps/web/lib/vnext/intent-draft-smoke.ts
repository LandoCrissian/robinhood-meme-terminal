import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assetKey, evmAsset, evmChain, type AssetMetadata, type WalletAccount } from "./execution-domain";
import { affordableDefaultAmount, assetsForSide, createExactInputIntent, decimalToAtomic, percentageOfAtomic } from "./intent-draft";
import { ROBINHOOD_RMT, ROBINHOOD_USDG, robinhoodWalletAccount } from "./robinhood-assets";

const wallet = robinhoodWalletAccount("0x1111111111111111111111111111111111111111");

assert.equal(decimalToAtomic("100", 6), "100000000");
assert.equal(decimalToAtomic("1.25", 6), "1250000");
assert.equal(decimalToAtomic("0.000001", 6), "1");
for (const invalid of ["", "0", "-1", "1e2", "1,000", "01", "0.0000001"]) {
  assert.throws(() => decimalToAtomic(invalid, 6));
}
assert.equal(percentageOfAtomic("100000001", 2_500), "25000000");
assert.equal(percentageOfAtomic("100000001", 10_000), "100000001");
assert.throws(() => percentageOfAtomic("-1", 5_000), /unsigned atomic/);
assert.throws(() => percentageOfAtomic("1", 0), /between/);
assert.throws(() => percentageOfAtomic("1", 10_001), /between/);
assert.throws(() => percentageOfAtomic("1", 2_500), /too small/);
assert.equal(affordableDefaultAmount("40771730", 6, "25"), "25");
assert.equal(affordableDefaultAmount("10123456", 6, "25"), "10.123456");
assert.equal(affordableDefaultAmount("1", 6, "25"), "0.000001");
assert.equal(affordableDefaultAmount("0", 6, "25"), "");
assert.throws(() => affordableDefaultAmount("-1", 6, "25"), /unsigned atomic/);

const buy = assetsForSide("buy", ROBINHOOD_RMT, ROBINHOOD_USDG);
assert.equal(assetKey(buy.inputAsset.id), assetKey(ROBINHOOD_USDG.id));
assert.equal(assetKey(buy.outputAsset.id), assetKey(ROBINHOOD_RMT.id));

const sell = assetsForSide("sell", ROBINHOOD_RMT, ROBINHOOD_USDG);
assert.equal(assetKey(sell.inputAsset.id), assetKey(ROBINHOOD_RMT.id));
assert.equal(assetKey(sell.outputAsset.id), assetKey(ROBINHOOD_USDG.id));

const intent = createExactInputIntent({
  intentId: "smoke:rmt-buy",
  sourceAccount: wallet,
  recipient: wallet,
  inputAsset: buy.inputAsset,
  outputAsset: buy.outputAsset,
  amount: "25.50",
  requestedAtMs: 1_786_000_000_000
});
assert.equal(intent.amountAtomic, "25500000");
assert.equal(intent.tradeType, "exact_input");
assert.equal(intent.recipient.address, wallet.address);

const reportedAsset: AssetMetadata = { ...ROBINHOOD_RMT, metadataState: "reported" };
assert.throws(() => createExactInputIntent({
  intentId: "smoke:reported",
  sourceAccount: wallet,
  recipient: wallet,
  inputAsset: ROBINHOOD_USDG,
  outputAsset: reportedAsset,
  amount: "1",
  requestedAtMs: 1
}), /verified identity/);

const ethereumWallet: WalletAccount = { ...wallet, accountId: "eip155:1:test", chain: evmChain(1) };
assert.throws(() => createExactInputIntent({
  intentId: "smoke:wrong-chain",
  sourceAccount: ethereumWallet,
  recipient: wallet,
  inputAsset: ROBINHOOD_USDG,
  outputAsset: ROBINHOOD_RMT,
  amount: "1",
  requestedAtMs: 1
}), /different chains/);

const sameAsset: AssetMetadata = {
  ...ROBINHOOD_USDG,
  id: evmAsset(4_663, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168")
};
assert.throws(() => createExactInputIntent({
  intentId: "smoke:same-asset",
  sourceAccount: wallet,
  recipient: wallet,
  inputAsset: ROBINHOOD_USDG,
  outputAsset: sameAsset,
  amount: "1",
  requestedAtMs: 1
}), /assets must differ/);

const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(composer, /Fresh quote required/);
assert.match(composer, /Protected executable output is set during the one-tap execution check/);
assert.match(composer, /One action handles routing, verification, simulation, and exact payload preparation/);
assert.doesNotMatch(composer, /Check live routes|Verify best route|Prepare wallet review/);
assert.match(composer, /Pay with asset/);
assert.match(composer, /Receive asset/);
assert.match(composer, /walletAssets\.flatMap/);
assert.match(composer, /metadataFromDetectedWalletAsset/);
assert.match(composer, /No different verified wallet-held input asset is detected/);
assert.match(composer, /ROBINHOOD_USDG, ROBINHOOD_WETH/);
assert.match(composer, /pair\.inputAsset\.id/);
assert.match(composer, /percentageOfAtomic/);
assert.match(composer, /affordableDefaultAmount/);
assert.match(composer, /autoFitBuyAmount/);
assert.match(composer, /confirmedUsdgBalance/);
assert.match(composer, /setAmount\(next === "buy" \? selectedDefaultBuyAmount : ""\)/);
assert.match(composer, /Confirmed balance percentages/);
assert.match(composer, /Amount exceeds the confirmed/);
assert.match(composer, /Authorization must remain blocked/);
assert.match(composer, /BigInt\(draft\.intent\.amountAtomic\) > BigInt\(inputBalanceAtomic\)/);
assert.match(composer, /This preview asset has no verified chain-qualified contract identity/);
assert.match(composer, /!identity\.enabled/);
assert.match(composer, /Trading identity unavailable/);
assert.match(composer, /RMT will not request a quote or prepare a wallet transaction/);
assert.doesNotMatch(composer, /fetch\s*\(|writeContract|sendTransaction|useSendTransaction|signTypedData/);
assert.match(composer, /ROBINHOOD_ETH/);
assert.match(composer, /ROBINHOOD_NATIVE_ASSET_ADDRESS/);
assert.match(composer, /NATIVE_GAS_RESERVE_ATOMIC/);
assert.doesNotMatch(composer, /UniswapX|24,581|24,312|102\.82/);

console.log("RMT VNext intent draft smoke checks passed.");
