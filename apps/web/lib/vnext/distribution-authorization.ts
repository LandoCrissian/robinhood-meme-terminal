import {
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";
import {
  RMT_DISTRIBUTION_CHAIN_ID,
  RMT_DISTRIBUTION_SCHEMA_VERSION,
  canonicalDistributionJson,
  parseDistributionManifestV1,
  type DistributionBatchV1,
  type DistributionManifestV1
} from "./distribution-domain";

export const RMT_DISTRIBUTION_ENGINE_V1_ABI = [{
  type: "function",
  name: "airdropERC20Equal",
  stateMutability: "nonpayable",
  inputs: [
    { name: "distributionId", type: "bytes32" },
    { name: "asset", type: "address" },
    { name: "recipients", type: "address[]" },
    { name: "amount", type: "uint256" }
  ],
  outputs: [
    { name: "executionKey", type: "bytes32" }, { name: "batchHash", type: "bytes32" },
    { name: "totalAssetAmount", type: "uint256" }, { name: "rmtRetired", type: "uint256" }
  ]
}, {
  type: "function",
  name: "airdropERC20",
  stateMutability: "nonpayable",
  inputs: [
    { name: "distributionId", type: "bytes32" },
    { name: "asset", type: "address" },
    { name: "recipients", type: "address[]" },
    { name: "amounts", type: "uint256[]" }
  ],
  outputs: [
    { name: "executionKey", type: "bytes32" }, { name: "batchHash", type: "bytes32" },
    { name: "totalAssetAmount", type: "uint256" }, { name: "rmtRetired", type: "uint256" }
  ]
}, {
  type: "function",
  name: "airdropERC721",
  stateMutability: "nonpayable",
  inputs: [
    { name: "distributionId", type: "bytes32" },
    { name: "asset", type: "address" },
    { name: "recipients", type: "address[]" },
    { name: "tokenIds", type: "uint256[]" }
  ],
  outputs: [
    { name: "executionKey", type: "bytes32" }, { name: "batchHash", type: "bytes32" },
    { name: "totalAssetAmount", type: "uint256" }, { name: "rmtRetired", type: "uint256" }
  ]
}, {
  type: "function",
  name: "airdropERC1155",
  stateMutability: "nonpayable",
  inputs: [
    { name: "distributionId", type: "bytes32" },
    { name: "asset", type: "address" },
    { name: "recipients", type: "address[]" },
    { name: "tokenIds", type: "uint256[]" },
    { name: "amounts", type: "uint256[]" }
  ],
  outputs: [
    { name: "executionKey", type: "bytes32" }, { name: "batchHash", type: "bytes32" },
    { name: "totalAssetAmount", type: "uint256" }, { name: "rmtRetired", type: "uint256" }
  ]
}, {
  type: "event",
  name: "DistributionExecuted",
  anonymous: false,
  inputs: [
    { name: "executionKey", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "asset", type: "address", indexed: true },
    { name: "distributionId", type: "bytes32", indexed: false },
    { name: "actionKind", type: "uint8", indexed: false },
    { name: "recipientCount", type: "uint256", indexed: false },
    { name: "totalAssetAmount", type: "uint256", indexed: false },
    { name: "rmtRetired", type: "uint256", indexed: false },
    { name: "retirementSink", type: "address", indexed: false },
    { name: "batchHash", type: "bytes32", indexed: false }
  ]
}] as const;

const erc721ApprovalAbi = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }],
  outputs: []
}] as const;

const operatorApprovalAbi = [{
  type: "function",
  name: "setApprovalForAll",
  stateMutability: "nonpayable",
  inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
  outputs: []
}] as const;

export type DistributionApprovalRequirementV1 =
  | {
      kind: "erc20_exact";
      token: Address;
      spender: Address;
      exactAmountAtomic: string;
      calldata: Hex;
      revokeRecommended: false;
    }
  | {
      kind: "erc721_exact";
      token: Address;
      spender: Address;
      tokenIds: string[];
      calldatas: Hex[];
      revokeRecommended: false;
    }
  | {
      kind: "erc1155_operator";
      token: Address;
      operator: Address;
      enableCalldata: Hex;
      revokeCalldata: Hex;
      revokeRecommended: true;
    };

export type DistributionAuthorizationPlanV1 = {
  schemaVersion: typeof RMT_DISTRIBUTION_SCHEMA_VERSION;
  planKind: "distribution_planning_only";
  planId: Hex;
  manifestHash: Hex;
  batchId: Hex;
  batchHash: Hex;
  batchIndex: number;
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  sender: Address;
  target: Address;
  calldata: Hex;
  calldataHash: Hex;
  payloadHash: Hex;
  transactionValueAtomic: "0";
  actionKind: DistributionManifestV1["actionKind"];
  asset: Address;
  recipientCount: number;
  totalAssetAmountAtomic: string;
  exactRmtRetirementAtomic: string;
  retirementSink: Address;
  expectedEngineRuntimeHash: Hex;
  expectedRetirementSinkRuntimeHash: Hex;
  expectedRmtToken: Address;
  expectedRmtRuntimeHash: Hex;
  approvals: DistributionApprovalRequirementV1[];
  requiresFreshRuntimeVerification: true;
  requiresFreshAllowanceVerification: true;
  requiresSimulation: true;
  userAuthorizationRequired: true;
  walletSubmissionEnabled: false;
  serverSubmissionEnabled: false;
};

const PLAN_ID_DOMAIN = keccak256(toBytes("RMT_DISTRIBUTION_AUTHORIZATION_PLAN_V1"));

const planSchema = z.object({
  schemaVersion: z.literal(1), planKind: z.literal("distribution_planning_only"), planId: z.string(), manifestHash: z.string(),
  batchId: z.string(), batchHash: z.string(), batchIndex: z.number().int().nonnegative(), chainId: z.literal(4_663),
  sender: z.string(), target: z.string(), calldata: z.string(), calldataHash: z.string(), payloadHash: z.string(),
  transactionValueAtomic: z.literal("0"), actionKind: z.enum(["erc20_equal", "erc20_custom", "erc721", "erc1155"]),
  asset: z.string(), recipientCount: z.number().int().positive(), totalAssetAmountAtomic: z.string(),
  exactRmtRetirementAtomic: z.string(), retirementSink: z.string(), expectedEngineRuntimeHash: z.string(),
  expectedRetirementSinkRuntimeHash: z.string(), expectedRmtToken: z.string(), expectedRmtRuntimeHash: z.string(),
  approvals: z.array(z.unknown()), requiresFreshRuntimeVerification: z.literal(true),
  requiresFreshAllowanceVerification: z.literal(true), requiresSimulation: z.literal(true),
  userAuthorizationRequired: z.literal(true), walletSubmissionEnabled: z.literal(false), serverSubmissionEnabled: z.literal(false)
}).strict();

function distributionCalldata(manifest: DistributionManifestV1, batch: DistributionBatchV1): Hex {
  const recipients = batch.entries.map((entry) => entry.recipient);
  if (manifest.actionKind === "erc20_equal") {
    return encodeFunctionData({
      abi: RMT_DISTRIBUTION_ENGINE_V1_ABI,
      functionName: "airdropERC20Equal",
      args: [batch.batchId, manifest.asset.address, recipients, BigInt(batch.entries[0].amountAtomic!)]
    });
  }
  if (manifest.actionKind === "erc20_custom") {
    return encodeFunctionData({
      abi: RMT_DISTRIBUTION_ENGINE_V1_ABI,
      functionName: "airdropERC20",
      args: [batch.batchId, manifest.asset.address, recipients, batch.entries.map((entry) => BigInt(entry.amountAtomic!))]
    });
  }
  if (manifest.actionKind === "erc721") {
    return encodeFunctionData({
      abi: RMT_DISTRIBUTION_ENGINE_V1_ABI,
      functionName: "airdropERC721",
      args: [batch.batchId, manifest.asset.address, recipients, batch.entries.map((entry) => BigInt(entry.tokenId!))]
    });
  }
  return encodeFunctionData({
    abi: RMT_DISTRIBUTION_ENGINE_V1_ABI,
    functionName: "airdropERC1155",
    args: [
      batch.batchId,
      manifest.asset.address,
      recipients,
      batch.entries.map((entry) => BigInt(entry.tokenId!)),
      batch.entries.map((entry) => BigInt(entry.amountAtomic!))
    ]
  });
}

function erc20Requirement(token: Address, spender: Address, amount: bigint): DistributionApprovalRequirementV1 {
  return {
    kind: "erc20_exact",
    token,
    spender,
    exactAmountAtomic: amount.toString(),
    calldata: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
    revokeRecommended: false
  };
}

function approvalRequirements(manifest: DistributionManifestV1, batch: DistributionBatchV1): DistributionApprovalRequirementV1[] {
  const engine = manifest.infrastructure.engine;
  const rmt = manifest.infrastructure.rmtToken;
  const utility = BigInt(batch.utilityCostAtomic);
  if (manifest.asset.standard === "erc20") {
    const distribution = BigInt(batch.totalAssetAmountAtomic);
    if (getAddress(manifest.asset.address) === getAddress(rmt)) {
      return [erc20Requirement(rmt, engine, distribution + utility)];
    }
    return [erc20Requirement(manifest.asset.address, engine, distribution), erc20Requirement(rmt, engine, utility)];
  }
  const utilityRequirement = erc20Requirement(rmt, engine, utility);
  if (manifest.asset.standard === "erc721") {
    const tokenIds = batch.entries.map((entry) => entry.tokenId!);
    return [{
      kind: "erc721_exact",
      token: manifest.asset.address,
      spender: engine,
      tokenIds,
      calldatas: tokenIds.map((tokenId) => encodeFunctionData({
        abi: erc721ApprovalAbi,
        functionName: "approve",
        args: [engine, BigInt(tokenId)]
      })),
      revokeRecommended: false
    }, utilityRequirement];
  }
  return [{
    kind: "erc1155_operator",
    token: manifest.asset.address,
    operator: engine,
    enableCalldata: encodeFunctionData({ abi: operatorApprovalAbi, functionName: "setApprovalForAll", args: [engine, true] }),
    revokeCalldata: encodeFunctionData({ abi: operatorApprovalAbi, functionName: "setApprovalForAll", args: [engine, false] }),
    revokeRecommended: true
  }, utilityRequirement];
}

export function distributionAuthorizationPayloadHash(input: { chainId: number; target: string; transactionValueAtomic: string; calldata: Hex }) {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes" }],
    [BigInt(input.chainId), getAddress(input.target), BigInt(input.transactionValueAtomic), input.calldata]
  ));
}

export function buildDistributionAuthorizationPlanV1(manifestValue: unknown, batchIndex: number): DistributionAuthorizationPlanV1 {
  const manifest = parseDistributionManifestV1(manifestValue);
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0 || batchIndex >= manifest.batches.length) {
    throw new Error("RMT rejected an unknown distribution batch.");
  }
  const batch = manifest.batches[batchIndex];
  const calldata = distributionCalldata(manifest, batch);
  const calldataHash = keccak256(calldata);
  const payloadHash = distributionAuthorizationPayloadHash({
    chainId: manifest.chainId,
    target: manifest.infrastructure.engine,
    transactionValueAtomic: "0",
    calldata
  });
  const planId = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [PLAN_ID_DOMAIN, manifest.manifestHash, batch.batchId, payloadHash]
  ));
  return {
    schemaVersion: RMT_DISTRIBUTION_SCHEMA_VERSION,
    planKind: "distribution_planning_only",
    planId,
    manifestHash: manifest.manifestHash,
    batchId: batch.batchId,
    batchHash: batch.batchHash,
    batchIndex,
    chainId: manifest.chainId,
    sender: manifest.sender,
    target: manifest.infrastructure.engine,
    calldata,
    calldataHash,
    payloadHash,
    transactionValueAtomic: "0",
    actionKind: manifest.actionKind,
    asset: manifest.asset.address,
    recipientCount: batch.recipientCount,
    totalAssetAmountAtomic: batch.totalAssetAmountAtomic,
    exactRmtRetirementAtomic: batch.utilityCostAtomic,
    retirementSink: manifest.infrastructure.retirementSink,
    expectedEngineRuntimeHash: manifest.infrastructure.engineRuntimeHash,
    expectedRetirementSinkRuntimeHash: manifest.infrastructure.retirementSinkRuntimeHash,
    expectedRmtToken: manifest.infrastructure.rmtToken,
    expectedRmtRuntimeHash: manifest.infrastructure.rmtTokenRuntimeHash,
    approvals: approvalRequirements(manifest, batch),
    requiresFreshRuntimeVerification: true,
    requiresFreshAllowanceVerification: true,
    requiresSimulation: true,
    userAuthorizationRequired: true,
    walletSubmissionEnabled: false,
    serverSubmissionEnabled: false
  };
}

export function parseDistributionAuthorizationPlanV1(value: unknown, manifestValue: unknown): DistributionAuthorizationPlanV1 {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) throw new Error("RMT rejected a malformed distribution authorization plan.");
  const candidate = parsed.data as DistributionAuthorizationPlanV1;
  const expected = buildDistributionAuthorizationPlanV1(manifestValue, candidate.batchIndex);
  if (canonicalDistributionJson(candidate) !== canonicalDistributionJson(expected)) {
    throw new Error("RMT rejected an inconsistent distribution authorization plan.");
  }
  return expected;
}
