import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, zeroAddress, type Hex } from "viem";
import { createRmtExecutionFeeV2Policy } from "./execution-fee-policy-v2";
import { vNextAuthorizationRequestSchema } from "../server/vnext-authorization-request";
import {
  RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
  assertCommittedVNextUniswapV2VerificationBlockCanonical,
  configuredVNextUniswapV2FeeExecutorV2
} from "../server/vnext-uniswap-v2-fee-executor-v2";
import {
  prepareVNextUniswapV2AuthorizationV2,
  type VNextUniswapV2V2AuthorityVerifier,
  type VNextUniswapV2V2CanonicalityVerifier,
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
  const canonicalityCalls: Array<{ blockNumber: bigint; blockHash: Hex }> = [];
  const authorityCalls: Array<typeof config> = [];
  const canonicalityVerifier: VNextUniswapV2V2CanonicalityVerifier = async (expectedBlock) => {
    canonicalityCalls.push(expectedBlock);
    if (input.historicalFailure) throw input.historicalFailure;
    assert.equal(expectedBlock.blockNumber, BigInt(verificationBlock));
    assert.equal(expectedBlock.blockHash, verificationBlockHash);
    return { verifiedAtBlock: verificationBlock, verifiedAtBlockHash: verificationBlockHash };
  };
  const authorityVerifier: VNextUniswapV2V2AuthorityVerifier = async (receivedConfig) => {
    authorityCalls.push(receivedConfig as typeof config);
    if (input.currentFailure) throw input.currentFailure;
    return {
      verifiedAtBlock: input.authorizationBlock,
      verifiedAtBlockHash: input.authorizationBlockHash ?? authorizationBlockHash
    };
  };
  return { authorityCalls, authorityVerifier, canonicalityCalls, canonicalityVerifier };
}

function request(input: {
  allowance: bigint;
  executionId: Hex;
  authorityVerifier: VNextUniswapV2V2AuthorityVerifier;
  canonicalityVerifier: VNextUniswapV2V2CanonicalityVerifier;
}) {
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
    authorityVerifier: input.authorityVerifier,
    canonicalityVerifier: input.canonicalityVerifier
  });
}

async function main() {
  assert.deepEqual(await assertCommittedVNextUniswapV2VerificationBlockCanonical({
    blockNumber: BigInt(verificationBlock),
    blockHash: verificationBlockHash
  }, {
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: verificationBlockHash })
  }), {
    verifiedAtBlock: verificationBlock,
    verifiedAtBlockHash: verificationBlockHash
  });
  await assert.rejects(
    assertCommittedVNextUniswapV2VerificationBlockCanonical({
      blockNumber: BigInt(verificationBlock),
      blockHash: verificationBlockHash
    }, {
      getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: `0x${"7".repeat(64)}` as Hex })
    }),
    /verification block changed/
  );

  const later = authoritySequence({ authorizationBlock: "52170001" });
  const approval = await request({ allowance: 0n, executionId: `0x${"1".repeat(64)}`, ...later });
  assert.equal(approval.transaction.kind, "erc20_approval");
  assert.equal(approval.evidence.infrastructureVerifiedAtBlock, verificationBlock);
  assert.equal(approval.evidence.infrastructureVerifiedAtBlockHash, verificationBlockHash);
  assert.equal(approval.evidence.authorizationInfrastructureVerifiedAtBlock, "52170001");
  assert.equal(approval.evidence.authorizationInfrastructureVerifiedAtBlockHash, authorizationBlockHash);
  assert.deepEqual(later.canonicalityCalls, [
    { blockNumber: BigInt(verificationBlock), blockHash: verificationBlockHash }
  ]);
  assert.equal(later.authorityCalls.length, 1);
  assert.equal(later.authorityCalls[0], config);

  const same = authoritySequence({ authorizationBlock: verificationBlock, authorizationBlockHash: verificationBlockHash });
  const sameBlockPlan = await request({ allowance: 0n, executionId: `0x${"2".repeat(64)}`, ...same });
  assert.equal(sameBlockPlan.evidence.authorizationInfrastructureVerifiedAtBlock, verificationBlock);

  const earlier = authoritySequence({ authorizationBlock: "52169999" });
  await assert.rejects(
    request({ allowance: 0n, executionId: `0x${"3".repeat(64)}`, ...earlier }),
    /predates verification/
  );

  const reorg = authoritySequence({
    authorizationBlock: "52170001",
    historicalFailure: new Error("The committed verification block hash changed.")
  });
  await assert.rejects(
    request({ allowance: 0n, executionId: `0x${"4".repeat(64)}`, ...reorg }),
    /block hash changed/
  );
  assert.equal(reorg.canonicalityCalls.length, 1);
  assert.equal(reorg.authorityCalls.length, 0);

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
        ...drift
      }),
      new RegExp(message.replace(".", "\\."))
    );
    assert.equal(drift.canonicalityCalls.length, 1);
    assert.equal(drift.authorityCalls.length, 1);
  }

  const postApproval = authoritySequence({ authorizationBlock: "52170002" });
  const swap = await request({ allowance: 1_000_000n, executionId: `0x${"d".repeat(64)}`, ...postApproval });
  assert.equal(swap.transaction.kind, "swap");
  assert.equal(swap.transaction.target, RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR);
  assert.equal(postApproval.canonicalityCalls.length, 1);
  assert.equal(postApproval.authorityCalls.length, 1);

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

  const executionSource = readFileSync(new URL("../server/vnext-uniswap-v2-v2-execution.ts", import.meta.url), "utf8");
  const historicalBoundary = executionSource.slice(
    executionSource.indexOf("const verificationAuthority = await canonicalityVerifier"),
    executionSource.indexOf("const authorizationAuthority = await authorityVerifier")
  );
  assert.match(historicalBoundary, /canonicalityVerifier/);
  assert.doesNotMatch(historicalBoundary, /verifyConfiguredVNextUniswapV2FeeExecutorV2|authorityVerifier\(config/,
    "historical block A is checked only for canonicality, not fully reproved");
  assert.match(executionSource, /const authorizationAuthority = await authorityVerifier\(config\)/,
    "fresh block B still performs complete current executor and infrastructure authority");

  console.log("Uniswap V2 V2 authorization rechecks canonical block A and fresh live block B before approval and swap.");
}

void main();
