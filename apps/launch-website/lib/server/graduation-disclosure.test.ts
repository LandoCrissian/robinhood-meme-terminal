import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { launchTerms, launchTokenSupplyWei, minimumGraduationGrossWei } from "../launch-terms";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";

const evidence = new URL("../../../../docs/evidence/", import.meta.url);

test("creator disclosures agree with the published factory compiler input and its fork quotes", () => {
  const raw = gunzipSync(readFileSync(new URL("rmt-task091/governance/source-publication/solc-standard-input-4663.json.gz", evidence)));
  const proof = JSON.parse(readFileSync(new URL("graduation-economics/measurements.json", evidence), "utf8"));
  assert.equal(createHash("sha256").update(raw).digest("hex"), curveProductionDeployment.compilerInputSha256);
  assert.equal(proof.compilerInputSha256, curveProductionDeployment.compilerInputSha256);
  assert.equal(proof.direct.factoryHash, curveProductionPins.factory[1]);
  assert.equal(proof.forksAgreed, true);
  const math = JSON.parse(raw.toString()).sources["src/RMTLaunchCurveMathV1.sol"].content;
  assert.ok(math.includes("VIRTUAL_ETH = " + launchTerms.virtualEth + " ether;"));
  assert.ok(math.includes("GRADUATION_BACKING = " + launchTerms.graduationBackingEth + " ether;"));
  const { words, table } = proof.simulation;
  const wei = 10n ** 18n;
  assert.equal(BigInt(words.VIRTUAL_ETH), BigInt(launchTerms.virtualEth) * wei);
  assert.equal(BigInt(words.GRADUATION_BACKING), BigInt(launchTerms.graduationBackingEth) * wei);
  assert.equal(BigInt(words.TRADE_FEE_BPS), BigInt(launchTerms.curveTradeFeePercent * 100));
  assert.equal(BigInt(words.totalSupply), launchTokenSupplyWei);
  const terminal = table.at(-1);
  assert.equal(BigInt(terminal.tokens), launchTokenSupplyWei * BigInt(launchTerms.curveAllocationPercent) / 100n);
  assert.equal(minimumGraduationGrossWei, BigInt(terminal.gross));
  assert.equal(BigInt(terminal.gross) - BigInt(terminal.fee), BigInt(words.GRADUATION_BACKING));
  assert.equal(BigInt(proof.direct.funding[2]) + BigInt(proof.simulation.nativeDust), BigInt(words.GRADUATION_BACKING));
  assert.equal(BigInt(proof.direct.funding[3]) + BigInt(proof.simulation.tokenDust), launchTokenSupplyWei * BigInt(launchTerms.liquidityAllocationPercent) / 100n);
  assert.equal(proof.simulation.poolFee, Number(launchTerms.graduationPoolFeePercent) * 10_000);
});
