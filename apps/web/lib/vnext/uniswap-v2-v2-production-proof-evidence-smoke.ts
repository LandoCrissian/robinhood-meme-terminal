import assert from "node:assert/strict";
import {
  RMT_UNISWAP_V2_V2_PRODUCTION_PROOF_EVIDENCE,
  assertRmtUniswapV2V2ProductionProofEvidence,
  type RmtUniswapV2V2ProductionProofEvidence
} from "./uniswap-v2-v2-production-proof-evidence";

assert.equal(assertRmtUniswapV2V2ProductionProofEvidence(RMT_UNISWAP_V2_V2_PRODUCTION_PROOF_EVIDENCE), true);

function mutated(mutator: (proof: RmtUniswapV2V2ProductionProofEvidence) => void) {
  const proof = structuredClone(RMT_UNISWAP_V2_V2_PRODUCTION_PROOF_EVIDENCE) as RmtUniswapV2V2ProductionProofEvidence;
  mutator(proof);
  return proof;
}

[
  mutated((proof) => { proof.transactionHash = `0x${"1".repeat(64)}`; }),
  mutated((proof) => { proof.blockNumber = "53089891"; }),
  mutated((proof) => { proof.blockHash = `0x${"2".repeat(64)}`; }),
  mutated((proof) => { proof.trader = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.executor = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.executorRuntimeHash = `0x${"3".repeat(64)}`; }),
  mutated((proof) => { proof.executionId = `0x${"4".repeat(64)}`; }),
  mutated((proof) => { proof.policyId = "RMT_EXECUTION_V1" as "RMT_EXECUTION_V2"; }),
  mutated((proof) => { proof.policyVersion = 1 as 2; }),
  mutated((proof) => { proof.policyHash = `0x${"5".repeat(64)}`; }),
  mutated((proof) => { proof.treasury = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.provider = "uniswap-v3" as "uniswap-v2"; }),
  mutated((proof) => { proof.settlementMode = "DIRECT_NO_RMT_FEE" as "VNEXT_V2_ATOMIC_INPUT_FEE"; }),
  mutated((proof) => { proof.feeBps = 26 as 25; }),
  mutated((proof) => { proof.feeSide = "output" as "input"; }),
  mutated((proof) => { proof.inputAsset = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.token = "OTHER" as "PONS"; }),
  mutated((proof) => { proof.tokenAddress = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.routeKind = "WETH_HOP" as "DIRECT"; }),
  mutated((proof) => { proof.v2WonNormalRanking = false as true; }),
  mutated((proof) => { proof.rankingIncludedRmtFee = false as true; }),
  mutated((proof) => { proof.userGrossInputAtomic = "100000000000001"; }),
  mutated((proof) => { proof.actualRmtFeeAtomic = "249999999999"; }),
  mutated((proof) => { proof.providerInputAtomic = "99750000000001"; }),
  mutated((proof) => { proof.protectedOutputAtomic = "468258049391365430"; }),
  mutated((proof) => { proof.actualOutputAtomic = "468258049391365428"; }),
  mutated((proof) => { proof.pair = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.pair1 = "0x1111111111111111111111111111111111111111"; }),
  mutated((proof) => { proof.settlementEventCount = 2 as 1; }),
  mutated((proof) => { proof.treasuryNativeDeltaAtomic = "249999999999"; }),
  mutated((proof) => { proof.executorPostState.nativeAtomic = "1" as "0"; }),
  mutated((proof) => { proof.executorPostState.canonicalWethAtomic = "1" as "0"; }),
  mutated((proof) => { proof.executorPostState.outputAssetAtomic = "1" as "0"; }),
  mutated((proof) => { proof.executorPostState.routerAllowanceAtomic = "1" as "0"; }),
  mutated((proof) => { proof.replayRejected = false as true; }),
  mutated((proof) => { proof.liveErc20ToNativeStatus = "PASS" as "OWNER_WAIVED_NOT_EXECUTED"; }),
  mutated((proof) => { proof.bidirectionalLiveProof = true as false; })
].forEach((proof) => {
  assert.throws(
    () => assertRmtUniswapV2V2ProductionProofEvidence(proof),
    /inconsistent Uniswap V2 V2 production proof evidence/
  );
});

console.log("RMT Uniswap V2 V2 immutable production proof evidence checks passed.");
