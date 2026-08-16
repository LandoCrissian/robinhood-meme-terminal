import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  configuredVNextUniswapFeeExecutor,
  isVNextUniswapFeeRecipientEligible
} from "../server/vnext-uniswap-fee-executor";
import {
  RMT_UNISWAP_V3_FEE_MAINNET_PROOF,
  assertRmtUniswapV3FeeMainnetProof,
  type RmtUniswapV3FeeMainnetProof
} from "./uniswap-v3-fee-mainnet-proof";

assert.equal(assertRmtUniswapV3FeeMainnetProof(RMT_UNISWAP_V3_FEE_MAINNET_PROOF), true);

function mutatedProof(mutator: (proof: RmtUniswapV3FeeMainnetProof) => void) {
  const proof = structuredClone(RMT_UNISWAP_V3_FEE_MAINNET_PROOF) as RmtUniswapV3FeeMainnetProof;
  mutator(proof);
  return proof;
}

[
  mutatedProof((proof) => { proof.chainId = 1; }),
  mutatedProof((proof) => { proof.receiptStatus = "reverted" as "success"; }),
  mutatedProof((proof) => { proof.transactionHash = `0x${"0".repeat(64)}`; }),
  mutatedProof((proof) => { proof.blockHash = `0x${"0".repeat(64)}`; }),
  mutatedProof((proof) => { proof.executor = "0x1111111111111111111111111111111111111111"; }),
  mutatedProof((proof) => { proof.trader = "0x1111111111111111111111111111111111111111"; }),
  mutatedProof((proof) => { proof.policyVersion = 2; }),
  mutatedProof((proof) => { proof.policyHash = `0x${"1".repeat(64)}`; }),
  mutatedProof((proof) => { proof.feeBps = 26; }),
  mutatedProof((proof) => { proof.actualRmtFeeAtomic = "251"; }),
  mutatedProof((proof) => { proof.providerInputAtomic = "99749"; }),
  mutatedProof((proof) => { proof.actualUserNetOutputAtomic = "53073785359107"; }),
  mutatedProof((proof) => { proof.walletBalances.postUsdgAtomic = "143433"; }),
  mutatedProof((proof) => { proof.walletBalances.postWethAtomic = "1646812621893885"; }),
  mutatedProof((proof) => { proof.walletBalances.postNativeWei = "2501157498729513"; }),
  mutatedProof((proof) => { proof.treasuryBalances.postFeeAssetAtomic = "249"; }),
  mutatedProof((proof) => { proof.executorPostState.inputAssetAtomic = "1"; }),
  mutatedProof((proof) => { proof.executorPostState.routerAllowanceAtomic = "1"; }),
  mutatedProof((proof) => { proof.executorPostState.executionConsumed = false as true; }),
  mutatedProof((proof) => { proof.settlementEventCount = 2 as 1; }),
  mutatedProof((proof) => { proof.minimumConfirmations = 1; })
].forEach((proof) => {
  assert.throws(() => assertRmtUniswapV3FeeMainnetProof(proof), /invalid Uniswap V3 fee mainnet proof/);
});

const baseEnvironment = {
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executorRuntimeHash,
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.treasury,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "35041945",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: [
    "eip155:4663/contract:0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    "eip155:4663/contract:0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    "eip155:4663/native"
  ].join(",")
} as unknown as NodeJS.ProcessEnv;

const proofWalletConfig = configuredVNextUniswapFeeExecutor(baseEnvironment);
assert.equal(proofWalletConfig?.releaseScope, "proof-wallet");
assert.equal(isVNextUniswapFeeRecipientEligible(proofWalletConfig!, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader), true);
assert.equal(isVNextUniswapFeeRecipientEligible(proofWalletConfig!, "0x1111111111111111111111111111111111111111"), false);

const publicConfig = configuredVNextUniswapFeeExecutor({
  ...baseEnvironment,
  RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED: "true"
});
assert.equal(publicConfig?.releaseScope, "public");
assert.equal(isVNextUniswapFeeRecipientEligible(publicConfig!, "0x1111111111111111111111111111111111111111"), true);
assert.throws(() => configuredVNextUniswapFeeExecutor({
  RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv), /requires both the policy and provider/);
assert.throws(() => configuredVNextUniswapFeeExecutor({
  ...baseEnvironment,
  RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: `0x${"1".repeat(64)}`
}), /does not match the admitted mainnet proof/);

const deploymentManifest = JSON.parse(readFileSync(
  new URL("../../../../packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v1.json", import.meta.url),
  "utf8"
)) as {
  feeActivationAuthorized: boolean;
  deterministicDeployment: { predictedExecutor: string; expectedRuntimeHash: string };
  policy: { policyHash: string; feeBps: number };
  controlledProof?: { transactionHash: string; blockNumber: string; actualRmtFeeAtomic: string };
};
assert.equal(deploymentManifest.feeActivationAuthorized, false);
assert.equal(deploymentManifest.deterministicDeployment.predictedExecutor, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor);
assert.equal(deploymentManifest.deterministicDeployment.expectedRuntimeHash, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executorRuntimeHash);
assert.equal(deploymentManifest.policy.policyHash, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.policyHash);
assert.equal(deploymentManifest.policy.feeBps, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.feeBps);
assert.equal(deploymentManifest.controlledProof?.transactionHash, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.transactionHash);
assert.equal(deploymentManifest.controlledProof?.blockNumber, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.blockNumber);
assert.equal(deploymentManifest.controlledProof?.actualRmtFeeAtomic, RMT_UNISWAP_V3_FEE_MAINNET_PROOF.actualRmtFeeAtomic);

console.log("RMT Uniswap V3 controlled proof and public-release gate checks passed.");
