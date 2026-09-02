import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress } from "viem";
import { createRmtExecutionFeeV2Policy } from "./execution-fee-policy-v2";
import {
  RMT_UNISWAP_V2_V2_CANDIDATE_GATE,
  RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID,
  configuredVNextUniswapV2FeeCandidate,
  quoteVNextUniswapV2FeeCandidate
} from "../server/vnext-uniswap-v2-fee-candidate";
import { VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY } from "./provider-fee-settlement";
import {
  assertRmtUniswapV2FeeCalldataV2,
  assertRmtUniswapV2FeeExecutionV2,
  createRmtUniswapV2FeeExecutionV2,
  encodeRmtUniswapV2FeeExecutionV2
} from "./uniswap-v2-fee-executor-v2";

async function main() {
  const treasury = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");
  const native = getAddress("0x0000000000000000000000000000000000000000");
  const token = getAddress("0x56910D4409F3a0C78C64DD8D0545FF0705389870");
  const pair = getAddress("0x1111111111111111111111111111111111111111");
  const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "51296658" });

  assert.equal(RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID, "rmt-uniswap-v2-fee-executor-v2");
  assert.equal(configuredVNextUniswapV2FeeCandidate({}), null, "candidate gate must default false");
  assert.throws(() => configuredVNextUniswapV2FeeCandidate({ [RMT_UNISWAP_V2_V2_CANDIDATE_GATE]: "TRUE" }), /exact lowercase/);
  assert.throws(() => configuredVNextUniswapV2FeeCandidate({
    [RMT_UNISWAP_V2_V2_CANDIDATE_GATE]: "true",
    VERCEL_ENV: "production"
  }), /not admitted in Production/);

  const manifest = JSON.parse(readFileSync(resolve(
    process.cwd(),
    "../../packages/contracts/deployments/rmt-uniswap-v2-fee-executor-v2.json"
  ), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.status, "DEPLOYED_APPLICATION_SOURCE_ADMITTED_CONTROLLED_PROOF_PENDING");
  assert.equal(manifest.deploymentAuthorized, true);
  assert.equal(manifest.activationAuthorized, false);
  assert.equal(manifest.publicExecutionAuthorized, false);
  const applicationAdmission = manifest.applicationAdmission as Record<string, unknown>;
  const dependencies = manifest.dependencies as Record<string, unknown>;
  assert.equal(applicationAdmission.sourceRegistryState, "V2_ATOMIC_INPUT_FEE");
  assert.equal(applicationAdmission.wethImplementationPreSignAuthority, "IMPLEMENTED_SERVER_ONLY_BLOCK_PINNED");
  assert.equal(applicationAdmission.walletAuthorization, "SOURCE_ADMITTED_RELEASE_GATED");
  assert.equal(applicationAdmission.publicExecution, false);
  assert.deepEqual(applicationAdmission.productionProviderScope, ["uniswap-v3"]);
  const deployment = manifest.deployment as Record<string, unknown>;
  assert.equal(deployment.executor, "0xB4bF1d99a3BF9201f8197682dcD2bF97725D6230");
  assert.equal(deployment.runtimeHash, "0x3a0518035f7a47c752eba630e02db8a72b14c175977fbfcbf6d708ea1a36c647");
  assert.equal(deployment.transactionHash, "0xaeb0e8f4c235fa76136d52ce1563eeb5648dc9448d8b9dc888cdb554bb7b5aea");
  assert.equal(deployment.deploymentBlock, "52166832");
  assert.equal(dependencies.wethImplementation, "0xC6B81b429797E0f555440b70cD99e032D7AE947e");
  assert.equal(dependencies.wethImplementationRuntimeHash, "0xbe1295f37be34ffe03ad779bda0ef278907e1856b51a3be2f35ee541d75d4650");

let quotedAmount = 0n;
const candidate = await quoteVNextUniswapV2FeeCandidate({
  inputAsset: native,
  outputAsset: token,
  userGrossInput: 40_000n,
  config: { policy },
  quoteProvider: async ({ amountIn }) => {
    quotedAmount = amountIn;
    return {
      expectedOutputAtomic: "39900",
      protectedOutputAtomic: "39501",
      route: "direct",
      pools: [pair],
      quoteBlock: "1",
      quoteBlockHash: `0x${"1".repeat(64)}`
    };
  }
});
assert(candidate);
assert.equal(quotedAmount, 39_900n, "Uniswap V2 must quote provider input, not gross input");
assert.equal(candidate.economics.userGrossInputAtomic, "40000");
assert.equal(candidate.economics.expectedFeeAtomic, "100");
assert.equal(candidate.economics.maximumFeeAtomic, "100");
assert.equal(candidate.economics.providerInputAtomic, "39900");
assert.equal(candidate.economics.feeAsset, "eip155:4663/native");
assert.equal(candidate.economics.feeBps, 25);
assert.equal(candidate.economics.feeSide, "input");
assert.equal(candidate.economics.treasury, treasury);
assert.equal(candidate.economics.policyId, "RMT_EXECUTION_V2");
assert.equal(candidate.economics.policyVersion, 2);
assert.equal(candidate.economics.settlementMode, "v2-atomic-input-fee");

const execution = createRmtUniswapV2FeeExecutionV2({
  executor: "0x2222222222222222222222222222222222222222",
  executorRuntimeHash: `0x${"3".repeat(64)}`,
  executionId: `0x${"4".repeat(64)}`,
  economics: candidate.economics,
  trader: "0x3333333333333333333333333333333333333333",
  inputAsset: native,
  outputAsset: token,
  deadline: "2000000000",
  route: { kind: 0, tokenIn: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"), tokenOut: token, pair0: pair, pair1: native }
});
const calldata = encodeRmtUniswapV2FeeExecutionV2(execution);
assert.equal(assertRmtUniswapV2FeeCalldataV2(calldata, execution, candidate.economics), true);
assert.throws(() => assertRmtUniswapV2FeeExecutionV2({ ...execution, providerInputAtomic: "39899" }, candidate.economics), /provider input changed/);
assert.throws(() => assertRmtUniswapV2FeeExecutionV2({ ...execution, route: { ...execution.route, pair0: getAddress("0x4444444444444444444444444444444444444444") } }, candidate.economics), /route identity changed/);

assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v2"].state, "V2_ATOMIC_INPUT_FEE");
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v2"].implementationId, "rmt-uniswap-v2-fee-executor-v2");

const tokenInput = await quoteVNextUniswapV2FeeCandidate({
  inputAsset: token,
  outputAsset: native,
  userGrossInput: 100_000n,
  config: { policy },
  quoteProvider: async ({ amountIn }) => ({
    expectedOutputAtomic: amountIn.toString(), protectedOutputAtomic: (amountIn - 1n).toString(),
    route: "direct", pools: [pair], quoteBlock: "1", quoteBlockHash: `0x${"2".repeat(64)}`
  })
});
assert(tokenInput);
assert.equal(tokenInput.economics.expectedFeeAtomic, "250");
assert.equal(tokenInput.economics.providerInputAtomic, "99750");
assert.equal(tokenInput.economics.feeAsset, `eip155:4663/contract:${token.toLowerCase()}`);

console.log("Uniswap V2 atomic input-fee source foundation smoke passed.");
}

void main();
