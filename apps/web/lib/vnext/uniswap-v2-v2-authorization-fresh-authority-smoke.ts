import assert from "node:assert/strict";
import { getAddress, zeroAddress, type Hex } from "viem";
import { createRmtExecutionFeeV2Policy } from "./execution-fee-policy-v2";
import { vNextAuthorizationRequestSchema } from "../server/vnext-authorization-request";
import {
  RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
  configuredVNextUniswapV2FeeExecutorV2
} from "../server/vnext-uniswap-v2-fee-executor-v2";
import {
  prepareVNextUniswapV2AuthorizationV2,
  type VNextUniswapV2V2AuthorityVerifier,
  type VNextUniswapV2V2ExecutionClient,
  type VerifiedVNextUniswapV2FeeExecutorV2Config
} from "../server/vnext-uniswap-v2-v2-execution";

const proofWallet = getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA");
const inputToken = getAddress("0x56910D4409F3a0C78C64DD8D0545FF0705389870");
const outputToken = getAddress("0x39dbed3a2bd333467115de45665cc57f813c4571");
const pair = getAddress("0x8018Ee3ad3c0321bE0e69536733CD28e29564dD4");
const treasury = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");
const verificationBlock = "52170000";
const verificationBlockHash = `0x${"8".repeat(64)}` as Hex;
const authorizationBlockHash = `0x${"9".repeat(64)}` as Hex;
const nowMs = 1_788_000_000_000;

const config: VerifiedVNextUniswapV2FeeExecutorV2Config = {
  executor: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  executorRuntimeHash: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
  policy: createRmtExecutionFeeV2Policy({ treasury, fromBlock: "51296658" }),
  verifiedAtBlock: verificationBlock,
  verifiedAtBlockHash: verificationBlockHash
};

function executionClient(allowance: bigint): VNextUniswapV2V2ExecutionClient {
  return {
    readContract: async ({ functionName }) => functionName === "allowance" ? allowance : 10_000_000n,
    getBalance: async () => 10_000_000_000_000_000n,
    getGasPrice: async () => 1n,
    call: async () => ({ data: "0x" }),
    estimateGas: async () => 100_000n
  };
}

const quoteProvider = async ({ amountIn }: { amountIn: bigint }) => ({
  expectedOutputAtomic: (amountIn * 2n).toString(),
  protectedOutputAtomic: (amountIn * 198n / 100n).toString(),
  route: "direct" as const,
  pools: [pair],
  quoteBlock: verificationBlock,
  quoteBlockHash: verificationBlockHash
});

function authoritySequence(input: {
  authorizationBlock: string;
  authorizationBlockHash?: Hex;
  historicalFailure?: Error;
  currentFailure?: Error;
}) {
  const calls: Array<{ blockNumber: bigint; blockHash: Hex } | undefined> = [];
  const verifier: VNextUniswapV2V2AuthorityVerifier = async (_config, expectedBlock) => {
    calls.push(expectedBlock);
    if (expectedBlock) {
      if (input.historicalFailure) throw input.historicalFailure;
      assert.equal(expectedBlock.blockNumber, BigInt(verificationBlock));
      assert.equal(expectedBlock.blockHash, verificationBlockHash);
      return { verifiedAtBlock: verificationBlock, verifiedAtBlockHash: verificationBlockHash };
    }
    if (input.currentFailure) throw input.currentFailure;
    return {
      verifiedAtBlock: input.authorizationBlock,
      verifiedAtBlockHash: input.authorizationBlockHash ?? authorizationBlockHash
    };
  };
  return { calls, verifier };
}

function request(input: { allowance: bigint; executionId: Hex; verifier: VNextUniswapV2V2AuthorityVerifier }) {
  return prepareVNextUniswapV2AuthorizationV2({
    inputAsset: inputToken,
    outputAsset: zeroAddress,
    amountIn: 1_000_000n,
    recipient: proofWallet,
    executionId: input.executionId,
    indicativeProtectedOutputFloorAtomic: 1_900_000n,
    deadlineSeconds: BigInt(Math.floor(nowMs / 1_000)) + 240n,
    nowMs,
    infrastructureVerifiedAtBlock: verificationBlock,
    infrastructureVerifiedAtBlockHash: verificationBlockHash,
    config,
    quoteProvider,
    executionClient: executionClient(input.allowance),
    authorityVerifier: input.verifier
  });
}

async function main() {
  const later = authoritySequence({ authorizationBlock: "52170001" });
  const approval = await request({ allowance: 0n, executionId: `0x${"1".repeat(64)}`, verifier: later.verifier });
  assert.equal(approval.transaction.kind, "erc20_approval");
  assert.equal(approval.evidence.infrastructureVerifiedAtBlock, verificationBlock);
  assert.equal(approval.evidence.infrastructureVerifiedAtBlockHash, verificationBlockHash);
  assert.equal(approval.evidence.authorizationInfrastructureVerifiedAtBlock, "52170001");
  assert.equal(approval.evidence.authorizationInfrastructureVerifiedAtBlockHash, authorizationBlockHash);
  assert.deepEqual(later.calls, [
    { blockNumber: BigInt(verificationBlock), blockHash: verificationBlockHash },
    undefined
  ]);

  const same = authoritySequence({ authorizationBlock: verificationBlock, authorizationBlockHash: verificationBlockHash });
  const sameBlockPlan = await request({ allowance: 0n, executionId: `0x${"2".repeat(64)}`, verifier: same.verifier });
  assert.equal(sameBlockPlan.evidence.authorizationInfrastructureVerifiedAtBlock, verificationBlock);

  const earlier = authoritySequence({ authorizationBlock: "52169999" });
  await assert.rejects(
    request({ allowance: 0n, executionId: `0x${"3".repeat(64)}`, verifier: earlier.verifier }),
    /predates verification/
  );

  const reorg = authoritySequence({
    authorizationBlock: "52170001",
    historicalFailure: new Error("The committed verification block hash changed.")
  });
  await assert.rejects(
    request({ allowance: 0n, executionId: `0x${"4".repeat(64)}`, verifier: reorg.verifier }),
    /block hash changed/
  );
  assert.equal(reorg.calls.length, 1);

  const currentDrifts = [
    "WETH implementation changed",
    "WETH implementation runtime changed",
    "WETH proxy runtime changed",
    "Router runtime changed",
    "factory runtime changed",
    "Router.WETH changed",
    "Router.factory changed",
    "executor runtime changed",
    "executor immutable identity changed",
    "policy became ineffective"
  ];
  for (const [index, message] of currentDrifts.entries()) {
    const drift = authoritySequence({ authorizationBlock: "52170001", currentFailure: new Error(message) });
    await assert.rejects(
      request({
        allowance: 0n,
        executionId: `0x${(index + 5).toString(16).repeat(64)}` as Hex,
        verifier: drift.verifier
      }),
      new RegExp(message.replace(".", "\\."))
    );
    assert.equal(drift.calls.length, 2);
  }

  const postApproval = authoritySequence({ authorizationBlock: "52170002" });
  const swap = await request({ allowance: 1_000_000n, executionId: `0x${"d".repeat(64)}`, verifier: postApproval.verifier });
  assert.equal(swap.transaction.kind, "swap");
  assert.equal(swap.transaction.target, RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR);
  assert.deepEqual(postApproval.calls, [
    { blockNumber: BigInt(verificationBlock), blockHash: verificationBlockHash },
    undefined
  ]);

  const browserAttempt = vNextAuthorizationRequestSchema.safeParse({
    chainId: 4_663,
    quoteRequestId: "11111111-1111-4111-8111-111111111111",
    verificationId: "22222222-2222-4222-8222-222222222222",
    provider: "uniswap-v2",
    inputAsset: inputToken,
    outputAsset: outputToken,
    inputAmountAtomic: "1000000",
    recipient: proofWallet,
    expectedStatus: "approval_required",
    indicativeProtectedOutputFloorAtomic: "1900000",
    expectedProtectedOutputAtomic: "1900000",
    settlementMode: "VNEXT_V2_ATOMIC_INPUT_FEE",
    executionId: `0x${"e".repeat(64)}`,
    v2VerificationCommitment: "v1.abc.def",
    authorizationInfrastructureVerifiedAtBlock: "99999999",
    authorizationInfrastructureVerifiedAtBlockHash: `0x${"f".repeat(64)}`
  });
  assert.equal(browserAttempt.success, false);

  assert.equal(configuredVNextUniswapV2FeeExecutorV2({
    NEXT_PUBLIC_RMT_VNEXT_UNISWAP_V2_V2_AUTHORIZATION_BLOCK: "99999999"
  } as unknown as NodeJS.ProcessEnv), null);

  console.log("Uniswap V2 V2 authorization rechecks canonical block A and fresh live block B before approval and swap.");
}

void main();
