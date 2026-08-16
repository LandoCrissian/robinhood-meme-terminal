import { getAddress, isAddress, isHash, keccak256, type Address, type Hex } from "viem";
import { z } from "zod";
import { RMT_DISTRIBUTION_CHAIN_ID, UINT256_MAX } from "./distribution-domain";

export type DistributionDeploymentManifestV1 = {
  schemaVersion: 1;
  status: "deployed_not_publicly_activated";
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  contract: "RMTDistributionEngineV1";
  sinkContract: "RMTRetirementSinkV1";
  sourceCommit: string;
  compiler: { version: "0.8.26"; optimizer: true; optimizerRuns: 200; viaIr: true };
  constructorArguments: {
    rmtToken: Address;
    retirementSink: Address;
    erc20CostPerRecipientAtomic: string;
    erc721CostPerRecipientAtomic: string;
    erc1155CostPerRecipientAtomic: string;
  };
  deployment: {
    deployer: Address;
    transactionHash: Hex;
    blockNumber: string;
    blockHash: Hex;
    engine: Address;
    engineRuntimeHash: Hex;
    retirementSink: Address;
    retirementSinkRuntimeHash: Hex;
    rmtRuntimeHash: Hex;
  };
  activation: {
    publicUiAuthorized: false;
    walletSubmissionEnabled: false;
    serverSubmissionEnabled: false;
  };
};

export type DistributionRuntimeEvidenceV1 = {
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  blockNumber: string;
  blockHash: Hex;
  engine: Address;
  engineRuntimeHash: Hex;
  retirementSink: Address;
  retirementSinkRuntimeHash: Hex;
  rmtToken: Address;
  rmtRuntimeHash: Hex;
  engineChainId: string;
  engineRmtToken: Address;
  engineRetirementSink: Address;
  engineRmtRuntimeHash: Hex;
  engineRetirementSinkRuntimeHash: Hex;
  erc20CostPerRecipientAtomic: string;
  erc721CostPerRecipientAtomic: string;
  erc1155CostPerRecipientAtomic: string;
  engineProxyImplementation: null;
  retirementSinkProxyImplementation: null;
};

export type VerifiedDistributionRuntimeV1 = {
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  verifiedAtBlock: string;
  verifiedBlockHash: Hex;
  engine: Address;
  retirementSink: Address;
  rmtToken: Address;
  technicalRuntimeVerified: true;
  publicActivationEligible: false;
  walletSubmissionEnabled: false;
  serverSubmissionEnabled: false;
};

export type DistributionRuntimeReadClientV1 = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<{ number: bigint; hash: Hex | null }>;
  getBytecode(input: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>;
  getStorageAt(input: { address: Address; slot: Hex; blockNumber: bigint }): Promise<Hex | undefined>;
  readContract(input: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    blockNumber: bigint;
  }): Promise<unknown>;
};

export const RMT_DISTRIBUTION_RUNTIME_READ_ABI = [
  { type: "function", name: "CHAIN_ID", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rmtToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "retirementSink", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "rmtTokenRuntimeHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "retirementSinkRuntimeHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "erc20CostPerRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "erc721CostPerRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "erc1155CostPerRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }
] as const;

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;

const address = z.string().refine((value) => isAddress(value, { strict: false }));
const hash = z.string().refine((value) => isHash(value) && !/^0x0{64}$/i.test(value));
const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/).refine((value) => BigInt(value) <= UINT256_MAX);
const positiveAtomic = atomic.refine((value) => BigInt(value) > 0n);

const deploymentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("deployed_not_publicly_activated"),
  chainId: z.literal(4_663),
  contract: z.literal("RMTDistributionEngineV1"),
  sinkContract: z.literal("RMTRetirementSinkV1"),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  compiler: z.object({
    version: z.literal("0.8.26"), optimizer: z.literal(true), optimizerRuns: z.literal(200), viaIr: z.literal(true)
  }).strict(),
  constructorArguments: z.object({
    rmtToken: address,
    retirementSink: address,
    erc20CostPerRecipientAtomic: positiveAtomic,
    erc721CostPerRecipientAtomic: positiveAtomic,
    erc1155CostPerRecipientAtomic: positiveAtomic
  }).strict(),
  deployment: z.object({
    deployer: address,
    transactionHash: hash,
    blockNumber: positiveAtomic,
    blockHash: hash,
    engine: address,
    engineRuntimeHash: hash,
    retirementSink: address,
    retirementSinkRuntimeHash: hash,
    rmtRuntimeHash: hash
  }).strict(),
  activation: z.object({
    publicUiAuthorized: z.literal(false),
    walletSubmissionEnabled: z.literal(false),
    serverSubmissionEnabled: z.literal(false)
  }).strict()
}).strict();

const runtimeEvidenceSchema = z.object({
  chainId: z.literal(4_663),
  blockNumber: positiveAtomic,
  blockHash: hash,
  engine: address,
  engineRuntimeHash: hash,
  retirementSink: address,
  retirementSinkRuntimeHash: hash,
  rmtToken: address,
  rmtRuntimeHash: hash,
  engineChainId: z.literal("4663"),
  engineRmtToken: address,
  engineRetirementSink: address,
  engineRmtRuntimeHash: hash,
  engineRetirementSinkRuntimeHash: hash,
  erc20CostPerRecipientAtomic: positiveAtomic,
  erc721CostPerRecipientAtomic: positiveAtomic,
  erc1155CostPerRecipientAtomic: positiveAtomic,
  engineProxyImplementation: z.null(),
  retirementSinkProxyImplementation: z.null()
}).strict();

function same(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected distribution runtime evidence: ${message}.`);
}

function runtimeHash(code: Hex | undefined, label: string): Hex {
  invariant(code !== undefined && code !== "0x", `${label} has no runtime bytecode`);
  return keccak256(code);
}

function unsigned(value: unknown, label: string): bigint {
  invariant(typeof value === "bigint" && value >= 0n && value <= UINT256_MAX, `${label} is invalid`);
  return value;
}

function readAddress(value: unknown, label: string): Address {
  invariant(typeof value === "string" && isAddress(value, { strict: false }), `${label} is invalid`);
  return getAddress(value);
}

function readHash(value: unknown, label: string): Hex {
  invariant(typeof value === "string" && isHash(value) && !/^0x0{64}$/i.test(value), `${label} is invalid`);
  return value.toLowerCase() as Hex;
}

function emptyImplementationSlot(value: Hex | undefined) {
  return value === undefined || /^0x0*$/i.test(value);
}

export async function readDistributionRuntimeEvidenceV1(
  client: DistributionRuntimeReadClientV1,
  manifestValue: unknown,
  requestedBlock?: bigint
): Promise<DistributionRuntimeEvidenceV1> {
  const manifest = parseDistributionDeploymentManifestV1(manifestValue);
  const chainId = await client.getChainId();
  invariant(chainId === RMT_DISTRIBUTION_CHAIN_ID, "RPC returned the wrong chain");
  const blockNumber = requestedBlock ?? await client.getBlockNumber();
  invariant(blockNumber > 0n, "verification block is invalid");
  const block = await client.getBlock({ blockNumber });
  invariant(block.number === blockNumber && block.hash !== null, "verification block identity is unavailable");
  const engine = getAddress(manifest.deployment.engine);
  const retirementSink = getAddress(manifest.deployment.retirementSink);
  const rmtToken = getAddress(manifest.constructorArguments.rmtToken);
  const read = (functionName: string) => client.readContract({
    address: engine,
    abi: RMT_DISTRIBUTION_RUNTIME_READ_ABI,
    functionName,
    blockNumber
  });
  const [
    engineCode, sinkCode, rmtCode, engineProxySlot, sinkProxySlot, engineChainId, engineRmtToken,
    engineRetirementSink, engineRmtRuntimeHash, engineRetirementSinkRuntimeHash, erc20Cost, erc721Cost, erc1155Cost
  ] = await Promise.all([
    client.getBytecode({ address: engine, blockNumber }),
    client.getBytecode({ address: retirementSink, blockNumber }),
    client.getBytecode({ address: rmtToken, blockNumber }),
    client.getStorageAt({ address: engine, slot: EIP1967_IMPLEMENTATION_SLOT, blockNumber }),
    client.getStorageAt({ address: retirementSink, slot: EIP1967_IMPLEMENTATION_SLOT, blockNumber }),
    read("CHAIN_ID"),
    read("rmtToken"),
    read("retirementSink"),
    read("rmtTokenRuntimeHash"),
    read("retirementSinkRuntimeHash"),
    read("erc20CostPerRecipient"),
    read("erc721CostPerRecipient"),
    read("erc1155CostPerRecipient")
  ]);
  invariant(emptyImplementationSlot(engineProxySlot), "engine has an unexpected EIP-1967 implementation");
  invariant(emptyImplementationSlot(sinkProxySlot), "retirement sink has an unexpected EIP-1967 implementation");

  return {
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    blockNumber: blockNumber.toString(),
    blockHash: block.hash,
    engine,
    engineRuntimeHash: runtimeHash(engineCode, "engine"),
    retirementSink,
    retirementSinkRuntimeHash: runtimeHash(sinkCode, "retirement sink"),
    rmtToken,
    rmtRuntimeHash: runtimeHash(rmtCode, "RMT token"),
    engineChainId: unsigned(engineChainId, "engine chain ID").toString(),
    engineRmtToken: readAddress(engineRmtToken, "engine RMT token"),
    engineRetirementSink: readAddress(engineRetirementSink, "engine retirement sink"),
    engineRmtRuntimeHash: readHash(engineRmtRuntimeHash, "engine RMT runtime hash"),
    engineRetirementSinkRuntimeHash: readHash(engineRetirementSinkRuntimeHash, "engine sink runtime hash"),
    erc20CostPerRecipientAtomic: unsigned(erc20Cost, "ERC-20 utility rate").toString(),
    erc721CostPerRecipientAtomic: unsigned(erc721Cost, "ERC-721 utility rate").toString(),
    erc1155CostPerRecipientAtomic: unsigned(erc1155Cost, "ERC-1155 utility rate").toString(),
    engineProxyImplementation: null,
    retirementSinkProxyImplementation: null
  };
}

export function parseDistributionDeploymentManifestV1(value: unknown): DistributionDeploymentManifestV1 {
  const parsed = deploymentManifestSchema.safeParse(value);
  if (!parsed.success) throw new Error("RMT rejected a malformed distribution deployment manifest.");
  const manifest = parsed.data as DistributionDeploymentManifestV1;
  invariant(
    getAddress(manifest.constructorArguments.retirementSink) === getAddress(manifest.deployment.retirementSink),
    "constructor and deployed retirement sink differ"
  );
  invariant(
    getAddress(manifest.constructorArguments.rmtToken) !== getAddress(manifest.constructorArguments.retirementSink),
    "RMT token and retirement sink collide"
  );
  return manifest;
}

export function verifyDistributionRuntimeV1(
  manifestValue: unknown,
  evidenceValue: unknown
): VerifiedDistributionRuntimeV1 {
  const manifest = parseDistributionDeploymentManifestV1(manifestValue);
  const parsedEvidence = runtimeEvidenceSchema.safeParse(evidenceValue);
  if (!parsedEvidence.success) throw new Error("RMT rejected malformed onchain distribution runtime evidence.");
  const evidence = parsedEvidence.data as DistributionRuntimeEvidenceV1;
  const constructor = manifest.constructorArguments;
  const deployment = manifest.deployment;

  invariant(evidence.chainId === manifest.chainId && evidence.engineChainId === "4663", "chain identity changed");
  invariant(same(evidence.engine, deployment.engine), "engine address changed");
  invariant(same(evidence.engineRuntimeHash, deployment.engineRuntimeHash), "engine runtime changed");
  invariant(same(evidence.retirementSink, deployment.retirementSink), "retirement sink address changed");
  invariant(
    same(evidence.retirementSinkRuntimeHash, deployment.retirementSinkRuntimeHash),
    "retirement sink runtime changed"
  );
  invariant(same(evidence.rmtToken, constructor.rmtToken), "RMT token address changed");
  invariant(same(evidence.rmtRuntimeHash, deployment.rmtRuntimeHash), "RMT runtime changed");
  invariant(same(evidence.engineRmtToken, constructor.rmtToken), "engine RMT immutable changed");
  invariant(same(evidence.engineRetirementSink, constructor.retirementSink), "engine sink immutable changed");
  invariant(same(evidence.engineRmtRuntimeHash, deployment.rmtRuntimeHash), "engine RMT runtime binding changed");
  invariant(
    same(evidence.engineRetirementSinkRuntimeHash, deployment.retirementSinkRuntimeHash),
    "engine sink runtime binding changed"
  );
  invariant(
    evidence.erc20CostPerRecipientAtomic === constructor.erc20CostPerRecipientAtomic,
    "ERC-20 utility rate changed"
  );
  invariant(
    evidence.erc721CostPerRecipientAtomic === constructor.erc721CostPerRecipientAtomic,
    "ERC-721 utility rate changed"
  );
  invariant(
    evidence.erc1155CostPerRecipientAtomic === constructor.erc1155CostPerRecipientAtomic,
    "ERC-1155 utility rate changed"
  );
  invariant(evidence.engineProxyImplementation === null, "engine unexpectedly became a proxy");
  invariant(evidence.retirementSinkProxyImplementation === null, "retirement sink unexpectedly became a proxy");

  return {
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    verifiedAtBlock: evidence.blockNumber,
    verifiedBlockHash: evidence.blockHash,
    engine: getAddress(evidence.engine),
    retirementSink: getAddress(evidence.retirementSink),
    rmtToken: getAddress(evidence.rmtToken),
    technicalRuntimeVerified: true,
    publicActivationEligible: false,
    walletSubmissionEnabled: false,
    serverSubmissionEnabled: false
  };
}
