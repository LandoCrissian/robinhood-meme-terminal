import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const artifact = JSON.parse(readFileSync(new URL("../../evidence/trading-hardening/zero-x-50-token-matrix.json", import.meta.url), "utf8"));
assert.equal(artifact.baseSha, "df77bafe05417426baff0ea139649e6d7be951ae");
assert.equal(artifact.seed, 5272840);
assert.equal(artifact.tokensSampled, 50);
assert.equal(artifact.rows.length, 100);
assert.equal(artifact.blocker, null);
assert.equal(new Set(artifact.rows.map((row) => row.assetContract.toLowerCase())).size, 50);
assert.equal(artifact.rows.filter((row) => row.direction === "BUY").length, 50);
assert.equal(artifact.rows.filter((row) => row.direction === "SELL").length, 50);
let randomState = artifact.seed;
const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; };
const buckets = ["V2", "V3", "V4", "OTHER"].map((key) => {
  const candidates = artifact.samplingPopulation.filter((market) => market.bucket === key);
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  return candidates;
});
const selected = [];
while (selected.length < 50) for (const candidates of buckets) if (selected.length < 50 && candidates.length) selected.push(candidates.shift());
assert.deepEqual(artifact.rows.filter((row) => row.direction === "BUY").map((row) => row.assetContract.toLowerCase()), selected.map((market) => market.address.toLowerCase()), "logged seed reproduces the actual stratified sample");
const stocks = new Set(artifact.stockControls.map((row) => row.address.toLowerCase()));
assert.ok(stocks.size >= 3);
for (const row of artifact.stockControls) {
  assert.equal(row.state, "VIEW_ONLY");
  assert.equal(row.quoteRequests, 0);
}
for (const row of [...artifact.rows, ...artifact.peepCases]) {
  assert.equal(row.provider, "zero-x-swap");
  assert.equal(row.chainId, 4663);
  assert.equal(row.rmtFeeBps, 25);
  assert.equal(row.feeAsset, row.inputAsset);
  assert.equal(row.providerSlippagePpm, 9900);
  assert.equal(row.maximumUserSlippagePpm, 10000);
  assert.ok(!stocks.has(row.assetContract.toLowerCase()));
  if (row.zeroXQuoteStatus === "FIRM_RETURNED") {
    assert.equal(row.transactionTarget.toLowerCase(), "0x0000000000001ff3684f28c67538d4d072c22734");
    assert.equal(row.targetRuntimeHash, "0x99f5e8edaceacfdd183eb5f1da8a7757b322495b80cf7928db289a1b1a09f799");
    assert.equal(row.settlerTarget.toLowerCase(), "0x39b38686a19836ac10162c490e4558e120cbbe5f");
    assert.equal(row.settlerRuntimeHash, "0xb6c0bf3b83bc9ae4f6ed65a4f5f6c188eb3e4258d8d3b3705dff4ac02ed4a966");
    assert.ok(BigInt(row.protectedOutput) * 1000000n >= BigInt(row.expectedOutput) * 990000n);
    assert.equal(row.executableBound, true);
  }
  if (row.fundedSimulation?.status === "PASS") {
    assert.equal(row.fundedSimulation.calldataHash, row.calldataHash);
    assert.equal(row.fundedSimulation.transactionTarget, row.transactionTarget);
    assert.equal(row.fundedSimulation.transactionValue, row.transactionValue);
    assert.equal(row.fundedSimulation.exactEnvelopePreserved, true);
    assert.equal(row.fundedSimulation.walletAuthority, false);
    if (row.fundedSimulation.allowanceAtomic) {
      assert.equal(row.fundedSimulation.allowanceAtomic, row.testAmount);
      assert.equal(row.fundedSimulation.allowanceSpender.toLowerCase(), "0x0000000000001ff3684f28c67538d4d072c22734");
    }
  }
}
for (let sample = 1; sample <= 50; sample++) {
  const pair = artifact.rows.filter((row) => row.sampleIndex === sample);
  assert.equal(pair.length, 2);
  assert.equal(pair[0].assetContract, pair[1].assetContract);
  assert.equal(pair[0].inputAsset, pair[1].outputAsset);
  assert.equal(pair[0].outputAsset, pair[1].inputAsset);
}
assert.equal(artifact.peepCases.length, 4);
assert.ok(artifact.peepCases.every((row) => row.assetContract.toLowerCase() === "0xf0821f2bf570ca4e7499a9ed9db7c788fed9946f"));
assert.equal(artifact.legacyExecutorCalls, 0);
assert.equal(artifact.walletRequests, 0);
assert.equal(artifact.signatures, 0);
assert.equal(artifact.transactions, 0);
console.log("Frozen live 50-token/100-direction matrix evidence is internally consistent; unavailable simulations are not passes.");
