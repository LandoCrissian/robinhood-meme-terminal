import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getAddress, getCreate2Address } from "viem";
import { createRmtExecutionV1Policy } from "./execution-fee-policy";
import { rmtUniswapV3PolicyIdHash } from "./uniswap-v3-fee-executor";

async function main() {
  const manifestUrl = new URL(
    "../../../../packages/contracts/deployments/rmt-uniswap-v3-fee-executor-v1.json",
    import.meta.url
  );
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, "prepared_not_authorized");
  assert.equal(manifest.chainId, 4_663);
  assert.equal(manifest.contract, "RMTUniswapV3FeeExecutorV1");
  assert.match(manifest.sourceBaseline, /^[0-9a-f]{40}$/);
  assert.equal(manifest.deploymentAuthorized, false);
  assert.equal(manifest.feeActivationAuthorized, false);
  assert.equal(manifest.deterministicDeployment.deploymentTransaction, null);
  assert.equal(manifest.treasury.kind, "safe_1_of_1");
  assert.equal(manifest.treasury.threshold, 1);
  assert.equal(getAddress(manifest.treasury.address), getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC"));
  assert.equal(getAddress(manifest.treasury.owner), getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"));
  assert.notEqual(getAddress(manifest.treasury.address), getAddress(manifest.treasury.owner));
  assert.equal(manifest.policy.fromBlock, manifest.treasury.deploymentBlock);
  assert.equal(manifest.policy.beforeBlock, null);
  assert.deepEqual(manifest.policy.eligibleFeeAssets.map((asset: string) => getAddress(asset)), [
    getAddress(manifest.infrastructure.weth),
    getAddress(manifest.infrastructure.usdg)
  ]);
  assert.equal(manifest.policy.nativeFeeAssetEligible, true);

  const policy = createRmtExecutionV1Policy({
    treasury: manifest.treasury.address,
    chainId: manifest.chainId,
    fromBlock: manifest.policy.fromBlock,
    beforeBlock: manifest.policy.beforeBlock,
    eligibleSettlementAssetIds: manifest.policy.eligibleSettlementAssetIds
  });
  assert.equal(policy.policyId, manifest.policy.policyId);
  assert.equal(policy.version, manifest.policy.version);
  assert.equal(policy.feeBps, manifest.policy.feeBps);
  assert.equal(policy.policyHash, manifest.policy.policyHash);
  assert.equal(rmtUniswapV3PolicyIdHash(policy.policyId), manifest.policy.policyIdHash);

  assert.equal(
    getCreate2Address({
      from: getAddress(manifest.deterministicDeployment.factory),
      salt: manifest.deterministicDeployment.salt,
      bytecodeHash: manifest.deterministicDeployment.initCodeHash
    }),
    getAddress(manifest.deterministicDeployment.predictedExecutor)
  );

  console.log("RMT Uniswap V3 fee deployment manifest remains exact, deterministic, and disabled.");
}

void main();
