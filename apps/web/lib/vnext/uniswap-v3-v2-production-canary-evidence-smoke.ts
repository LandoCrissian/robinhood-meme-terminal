import assert from "node:assert/strict";
import {
  RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE,
  assertRmtUniswapV3V2ProductionCanaryEvidence,
  type RmtUniswapV3V2ProductionCanaryEvidence
} from "./uniswap-v3-v2-production-canary-evidence";

assert.equal(assertRmtUniswapV3V2ProductionCanaryEvidence(RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE), true);

function mutated(mutator: (proof: RmtUniswapV3V2ProductionCanaryEvidence) => void) {
  const proof = structuredClone(RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE) as RmtUniswapV3V2ProductionCanaryEvidence;
  mutator(proof);
  return proof;
}

[
  mutated((proof) => { proof.transactionHash = `0x${"1".repeat(64)}`; }),
  mutated((proof) => { proof.executionId = `0x${"1".repeat(64)}`; }),
  mutated((proof) => { proof.executor = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.treasury = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.feeBps = 26 as 25; }),
  mutated((proof) => { proof.actualRmtFeeAtomic = "249999999999"; }),
  mutated((proof) => { proof.providerInputAtomic = "99750000000001"; }),
  mutated((proof) => { proof.protectedOutputAtomic = "8586172043977260463"; }),
  mutated((proof) => { proof.settlementEventCount = 2 as 1; }),
  mutated((proof) => { proof.executorPostState.nativeAtomic = "1" as "0"; }),
  mutated((proof) => { proof.liveErc20ToNativeStatus = "PASS" as "OWNER_WAIVED_NOT_EXECUTED"; }),
  mutated((proof) => { (proof as { bidirectionalLiveProof: boolean }).bidirectionalLiveProof = true; })
].forEach((proof) => {
  assert.throws(() => assertRmtUniswapV3V2ProductionCanaryEvidence(proof), /inconsistent V2 production canary evidence/);
});

console.log("RMT Uniswap V3 V2 accepted production canary evidence checks passed.");
