import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, keccak256, zeroAddress, type Hex } from "viem";
import { createRmtExecutionFeeV2Policy, normalizeRmtExecutionFeeV2Input } from "./execution-fee-policy-v2";
import { VNEXT_DIRECT_NO_RMT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE } from "./execution-settlement";
import { VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY, bindVNextAtomicFeeAuthorization, type VNextAtomicFeeSettlementProof } from "./provider-fee-settlement";
import { RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID } from "./uniswap-v2-fee-executor-v2";
import { ROBINHOOD_UNISWAP_V2_ROUTER } from "./uniswap-v2-authorization-codec";
import {
  RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
  configuredVNextUniswapV2FeeExecutorV2,
  configuredVNextUniswapV2V2ReleaseScope,
  isVNextUniswapV2V2ReleaseRecipientEligible,
  requireVNextUniswapV2V2ReleaseRecipient
} from "../server/vnext-uniswap-v2-fee-executor-v2";
import {
  quoteVNextUniswapV2ForUserV2,
  prepareVNextUniswapV2AuthorizationV2,
  selectVNextUniswapV2SettlementMode,
  type VNextUniswapV2V2ExecutionClient,
  type VerifiedVNextUniswapV2FeeExecutorV2Config
} from "../server/vnext-uniswap-v2-v2-execution";
import {
  requireVNextPublicExecutionProvider,
  requireVNextPublicExecutionSettlement
} from "../server/vnext-public-execution-provider-scope";
import {
  assertVNextV2VerificationContinuity,
  createVNextV2VerificationCommitment,
  verifyVNextV2VerificationCommitment
} from "../server/vnext-v2-verification-commitment";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";

const proofWallet = getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA");
const otherWallet = getAddress("0x1111111111111111111111111111111111111111");
const inputToken = getAddress("0x56910D4409F3a0C78C64DD8D0545FF0705389870");
const outputToken = getAddress("0x39dbed3a2bd333467115de45665cc57f813c4571");
const pair = getAddress("0x8018Ee3ad3c0321bE0e69536733CD28e29564dD4");
const treasury = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");
const infrastructureBlockHash = `0x${"8".repeat(64)}` as Hex;
const secret = "x".repeat(32);
const nowMs = 1_788_000_000_000;

async function main() {
const authorityEnv = {
  RMT_VNEXT_EXECUTION_V2_POLICY_ENABLED: "true",
  RMT_VNEXT_EXECUTION_V2_TREASURY: treasury,
  RMT_VNEXT_EXECUTION_V2_EFFECTIVE_BLOCK: "51296658",
  RMT_VNEXT_EXECUTION_V2_POLICY_HASH: "0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484",
  RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_ADDRESS: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_RUNTIME_HASH: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
  RMT_VNEXT_UNISWAP_V2_V2_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V2_V2_PUBLIC_AUTHORIZATION_ENABLED: "false",
  RMT_VNEXT_UNISWAP_V2_V2_PROOF_WALLET: proofWallet
} as unknown as NodeJS.ProcessEnv;

assert.equal(configuredVNextUniswapV2FeeExecutorV2({} as NodeJS.ProcessEnv), null);
assert.throws(() => configuredVNextUniswapV2FeeExecutorV2({
  ...authorityEnv,
  RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_ADDRESS: otherWallet
} as NodeJS.ProcessEnv), /admitted deployment/);
assert.throws(() => configuredVNextUniswapV2FeeExecutorV2({
  ...authorityEnv,
  RMT_VNEXT_UNISWAP_V2_V2_EXECUTOR_RUNTIME_HASH: `0x${"9".repeat(64)}`
} as NodeJS.ProcessEnv), /admitted deployment/);
const configured = configuredVNextUniswapV2FeeExecutorV2(authorityEnv);
assert(configured);
assert.equal(configuredVNextUniswapV2V2ReleaseScope({} as NodeJS.ProcessEnv), "DISABLED");
assert.equal(configuredVNextUniswapV2V2ReleaseScope(authorityEnv), "PROOF_WALLET_ONLY");
assert.equal(isVNextUniswapV2V2ReleaseRecipientEligible(proofWallet, authorityEnv), true);
assert.equal(isVNextUniswapV2V2ReleaseRecipientEligible(otherWallet, authorityEnv), false);
assert.throws(() => requireVNextUniswapV2V2ReleaseRecipient(otherWallet, authorityEnv), /release scope/);
assert.equal(configuredVNextUniswapV2V2ReleaseScope({
  ...authorityEnv,
  RMT_VNEXT_UNISWAP_V2_V2_PUBLIC_AUTHORIZATION_ENABLED: "true"
} as NodeJS.ProcessEnv), "PUBLIC");

assert.equal(selectVNextUniswapV2SettlementMode({ recipient: otherWallet, env: {} as NodeJS.ProcessEnv }), VNEXT_DIRECT_NO_RMT_FEE);
assert.equal(selectVNextUniswapV2SettlementMode({ recipient: proofWallet, env: authorityEnv }), VNEXT_V2_ATOMIC_INPUT_FEE);
assert.equal(selectVNextUniswapV2SettlementMode({ recipient: otherWallet, env: authorityEnv }), VNEXT_DIRECT_NO_RMT_FEE);
assert.throws(() => requireVNextPublicExecutionProvider("uniswap-v2", { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "uniswap-v3" }), /not admitted/);
assert.doesNotThrow(() => requireVNextPublicExecutionProvider("uniswap-v2", { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "uniswap-v2,uniswap-v3" }));
assert.doesNotThrow(() => requireVNextPublicExecutionSettlement("uniswap-v2", VNEXT_V2_ATOMIC_INPUT_FEE, { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "uniswap-v2,uniswap-v3" }));
assert.throws(() => requireVNextPublicExecutionSettlement("uniswap-v2", VNEXT_DIRECT_NO_RMT_FEE, { RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "uniswap-v2,uniswap-v3" }), /settlement authority/);

const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "51296658" });
const verifiedConfig: VerifiedVNextUniswapV2FeeExecutorV2Config = {
  executor: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  executorRuntimeHash: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
  policy,
  verifiedAtBlock: "52170000",
  verifiedAtBlockHash: infrastructureBlockHash
};
let quotedInput = 0n;
const quote = await quoteVNextUniswapV2ForUserV2({
  inputAsset: inputToken,
  outputAsset: outputToken,
  userGrossInput: 1_000_000n,
  config: verifiedConfig,
  quoteProvider: async ({ amountIn }) => {
    quotedInput = amountIn;
    return {
      expectedOutputAtomic: "2000000", protectedOutputAtomic: "1980000", route: "direct",
      pools: [pair], quoteBlock: "52170000", quoteBlockHash: infrastructureBlockHash
    };
  }
});
assert(quote);
assert.equal(quotedInput, 997_500n);
assert.equal(quote.economics.expectedFeeAtomic, "2500");
assert.equal(quote.economics.providerInputAtomic, "997500");
assert.equal(quote.economics.feeAsset, `eip155:4663/contract:${inputToken.toLowerCase()}`);

function executionClient(allowance: bigint): VNextUniswapV2V2ExecutionClient {
  return {
    readContract: async ({ functionName }) => functionName === "allowance" ? allowance : 10_000_000n,
    getBalance: async () => 10_000_000_000_000_000n,
    getGasPrice: async () => 1n,
    call: async () => ({ data: "0x" }),
    estimateGas: async () => 100_000n
  };
}
const directQuoteProvider = async ({ amountIn }: { amountIn: bigint }) => ({
  expectedOutputAtomic: (amountIn * 2n).toString(),
  protectedOutputAtomic: (amountIn * 198n / 100n).toString(),
  route: "direct" as const,
  pools: [pair],
  quoteBlock: verifiedConfig.verifiedAtBlock,
  quoteBlockHash: verifiedConfig.verifiedAtBlockHash
});
const nativePlan = await prepareVNextUniswapV2AuthorizationV2({
  inputAsset: zeroAddress,
  outputAsset: outputToken,
  amountIn: 1_000_000n,
  recipient: proofWallet,
  executionId: `0x${"4".repeat(64)}`,
  indicativeProtectedOutputFloorAtomic: 1_900_000n,
  deadlineSeconds: BigInt(Math.floor(nowMs / 1_000)) + 240n,
  nowMs,
  config: verifiedConfig,
  quoteProvider: directQuoteProvider,
  executionClient: executionClient(0n)
});
assert.equal(nativePlan.transaction.kind, "swap");
assert.equal(nativePlan.transaction.target, RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR);
assert.equal(nativePlan.transaction.value, "1000000");
assert.equal(nativePlan.evidence.feeV2Economics.expectedFeeAtomic, "2500");
assert.equal(nativePlan.evidence.feeV2Economics.providerInputAtomic, "997500");

const approvalPlan = await prepareVNextUniswapV2AuthorizationV2({
  inputAsset: inputToken,
  outputAsset: zeroAddress,
  amountIn: 1_000_000n,
  recipient: proofWallet,
  executionId: `0x${"5".repeat(64)}`,
  indicativeProtectedOutputFloorAtomic: 1_900_000n,
  deadlineSeconds: BigInt(Math.floor(nowMs / 1_000)) + 240n,
  nowMs,
  config: verifiedConfig,
  quoteProvider: directQuoteProvider,
  executionClient: executionClient(0n)
});
assert.equal(approvalPlan.transaction.kind, "erc20_approval");
assert.equal(approvalPlan.transaction.target, inputToken);
const decodedApproval = decodeFunctionData({ abi: erc20Abi, data: approvalPlan.transaction.data });
assert.equal(decodedApproval.functionName, "approve");
assert.deepEqual(decodedApproval.args, [RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR, 1_000_000n]);
assert.equal(approvalPlan.evidence.approvalSpender, RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR);
assert.notEqual(approvalPlan.evidence.approvalSpender, ROBINHOOD_UNISWAP_V2_ROUTER);

const postApprovalPlan = await prepareVNextUniswapV2AuthorizationV2({
  inputAsset: inputToken,
  outputAsset: zeroAddress,
  amountIn: 1_000_000n,
  recipient: proofWallet,
  executionId: `0x${"7".repeat(64)}`,
  indicativeProtectedOutputFloorAtomic: 1_900_000n,
  deadlineSeconds: BigInt(Math.floor(nowMs / 1_000)) + 240n,
  nowMs,
  config: verifiedConfig,
  quoteProvider: directQuoteProvider,
  executionClient: executionClient(1_000_000n)
});
assert.equal(postApprovalPlan.transaction.kind, "swap");
assert.equal(postApprovalPlan.transaction.target, RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR);
assert.equal(postApprovalPlan.transaction.value, "0");

const economics = normalizeRmtExecutionFeeV2Input({
  policy,
  inputAssetId: `eip155:4663/contract:${inputToken.toLowerCase()}`,
  outputAssetId: `eip155:4663/contract:${outputToken.toLowerCase()}`,
  userGrossInputAtomic: "1000000",
  providerGrossExpectedOutputAtomic: "2000000",
  providerProtectedOutputAtomic: "1980000",
  settlementMode: "v2-atomic-input-fee"
});
const calldata = "0x12345678" as Hex;
const proof: VNextAtomicFeeSettlementProof = {
  verificationState: "verified_atomic", provider: "uniswap-v2", settlementMode: "v2-atomic-input-fee",
  implementationId: RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID,
  executionTarget: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  providerTarget: ROBINHOOD_UNISWAP_V2_ROUTER,
  calldataHash: keccak256(calldata), executionId: `0x${"6".repeat(64)}`,
  recipient: proofWallet, deadline: "1788000300", atomicFeeSettlement: true, revertsAtomically: true
};
const approvalData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR, 1_000_000n] });
const evidence: VNextPreSignEvidence = {
  verificationId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  provider: "uniswap-v2", status: "approval_required", chainId: 4_663,
  inputAsset: inputToken, outputAsset: outputToken, inputAmountAtomic: "1000000",
  indicativeProtectedOutputFloorAtomic: "1970000", expectedOutputAtomic: "2000000", protectedOutputAtomic: "1980000",
  recipient: proofWallet, router: ROBINHOOD_UNISWAP_V2_ROUTER,
  approvalSpender: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR, approvalRequired: true,
  sufficientBalance: true, allowanceAtomic: "0", balanceAtomic: "1000000",
  route: "direct", fees: [30], pools: [pair], quoteBlock: "52170000", quoteBlockHash: infrastructureBlockHash,
  deadline: proof.deadline, calldataHash: proof.calldataHash, nextAction: "approval", nextActionTarget: inputToken,
  nextActionCalldataHash: keccak256(approvalData), transactionValueAtomic: "0", nativeBalanceWei: "1000000000000000",
  gasPriceWei: "1", feeCeilingWei: "3", estimatedGasUnits: "50000", gasLimitUnits: "60000",
  estimatedNetworkCostWei: "180000", estimatedNetworkCostUsdgAtomic: null, networkCostValuationSource: null,
  networkCostValuedAtMs: null, networkCostValuationExpiresAtMs: null, gasState: "sufficient",
  routerRuntimeHash: `0x${"2".repeat(64)}`, factoryRuntimeHash: `0x${"3".repeat(64)}`,
  quoterRuntimeHash: `0x${"2".repeat(64)}`, exactSimulationPassed: false, userPaysGas: true,
  rmtFeeEnabled: false, settlementMode: VNEXT_V2_ATOMIC_INPUT_FEE, feeExecution: null,
  feeV2Economics: economics, feeV2Settlement: proof,
  infrastructureVerifiedAtBlock: verifiedConfig.verifiedAtBlock,
  infrastructureVerifiedAtBlockHash: verifiedConfig.verifiedAtBlockHash,
  verifiedAtMs: nowMs, expiresAtMs: nowMs + 300_000, authorizationReady: false
};
const commitment = createVNextV2VerificationCommitment({
  evidence, identityId: "did:privy:uniswap-v2-proof", quoteRequestId: evidence.sourceQuoteRequestId,
  verificationId: evidence.verificationId, executorRuntimeHash: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH,
  nowMs, secret
});
const committedEvidence = { ...evidence, v2VerificationCommitment: commitment };
const claims = verifyVNextV2VerificationCommitment({
  token: commitment, identityId: "did:privy:uniswap-v2-proof", wallet: proofWallet,
  quoteRequestId: evidence.sourceQuoteRequestId, verificationId: evidence.verificationId, nowMs: nowMs + 1, secret
});
assert.equal(claims.provider, "uniswap-v2");
assert.equal(claims.infrastructureVerifiedAtBlock, verifiedConfig.verifiedAtBlock);
assert.equal(claims.infrastructureVerifiedAtBlockHash, verifiedConfig.verifiedAtBlockHash);
assert.equal(assertVNextV2VerificationContinuity({ claims, evidence: committedEvidence, executorRuntimeHash: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH }), true);
assert.doesNotThrow(() => parseVNextPreSignEvidence(committedEvidence, {
  quoteRequestId: evidence.sourceQuoteRequestId, inputAsset: inputToken, outputAsset: outputToken,
  inputAmountAtomic: "1000000", provider: "uniswap-v2", protectedOutputFloorAtomic: "1970000", recipient: proofWallet
}, nowMs + 1));
assert.throws(() => assertVNextV2VerificationContinuity({
  claims, evidence: { ...committedEvidence, infrastructureVerifiedAtBlock: "52170001" },
  executorRuntimeHash: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH
}), /changed/);
assert.throws(() => assertVNextV2VerificationContinuity({
  claims, evidence: { ...committedEvidence, infrastructureVerifiedAtBlockHash: `0x${"7".repeat(64)}` },
  executorRuntimeHash: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH
}), /changed/);
assert.throws(() => assertVNextV2VerificationContinuity({
  claims, evidence: { ...committedEvidence, pools: [otherWallet] },
  executorRuntimeHash: RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH
}), /changed/);

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "../../packages/contracts/deployments/rmt-uniswap-v2-fee-executor-v2.json"), "utf8"));
assert.equal(manifest.deployment.executor, RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR);
assert.equal(manifest.deployment.runtimeHash, RMT_UNISWAP_V2_V2_DEPLOYED_RUNTIME_HASH);
assert.equal(manifest.deployment.transactionHash, "0xaeb0e8f4c235fa76136d52ce1563eeb5648dc9448d8b9dc888cdb554bb7b5aea");
assert.equal(manifest.deployment.deploymentBlockHash, "0xed440ea7aad687278f2b8ac9ddb716960aa6b106b03ead0e4877176258304665");
assert.equal(manifest.applicationAdmission.publicExecution, false);
assert.deepEqual(manifest.applicationAdmission.productionProviderScope, ["uniswap-v3"]);
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v2"].state, "V2_ATOMIC_INPUT_FEE");
assert.equal(VNEXT_PROVIDER_FEE_SETTLEMENT_REGISTRY["uniswap-v2"].implementationId, RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID);

const verifyRoute = readFileSync(resolve(process.cwd(), "app/api/vnext/verify/route.ts"), "utf8");
const authorizeRoute = readFileSync(resolve(process.cwd(), "app/api/vnext/authorize/route.ts"), "utf8");
const quoteRoute = readFileSync(resolve(process.cwd(), "app/api/vnext/quotes/route.ts"), "utf8");
assert.match(verifyRoute, /selectVNextUniswapV2SettlementMode/);
assert.match(verifyRoute, /configuredVNextUniswapV2FeeExecutorV2/);
assert.match(authorizeRoute, /selectVNextUniswapV2SettlementMode/);
assert.match(authorizeRoute, /assertVNextV2VerificationContinuity/);
assert.match(verifyRoute, /requireVNextPublicExecutionSettlement\(parsed\.data\.provider, settlementMode\)/);
assert.match(authorizeRoute, /requireVNextPublicExecutionSettlement\(parsed\.data\.provider, settlementMode\)/);
assert.match(quoteRoute, /attempt\.provider !== "uniswap-v2" && attempt\.provider !== "uniswap-v3"/);

const solidity = readFileSync(resolve(process.cwd(), "../../packages/contracts/src/RMTUniswapV2FeeExecutorV2.sol"), "utf8")
  .replace(/\r\n/g, "\n");
assert.equal(keccak256(new TextEncoder().encode(solidity)), "0xfdba6e3ddec210a21f42bf907c861ab02a77c2f3d3d5aa0284dedf5bf3356ed9");

assert.equal(bindVNextAtomicFeeAuthorization({ economics, proof }).provider, "uniswap-v2");
console.log("Uniswap V2 V2 deployed application admission, controlled release, exact approval, and HMAC continuity smoke passed.");
}

void main();
