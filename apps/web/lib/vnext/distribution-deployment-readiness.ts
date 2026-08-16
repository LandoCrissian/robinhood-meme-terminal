import { isHash, keccak256, toBytes, type Hex } from "viem";
import { z } from "zod";
import { canonicalDistributionJson, RMT_DISTRIBUTION_CHAIN_ID } from "./distribution-domain";

export const OFFICIAL_RMT_DISTRIBUTION_TOKEN = "0xdBa33be56C89CC9fc014c4459028d7e5c7878671" as const;
export const OFFICIAL_RMT_DISTRIBUTION_RUNTIME_HASH =
  "0x49cd48d0204b35d27e6fca131febe8ce5aff6cd0c2fb6c5c21d5f0ad616e99e9" as const;

const DEPLOYMENT_BLOCKERS = [
  "utility_rates_unapproved",
  "deployment_operator_unapproved",
  "deployment_not_authorized",
  "production_manifest_absent",
  "ccff00_canary_transfer_unproven",
  "ccff00_account_activation_unproven",
  "ccff00_owner_withdrawal_unproven",
  "public_ui_not_authorized"
] as const;

export type DistributionDeploymentReadinessPacketV1 = {
  schemaVersion: 1;
  status: "predeployment_unapproved";
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  sourceCommit: string;
  compiler: { version: "0.8.26"; optimizer: true; optimizerRuns: 200; viaIr: true };
  artifacts: {
    engineCreationCodeHash: Hex;
    retirementSinkCreationCodeHash: Hex;
    retirementSinkRuntimeHash: Hex;
  };
  dependency: {
    rmtToken: typeof OFFICIAL_RMT_DISTRIBUTION_TOKEN;
    rmtRuntimeHash: typeof OFFICIAL_RMT_DISTRIBUTION_RUNTIME_HASH;
  };
  utilityPolicy: {
    status: "unapproved";
    policyVersion: null;
    erc20CostPerRecipientAtomic: null;
    erc721CostPerRecipientAtomic: null;
    erc1155CostPerRecipientAtomic: null;
  };
  operator: { status: "unapproved"; deployer: null };
  deployment: {
    authorized: false;
    method: null;
    engine: null;
    retirementSink: null;
    transactionHash: null;
  };
  activation: {
    publicUiAuthorized: false;
    walletSubmissionEnabled: false;
    serverSubmissionEnabled: false;
  };
  canaryProof: {
    oneRmtEachVerified: false;
    activatedCanaryCount: 0;
    ownerWithdrawalProofVerified: false;
  };
  safeForForkRehearsal: true;
  safeForLiveDeployment: false;
  blockers: typeof DEPLOYMENT_BLOCKERS;
  packetHash: Hex;
};

type ReadinessInput = {
  sourceCommit: string;
  engineCreationCode: Hex;
  retirementSinkCreationCode: Hex;
  retirementSinkRuntimeCode: Hex;
};

const nonemptyBytecode = z.string().regex(/^0x[0-9a-fA-F]+$/).refine((value) => value.length > 2 && value.length % 2 === 0);
const hash = z.string().refine((value) => isHash(value) && !/^0x0{64}$/i.test(value));

const readinessSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("predeployment_unapproved"),
  chainId: z.literal(4_663),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  compiler: z.object({
    version: z.literal("0.8.26"), optimizer: z.literal(true), optimizerRuns: z.literal(200), viaIr: z.literal(true)
  }).strict(),
  artifacts: z.object({
    engineCreationCodeHash: hash,
    retirementSinkCreationCodeHash: hash,
    retirementSinkRuntimeHash: hash
  }).strict(),
  dependency: z.object({
    rmtToken: z.literal(OFFICIAL_RMT_DISTRIBUTION_TOKEN),
    rmtRuntimeHash: z.literal(OFFICIAL_RMT_DISTRIBUTION_RUNTIME_HASH)
  }).strict(),
  utilityPolicy: z.object({
    status: z.literal("unapproved"),
    policyVersion: z.null(),
    erc20CostPerRecipientAtomic: z.null(),
    erc721CostPerRecipientAtomic: z.null(),
    erc1155CostPerRecipientAtomic: z.null()
  }).strict(),
  operator: z.object({ status: z.literal("unapproved"), deployer: z.null() }).strict(),
  deployment: z.object({
    authorized: z.literal(false),
    method: z.null(),
    engine: z.null(),
    retirementSink: z.null(),
    transactionHash: z.null()
  }).strict(),
  activation: z.object({
    publicUiAuthorized: z.literal(false),
    walletSubmissionEnabled: z.literal(false),
    serverSubmissionEnabled: z.literal(false)
  }).strict(),
  canaryProof: z.object({
    oneRmtEachVerified: z.literal(false),
    activatedCanaryCount: z.literal(0),
    ownerWithdrawalProofVerified: z.literal(false)
  }).strict(),
  safeForForkRehearsal: z.literal(true),
  safeForLiveDeployment: z.literal(false),
  blockers: z.tuple(DEPLOYMENT_BLOCKERS.map((blocker) => z.literal(blocker)) as [
    z.ZodLiteral<(typeof DEPLOYMENT_BLOCKERS)[0]>,
    z.ZodLiteral<(typeof DEPLOYMENT_BLOCKERS)[1]>,
    z.ZodLiteral<(typeof DEPLOYMENT_BLOCKERS)[2]>,
    z.ZodLiteral<(typeof DEPLOYMENT_BLOCKERS)[3]>,
    z.ZodLiteral<(typeof DEPLOYMENT_BLOCKERS)[4]>,
    z.ZodLiteral<(typeof DEPLOYMENT_BLOCKERS)[5]>,
    z.ZodLiteral<(typeof DEPLOYMENT_BLOCKERS)[6]>,
    z.ZodLiteral<(typeof DEPLOYMENT_BLOCKERS)[7]>
  ]),
  packetHash: hash
}).strict();

function fail(message: string): never {
  throw new Error(`RMT rejected distribution deployment readiness: ${message}.`);
}

function codeHash(value: unknown, label: string): Hex {
  const parsed = nonemptyBytecode.safeParse(value);
  if (!parsed.success) fail(`${label} bytecode is missing or malformed`);
  return keccak256(parsed.data as Hex);
}

function packetCore(input: ReadinessInput) {
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommit)) fail("source commit is not an exact lowercase Git SHA");
  return {
    schemaVersion: 1 as const,
    status: "predeployment_unapproved" as const,
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    sourceCommit: input.sourceCommit,
    compiler: { version: "0.8.26" as const, optimizer: true as const, optimizerRuns: 200 as const, viaIr: true as const },
    artifacts: {
      engineCreationCodeHash: codeHash(input.engineCreationCode, "engine creation"),
      retirementSinkCreationCodeHash: codeHash(input.retirementSinkCreationCode, "retirement sink creation"),
      retirementSinkRuntimeHash: codeHash(input.retirementSinkRuntimeCode, "retirement sink runtime")
    },
    dependency: {
      rmtToken: OFFICIAL_RMT_DISTRIBUTION_TOKEN,
      rmtRuntimeHash: OFFICIAL_RMT_DISTRIBUTION_RUNTIME_HASH
    },
    utilityPolicy: {
      status: "unapproved" as const,
      policyVersion: null,
      erc20CostPerRecipientAtomic: null,
      erc721CostPerRecipientAtomic: null,
      erc1155CostPerRecipientAtomic: null
    },
    operator: { status: "unapproved" as const, deployer: null },
    deployment: {
      authorized: false as const,
      method: null,
      engine: null,
      retirementSink: null,
      transactionHash: null
    },
    activation: {
      publicUiAuthorized: false as const,
      walletSubmissionEnabled: false as const,
      serverSubmissionEnabled: false as const
    },
    canaryProof: {
      oneRmtEachVerified: false as const,
      activatedCanaryCount: 0 as const,
      ownerWithdrawalProofVerified: false as const
    },
    safeForForkRehearsal: true as const,
    safeForLiveDeployment: false as const,
    blockers: DEPLOYMENT_BLOCKERS
  };
}

export function buildDistributionDeploymentReadinessPacketV1(
  input: ReadinessInput
): DistributionDeploymentReadinessPacketV1 {
  const core = packetCore(input);
  return { ...core, packetHash: keccak256(toBytes(canonicalDistributionJson(core))) };
}

export function parseDistributionDeploymentReadinessPacketV1(
  value: unknown
): DistributionDeploymentReadinessPacketV1 {
  const parsed = readinessSchema.safeParse(value);
  if (!parsed.success) fail("packet shape or disabled release boundary changed");
  const packet = parsed.data as DistributionDeploymentReadinessPacketV1;
  const { packetHash, ...core } = packet;
  const expectedHash = keccak256(toBytes(canonicalDistributionJson(core)));
  if (packetHash !== expectedHash) fail("packet hash is inconsistent");
  return packet;
}
