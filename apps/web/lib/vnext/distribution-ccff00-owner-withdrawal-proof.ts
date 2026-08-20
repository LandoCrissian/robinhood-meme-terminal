import {
  concatHex,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  isAddress,
  isHash,
  isHex,
  keccak256,
  numberToHex,
  padHex,
  sliceHex,
  toBytes,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";
import { canonicalDistributionJson, RMT_DISTRIBUTION_CHAIN_ID } from "./distribution-domain";
import type { Ccff00PublicSnapshotV1 } from "./distribution-ccff00";

export const CCFF00_OWNER_WITHDRAWAL_PROOF_SCHEMA_VERSION = 1 as const;
export const CCFF00_CANARY_RMT_AMOUNT_ATOMIC = 10n ** 18n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const registryAbi = [{
  type: "function",
  name: "createAccount",
  stateMutability: "nonpayable",
  inputs: [
    { name: "implementation", type: "address" },
    { name: "salt", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" }
  ],
  outputs: [{ name: "account", type: "address" }]
}, {
  type: "event",
  name: "ERC6551AccountCreated",
  anonymous: false,
  inputs: [
    { name: "account", type: "address", indexed: false },
    { name: "implementation", type: "address", indexed: true },
    { name: "salt", type: "bytes32", indexed: false },
    { name: "chainId", type: "uint256", indexed: false },
    { name: "tokenContract", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true }
  ]
}] as const;

const erc20Abi = [{
  type: "function",
  name: "transfer",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "success", type: "bool" }]
}, {
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false }
  ]
}] as const;

const accountAbi = [{
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" }
  ],
  outputs: [{ name: "result", type: "bytes" }]
}] as const;

export type Ccff00ProofReceiptLogV1 = {
  address: Address;
  topics: Hex[];
  data: Hex;
  logIndex: number;
};

export type Ccff00ProofTransactionV1 = {
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  transactionIndex: number;
  from: Address;
  to: Address;
  valueAtomic: string;
  input: Hex;
  status: "success";
  logs: Ccff00ProofReceiptLogV1[];
};

export type Ccff00OwnerWithdrawalProofCoreV1 = {
  schemaVersion: typeof CCFF00_OWNER_WITHDRAWAL_PROOF_SCHEMA_VERSION;
  chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  tokenId: string;
  collection: Address;
  tokenBoundAccount: Address;
  sourceSnapshot: {
    blockNumber: string;
    blockHash: Hex;
    snapshotHash: Hex;
    currentOwner: Address;
    collectionReturnedTokenBoundAccount: Address;
  };
  infrastructure: {
    registry: Address;
    registryRuntimeHash: Hex;
    accountImplementation: Address;
    implementationRuntimeHash: Hex;
    salt: Hex;
    accountChainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
    deployedTbaRuntimeHash: Hex;
  };
  assets: {
    ccff00Token: Address;
    ccff00RuntimeHash: Hex;
    rmtToken: Address;
    rmtRuntimeHash: Hex;
  };
  activation: {
    transaction: Ccff00ProofTransactionV1;
    accountCreatedLogIndex: number;
    resultingTokenBoundAccount: Address;
    ownerAfterActivation: Address;
    tokenBinding: {
      chainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
      collection: Address;
      tokenId: string;
    };
  };
  funding: {
    transaction: Ccff00ProofTransactionV1;
    sender: Address;
    amountAtomic: string;
    transferLogIndex: number;
    tbaRmtBalanceBeforeAtomic: string;
    tbaRmtBalanceAfterAtomic: string;
  };
  withdrawal: {
    transaction: Ccff00ProofTransactionV1;
    caller: Address;
    returnRecipient: Address;
    amountAtomic: string;
    transferLogIndex: number;
    tbaRmtBalanceBeforeAtomic: string;
    tbaRmtBalanceAfterAtomic: string;
    recipientRmtBalanceBeforeAtomic: string;
    recipientRmtBalanceAfterAtomic: string;
  };
  unchangedAssets: {
    ccff00BalanceBeforeAtomic: string;
    ccff00BalanceAfterAtomic: string;
  };
};

export type Ccff00OwnerWithdrawalProofV1 = Ccff00OwnerWithdrawalProofCoreV1 & {
  proofHash: Hex;
};

export type VerifiedCcff00OwnerWithdrawalProofV1 = {
  verified: true;
  tokenId: string;
  tokenBoundAccount: Address;
  currentOwner: Address;
  returnRecipient: Address;
  proofHash: Hex;
  transactionHashes: readonly [Hex, Hex, Hex];
};

export type Ccff00OwnerWithdrawalConfigurationV1 = {
  collection: Address;
  registry: Address;
  accountImplementation: Address;
  salt: Hex;
  accountChainId: typeof RMT_DISTRIBUTION_CHAIN_ID;
  ccff00Token: Address;
  rmtToken: Address;
  admittedCanaryTokenIds: readonly bigint[];
};

type VerificationInput = {
  proof: unknown;
  snapshot: Ccff00PublicSnapshotV1;
  configuration: Ccff00OwnerWithdrawalConfigurationV1;
  approvedReturnAddress: string;
  consumedProofHashes?: readonly string[];
  consumedTransactionHashes?: readonly string[];
};

const uintString = z.string().regex(/^(0|[1-9][0-9]*)$/);
const positiveUintString = z.string().regex(/^[1-9][0-9]*$/);
const addressSchema = z.string().refine((value) => isAddress(value, { strict: false }));
const hashSchema = z.string().refine((value) => isHash(value) && !/^0x0{64}$/i.test(value));
const bytesSchema = z.string().refine((value) => isHex(value) && value.length % 2 === 0);
const inputSchema = bytesSchema.refine((value) => value.length >= 10);

const logSchema = z.object({
  address: addressSchema,
  topics: z.array(hashSchema).min(1),
  data: bytesSchema,
  logIndex: z.number().int().nonnegative()
}).strict();

const transactionSchema = z.object({
  chainId: z.literal(RMT_DISTRIBUTION_CHAIN_ID),
  transactionHash: hashSchema,
  blockNumber: positiveUintString,
  blockHash: hashSchema,
  transactionIndex: z.number().int().nonnegative(),
  from: addressSchema,
  to: addressSchema,
  valueAtomic: uintString,
  input: inputSchema,
  status: z.literal("success"),
  logs: z.array(logSchema)
}).strict();

const proofCoreSchema = z.object({
  schemaVersion: z.literal(CCFF00_OWNER_WITHDRAWAL_PROOF_SCHEMA_VERSION),
  chainId: z.literal(RMT_DISTRIBUTION_CHAIN_ID),
  tokenId: positiveUintString,
  collection: addressSchema,
  tokenBoundAccount: addressSchema,
  sourceSnapshot: z.object({
    blockNumber: positiveUintString,
    blockHash: hashSchema,
    snapshotHash: hashSchema,
    currentOwner: addressSchema,
    collectionReturnedTokenBoundAccount: addressSchema
  }).strict(),
  infrastructure: z.object({
    registry: addressSchema,
    registryRuntimeHash: hashSchema,
    accountImplementation: addressSchema,
    implementationRuntimeHash: hashSchema,
    salt: hashSchema,
    accountChainId: z.literal(RMT_DISTRIBUTION_CHAIN_ID),
    deployedTbaRuntimeHash: hashSchema
  }).strict(),
  assets: z.object({
    ccff00Token: addressSchema,
    ccff00RuntimeHash: hashSchema,
    rmtToken: addressSchema,
    rmtRuntimeHash: hashSchema
  }).strict(),
  activation: z.object({
    transaction: transactionSchema,
    accountCreatedLogIndex: z.number().int().nonnegative(),
    resultingTokenBoundAccount: addressSchema,
    ownerAfterActivation: addressSchema,
    tokenBinding: z.object({
      chainId: z.literal(RMT_DISTRIBUTION_CHAIN_ID),
      collection: addressSchema,
      tokenId: positiveUintString
    }).strict()
  }).strict(),
  funding: z.object({
    transaction: transactionSchema,
    sender: addressSchema,
    amountAtomic: positiveUintString,
    transferLogIndex: z.number().int().nonnegative(),
    tbaRmtBalanceBeforeAtomic: uintString,
    tbaRmtBalanceAfterAtomic: uintString
  }).strict(),
  withdrawal: z.object({
    transaction: transactionSchema,
    caller: addressSchema,
    returnRecipient: addressSchema,
    amountAtomic: positiveUintString,
    transferLogIndex: z.number().int().nonnegative(),
    tbaRmtBalanceBeforeAtomic: uintString,
    tbaRmtBalanceAfterAtomic: uintString,
    recipientRmtBalanceBeforeAtomic: uintString,
    recipientRmtBalanceAfterAtomic: uintString
  }).strict(),
  unchangedAssets: z.object({
    ccff00BalanceBeforeAtomic: uintString,
    ccff00BalanceAfterAtomic: uintString
  }).strict()
}).strict();

const proofSchema = proofCoreSchema.extend({ proofHash: hashSchema }).strict();

function reject(message: string): never {
  throw new Error(`RMT rejected CCFF00 owner-withdrawal proof: ${message}`);
}

function address(value: string, label: string): Address {
  if (!isAddress(value, { strict: false })) reject(`${label} is not an address`);
  const normalized = getAddress(value);
  if (normalized.toLowerCase() === ZERO_ADDRESS) reject(`${label} is the zero address`);
  return normalized;
}

function hash(value: string, label: string): Hex {
  if (!isHash(value) || /^0x0{64}$/i.test(value)) reject(`${label} is not a nonzero hash`);
  return value.toLowerCase() as Hex;
}

function bytes(value: string, label: string, requireSelector = false): Hex {
  if (!isHex(value) || value.length % 2 !== 0 || (requireSelector && value.length < 10)) {
    reject(`${label} is not canonical calldata`);
  }
  return value.toLowerCase() as Hex;
}

function uint(value: string, label: string, positive = false): string {
  const pattern = positive ? /^[1-9][0-9]*$/ : /^(0|[1-9][0-9]*)$/;
  if (!pattern.test(value)) reject(`${label} is not a canonical unsigned integer`);
  return BigInt(value).toString();
}

function normalizeTransaction(value: z.infer<typeof transactionSchema>, label: string): Ccff00ProofTransactionV1 {
  const logs = value.logs.map((log, index) => ({
    address: address(log.address, `${label} log ${index} address`),
    topics: log.topics.map((topic, topicIndex) => hash(topic, `${label} log ${index} topic ${topicIndex}`)),
    data: bytes(log.data, `${label} log ${index} data`),
    logIndex: log.logIndex
  }));
  if (new Set(logs.map((log) => log.logIndex)).size !== logs.length) reject(`${label} contains duplicate log indices`);
  if (logs.some((log, index) => index > 0 && logs[index - 1].logIndex >= log.logIndex)) {
    reject(`${label} logs are not in canonical log-index order`);
  }
  return {
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    transactionHash: hash(value.transactionHash, `${label} transaction hash`),
    blockNumber: uint(value.blockNumber, `${label} block number`, true),
    blockHash: hash(value.blockHash, `${label} block hash`),
    transactionIndex: value.transactionIndex,
    from: address(value.from, `${label} sender`),
    to: address(value.to, `${label} target`),
    valueAtomic: uint(value.valueAtomic, `${label} native value`),
    input: bytes(value.input, `${label} input`, true),
    status: "success",
    logs
  };
}

function normalizeCore(value: unknown): Ccff00OwnerWithdrawalProofCoreV1 {
  const result = proofCoreSchema.safeParse(value);
  if (!result.success) reject("proof schema is malformed");
  const candidate = result.data;
  return {
    schemaVersion: CCFF00_OWNER_WITHDRAWAL_PROOF_SCHEMA_VERSION,
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    tokenId: uint(candidate.tokenId, "token ID", true),
    collection: address(candidate.collection, "collection"),
    tokenBoundAccount: address(candidate.tokenBoundAccount, "token-bound account"),
    sourceSnapshot: {
      blockNumber: uint(candidate.sourceSnapshot.blockNumber, "source snapshot block", true),
      blockHash: hash(candidate.sourceSnapshot.blockHash, "source snapshot block hash"),
      snapshotHash: hash(candidate.sourceSnapshot.snapshotHash, "source snapshot hash"),
      currentOwner: address(candidate.sourceSnapshot.currentOwner, "current owner"),
      collectionReturnedTokenBoundAccount: address(
        candidate.sourceSnapshot.collectionReturnedTokenBoundAccount,
        "collection-returned token-bound account"
      )
    },
    infrastructure: {
      registry: address(candidate.infrastructure.registry, "registry"),
      registryRuntimeHash: hash(candidate.infrastructure.registryRuntimeHash, "registry runtime"),
      accountImplementation: address(candidate.infrastructure.accountImplementation, "account implementation"),
      implementationRuntimeHash: hash(candidate.infrastructure.implementationRuntimeHash, "implementation runtime"),
      salt: hash(candidate.infrastructure.salt, "account salt"),
      accountChainId: RMT_DISTRIBUTION_CHAIN_ID,
      deployedTbaRuntimeHash: hash(candidate.infrastructure.deployedTbaRuntimeHash, "deployed TBA runtime")
    },
    assets: {
      ccff00Token: address(candidate.assets.ccff00Token, "CCFF00 token"),
      ccff00RuntimeHash: hash(candidate.assets.ccff00RuntimeHash, "CCFF00 runtime"),
      rmtToken: address(candidate.assets.rmtToken, "RMT token"),
      rmtRuntimeHash: hash(candidate.assets.rmtRuntimeHash, "RMT runtime")
    },
    activation: {
      transaction: normalizeTransaction(candidate.activation.transaction, "activation receipt"),
      accountCreatedLogIndex: candidate.activation.accountCreatedLogIndex,
      resultingTokenBoundAccount: address(candidate.activation.resultingTokenBoundAccount, "activation result"),
      ownerAfterActivation: address(candidate.activation.ownerAfterActivation, "owner after activation"),
      tokenBinding: {
        chainId: RMT_DISTRIBUTION_CHAIN_ID,
        collection: address(candidate.activation.tokenBinding.collection, "account token binding collection"),
        tokenId: uint(candidate.activation.tokenBinding.tokenId, "account token binding token ID", true)
      }
    },
    funding: {
      transaction: normalizeTransaction(candidate.funding.transaction, "funding receipt"),
      sender: address(candidate.funding.sender, "funding sender"),
      amountAtomic: uint(candidate.funding.amountAtomic, "funding amount", true),
      transferLogIndex: candidate.funding.transferLogIndex,
      tbaRmtBalanceBeforeAtomic: uint(candidate.funding.tbaRmtBalanceBeforeAtomic, "pre-funding TBA RMT balance"),
      tbaRmtBalanceAfterAtomic: uint(candidate.funding.tbaRmtBalanceAfterAtomic, "post-funding TBA RMT balance")
    },
    withdrawal: {
      transaction: normalizeTransaction(candidate.withdrawal.transaction, "withdrawal receipt"),
      caller: address(candidate.withdrawal.caller, "withdrawal caller"),
      returnRecipient: address(candidate.withdrawal.returnRecipient, "return recipient"),
      amountAtomic: uint(candidate.withdrawal.amountAtomic, "withdrawal amount", true),
      transferLogIndex: candidate.withdrawal.transferLogIndex,
      tbaRmtBalanceBeforeAtomic: uint(candidate.withdrawal.tbaRmtBalanceBeforeAtomic, "pre-withdrawal TBA RMT balance"),
      tbaRmtBalanceAfterAtomic: uint(candidate.withdrawal.tbaRmtBalanceAfterAtomic, "post-withdrawal TBA RMT balance"),
      recipientRmtBalanceBeforeAtomic: uint(candidate.withdrawal.recipientRmtBalanceBeforeAtomic, "pre-withdrawal recipient RMT balance"),
      recipientRmtBalanceAfterAtomic: uint(candidate.withdrawal.recipientRmtBalanceAfterAtomic, "post-withdrawal recipient RMT balance")
    },
    unchangedAssets: {
      ccff00BalanceBeforeAtomic: uint(candidate.unchangedAssets.ccff00BalanceBeforeAtomic, "pre-proof CCFF00 balance"),
      ccff00BalanceAfterAtomic: uint(candidate.unchangedAssets.ccff00BalanceAfterAtomic, "post-proof CCFF00 balance")
    }
  };
}

function proofHash(core: Ccff00OwnerWithdrawalProofCoreV1): Hex {
  return keccak256(toBytes(canonicalDistributionJson(core)));
}

export function buildCcff00OwnerWithdrawalProofV1(
  input: Ccff00OwnerWithdrawalProofCoreV1
): Ccff00OwnerWithdrawalProofV1 {
  const core = normalizeCore(input);
  return { ...core, proofHash: proofHash(core) };
}

export function parseCcff00OwnerWithdrawalProofV1(value: unknown): Ccff00OwnerWithdrawalProofV1 {
  const result = proofSchema.safeParse(value);
  if (!result.success) reject("proof schema is malformed");
  const candidate = result.data;
  const { proofHash: candidateHash, ...candidateCore } = candidate;
  const core = normalizeCore(candidateCore);
  const expected = proofHash(core);
  if (hash(candidateHash, "proof hash") !== expected) reject("proof hash is inconsistent");
  return { ...core, proofHash: expected };
}

function sameAddress(left: string, right: string) {
  return getAddress(left) === getAddress(right);
}

function assertAddress(label: string, actual: string, expected: string) {
  if (!sameAddress(actual, expected)) reject(`${label} is inconsistent`);
}

function assertHash(label: string, actual: string, expected: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) reject(`${label} is inconsistent`);
}

function accountCreationCode(configuration: Ccff00OwnerWithdrawalConfigurationV1, tokenId: bigint): Hex {
  return concatHex([
    "0x3d60ad80600a3d3981f3363d3d373d3d3d363d73",
    configuration.accountImplementation,
    "0x5af43d82803e903d91602b57fd5bf3",
    configuration.salt,
    numberToHex(BigInt(configuration.accountChainId), { size: 32 }),
    padHex(configuration.collection, { size: 32 }),
    numberToHex(tokenId, { size: 32 })
  ]);
}

function accountRuntimeCode(configuration: Ccff00OwnerWithdrawalConfigurationV1, tokenId: bigint): Hex {
  return concatHex([
    "0x363d3d373d3d3d363d73",
    configuration.accountImplementation,
    "0x5af43d82803e903d91602b57fd5bf3",
    configuration.salt,
    numberToHex(BigInt(configuration.accountChainId), { size: 32 }),
    padHex(configuration.collection, { size: 32 }),
    numberToHex(tokenId, { size: 32 })
  ]);
}

export function expectedCcff00TokenBoundAccountV1(
  configuration: Ccff00OwnerWithdrawalConfigurationV1,
  tokenId: bigint
): Address {
  const digest = keccak256(concatHex([
    "0xff",
    configuration.registry,
    configuration.salt,
    keccak256(accountCreationCode(configuration, tokenId))
  ]));
  return getAddress(sliceHex(digest, 12));
}

export function expectedCcff00TokenBoundRuntimeHashV1(
  configuration: Ccff00OwnerWithdrawalConfigurationV1,
  tokenId: bigint
): Hex {
  return keccak256(accountRuntimeCode(configuration, tokenId));
}

function decodeCall(input: Hex, abi: readonly unknown[], functionName: string, label: string) {
  try {
    const decoded = decodeFunctionData({ abi, data: input });
    if (decoded.functionName !== functionName) reject(`${label} calls the wrong function`);
    return decoded.args ?? [];
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("RMT rejected")) throw cause;
    return reject(`${label} calldata is malformed`);
  }
}

function matchingEventLogs(transaction: Ccff00ProofTransactionV1, contract: Address, abi: readonly unknown[], eventName: string) {
  const matches: Array<{ log: Ccff00ProofReceiptLogV1; args: Record<string, unknown> }> = [];
  for (const log of transaction.logs) {
    if (!sameAddress(log.address, contract)) continue;
    try {
      const decoded = decodeEventLog({
        abi,
        eventName,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data
      });
      matches.push({ log, args: decoded.args as unknown as Record<string, unknown> });
    } catch {
      // A receipt may contain unrelated events from the same contract.
    }
  }
  return matches;
}

function assertTransfer(
  transaction: Ccff00ProofTransactionV1,
  token: Address,
  expectedLogIndex: number,
  from: Address,
  to: Address,
  amount: bigint,
  label: string
) {
  const transfers = matchingEventLogs(transaction, token, erc20Abi, "Transfer");
  if (transfers.length !== 1) reject(`${label} must contain exactly one RMT Transfer`);
  const transfer = transfers[0];
  if (transfer.log.logIndex !== expectedLogIndex) reject(`${label} Transfer log index is inconsistent`);
  assertAddress(`${label} Transfer sender`, String(transfer.args.from), from);
  assertAddress(`${label} Transfer recipient`, String(transfer.args.to), to);
  if (BigInt(String(transfer.args.value)) !== amount) reject(`${label} Transfer amount is inconsistent`);
}

function assertTransactionOrder(left: Ccff00ProofTransactionV1, right: Ccff00ProofTransactionV1, label: string) {
  const leftBlock = BigInt(left.blockNumber);
  const rightBlock = BigInt(right.blockNumber);
  if (rightBlock < leftBlock || (rightBlock === leftBlock && right.transactionIndex <= left.transactionIndex)) {
    reject(`${label} transaction order is inconsistent`);
  }
}

export function verifyCcff00OwnerWithdrawalProofV1(
  input: VerificationInput
): VerifiedCcff00OwnerWithdrawalProofV1 {
  const proof = parseCcff00OwnerWithdrawalProofV1(input.proof);
  const configuration = input.configuration;
  const tokenId = BigInt(proof.tokenId);
  const admitted = new Set(configuration.admittedCanaryTokenIds.map(String));
  if (admitted.size === 0 || !admitted.has(proof.tokenId)) reject("token ID is not an admitted canary");
  if (proof.chainId !== RMT_DISTRIBUTION_CHAIN_ID || proof.infrastructure.accountChainId !== RMT_DISTRIBUTION_CHAIN_ID) {
    reject("chain identity is inconsistent");
  }

  const row = input.snapshot.rows.find((candidate) => candidate.tokenId === proof.tokenId);
  if (!row) reject("token ID is absent from the source snapshot");
  assertAddress("collection", proof.collection, configuration.collection);
  assertAddress("snapshot collection", input.snapshot.collection, configuration.collection);
  if (proof.sourceSnapshot.blockNumber !== input.snapshot.snapshotBlock) reject("source snapshot block is inconsistent");
  assertHash("source snapshot block hash", proof.sourceSnapshot.blockHash, input.snapshot.snapshotBlockHash);
  assertHash("source snapshot hash", proof.sourceSnapshot.snapshotHash, input.snapshot.snapshotHash);
  assertAddress("current owner", proof.sourceSnapshot.currentOwner, row.owner);
  assertAddress("collection-returned TBA", proof.sourceSnapshot.collectionReturnedTokenBoundAccount, row.tokenBoundAccount);
  assertAddress("canonical TBA", proof.tokenBoundAccount, row.tokenBoundAccount);

  assertAddress("registry", proof.infrastructure.registry, configuration.registry);
  assertHash("registry runtime", proof.infrastructure.registryRuntimeHash, input.snapshot.erc6551RegistryRuntimeHash);
  assertAddress("account implementation", proof.infrastructure.accountImplementation, configuration.accountImplementation);
  assertHash("implementation runtime", proof.infrastructure.implementationRuntimeHash, input.snapshot.accountImplementationRuntimeHash);
  assertHash("account salt", proof.infrastructure.salt, configuration.salt);
  assertAddress("CCFF00 token", proof.assets.ccff00Token, configuration.ccff00Token);
  assertHash("CCFF00 runtime", proof.assets.ccff00RuntimeHash, input.snapshot.ccff00RuntimeHash);
  assertAddress("RMT token", proof.assets.rmtToken, configuration.rmtToken);
  assertHash("RMT runtime", proof.assets.rmtRuntimeHash, input.snapshot.rmtRuntimeHash);

  const expectedTba = expectedCcff00TokenBoundAccountV1(configuration, tokenId);
  assertAddress("deterministic TBA", proof.tokenBoundAccount, expectedTba);
  const expectedRuntimeHash = expectedCcff00TokenBoundRuntimeHashV1(configuration, tokenId);
  assertHash("deployed TBA runtime", proof.infrastructure.deployedTbaRuntimeHash, expectedRuntimeHash);

  const activation = proof.activation.transaction;
  const funding = proof.funding.transaction;
  const withdrawal = proof.withdrawal.transaction;
  const transactionHashes = [activation.transactionHash, funding.transactionHash, withdrawal.transactionHash] as const;
  if (new Set(transactionHashes).size !== transactionHashes.length) reject("receipt evidence is duplicated or replayed");
  if (BigInt(activation.blockNumber) < BigInt(proof.sourceSnapshot.blockNumber)) reject("activation predates the source snapshot");
  assertTransactionOrder(activation, funding, "activation/funding");
  assertTransactionOrder(funding, withdrawal, "funding/withdrawal");

  const consumedProofs = new Set((input.consumedProofHashes ?? []).map((value) => hash(value, "consumed proof hash")));
  if (consumedProofs.has(proof.proofHash)) reject("proof hash has already been consumed");
  const consumedTransactions = new Set((input.consumedTransactionHashes ?? []).map((value) => hash(value, "consumed transaction hash")));
  if (transactionHashes.some((value) => consumedTransactions.has(value))) reject("transaction evidence has already been consumed");

  assertAddress("activation target", activation.to, configuration.registry);
  if (activation.valueAtomic !== "0") reject("activation native value must be zero");
  const activationArgs = decodeCall(activation.input, registryAbi, "createAccount", "activation") as readonly unknown[];
  assertAddress("activation implementation", String(activationArgs[0]), configuration.accountImplementation);
  assertHash("activation salt", String(activationArgs[1]), configuration.salt);
  if (BigInt(String(activationArgs[2])) !== BigInt(RMT_DISTRIBUTION_CHAIN_ID)) reject("activation account chain is inconsistent");
  assertAddress("activation collection", String(activationArgs[3]), configuration.collection);
  if (BigInt(String(activationArgs[4])) !== tokenId) reject("activation token ID is inconsistent");
  const creationEvents = matchingEventLogs(activation, configuration.registry, registryAbi, "ERC6551AccountCreated");
  if (creationEvents.length !== 1) reject("activation must contain exactly one registry account-creation event");
  const creation = creationEvents[0];
  if (creation.log.logIndex !== proof.activation.accountCreatedLogIndex) reject("account-creation log index is inconsistent");
  assertAddress("created account", String(creation.args.account), proof.tokenBoundAccount);
  assertAddress("created implementation", String(creation.args.implementation), configuration.accountImplementation);
  assertHash("created account salt", String(creation.args.salt), configuration.salt);
  if (BigInt(String(creation.args.chainId)) !== BigInt(RMT_DISTRIBUTION_CHAIN_ID)) reject("created account chain is inconsistent");
  assertAddress("created account collection", String(creation.args.tokenContract), configuration.collection);
  if (BigInt(String(creation.args.tokenId)) !== tokenId) reject("created account token ID is inconsistent");
  assertAddress("activation resulting TBA", proof.activation.resultingTokenBoundAccount, proof.tokenBoundAccount);
  assertAddress("owner after activation", proof.activation.ownerAfterActivation, proof.sourceSnapshot.currentOwner);
  if (
    proof.activation.tokenBinding.chainId !== RMT_DISTRIBUTION_CHAIN_ID
    || proof.activation.tokenBinding.tokenId !== proof.tokenId
  ) reject("activated account token binding is inconsistent");
  assertAddress("activated account token binding collection", proof.activation.tokenBinding.collection, configuration.collection);

  if (proof.funding.amountAtomic !== CCFF00_CANARY_RMT_AMOUNT_ATOMIC.toString()) reject("funding amount is not exactly 1 RMT");
  assertAddress("funding transaction sender", funding.from, proof.funding.sender);
  assertAddress("funding transaction target", funding.to, configuration.rmtToken);
  if (funding.valueAtomic !== "0") reject("funding native value must be zero");
  const fundingArgs = decodeCall(funding.input, erc20Abi, "transfer", "funding") as readonly unknown[];
  assertAddress("funding calldata recipient", String(fundingArgs[0]), proof.tokenBoundAccount);
  if (BigInt(String(fundingArgs[1])) !== CCFF00_CANARY_RMT_AMOUNT_ATOMIC) reject("funding calldata amount is inconsistent");
  assertTransfer(
    funding,
    configuration.rmtToken,
    proof.funding.transferLogIndex,
    proof.funding.sender,
    proof.tokenBoundAccount,
    CCFF00_CANARY_RMT_AMOUNT_ATOMIC,
    "funding"
  );
  const fundingBefore = BigInt(proof.funding.tbaRmtBalanceBeforeAtomic);
  const fundingAfter = BigInt(proof.funding.tbaRmtBalanceAfterAtomic);
  if (fundingAfter - fundingBefore !== CCFF00_CANARY_RMT_AMOUNT_ATOMIC) reject("funding TBA balance delta is inconsistent");

  const approvedReturnAddress = address(input.approvedReturnAddress, "approved return address");
  assertAddress("withdrawal caller", proof.withdrawal.caller, proof.sourceSnapshot.currentOwner);
  assertAddress("withdrawal transaction caller", withdrawal.from, proof.withdrawal.caller);
  assertAddress("withdrawal transaction target", withdrawal.to, proof.tokenBoundAccount);
  assertAddress("withdrawal return recipient", proof.withdrawal.returnRecipient, approvedReturnAddress);
  if (proof.withdrawal.amountAtomic !== CCFF00_CANARY_RMT_AMOUNT_ATOMIC.toString()) reject("withdrawal amount is not exactly 1 RMT");
  if (withdrawal.valueAtomic !== "0") reject("withdrawal native value must be zero");
  const executeArgs = decodeCall(withdrawal.input, accountAbi, "execute", "withdrawal") as readonly unknown[];
  assertAddress("withdrawal execute target", String(executeArgs[0]), configuration.rmtToken);
  if (BigInt(String(executeArgs[1])) !== 0n || BigInt(String(executeArgs[3])) !== 0n) {
    reject("withdrawal execute value or operation is inconsistent");
  }
  const innerArgs = decodeCall(String(executeArgs[2]) as Hex, erc20Abi, "transfer", "withdrawal inner transfer") as readonly unknown[];
  assertAddress("withdrawal calldata recipient", String(innerArgs[0]), approvedReturnAddress);
  if (BigInt(String(innerArgs[1])) !== CCFF00_CANARY_RMT_AMOUNT_ATOMIC) reject("withdrawal calldata amount is inconsistent");
  assertTransfer(
    withdrawal,
    configuration.rmtToken,
    proof.withdrawal.transferLogIndex,
    proof.tokenBoundAccount,
    approvedReturnAddress,
    CCFF00_CANARY_RMT_AMOUNT_ATOMIC,
    "withdrawal"
  );

  const withdrawalTbaBefore = BigInt(proof.withdrawal.tbaRmtBalanceBeforeAtomic);
  const withdrawalTbaAfter = BigInt(proof.withdrawal.tbaRmtBalanceAfterAtomic);
  const recipientBefore = BigInt(proof.withdrawal.recipientRmtBalanceBeforeAtomic);
  const recipientAfter = BigInt(proof.withdrawal.recipientRmtBalanceAfterAtomic);
  if (withdrawalTbaBefore !== fundingAfter) reject("withdrawal does not begin from the funded TBA balance");
  if (withdrawalTbaAfter !== fundingBefore || withdrawalTbaBefore - withdrawalTbaAfter !== CCFF00_CANARY_RMT_AMOUNT_ATOMIC) {
    reject("withdrawal does not restore the original TBA RMT balance");
  }
  if (recipientAfter - recipientBefore !== CCFF00_CANARY_RMT_AMOUNT_ATOMIC) reject("return-recipient balance delta is inconsistent");
  if (proof.unchangedAssets.ccff00BalanceAfterAtomic !== proof.unchangedAssets.ccff00BalanceBeforeAtomic) {
    reject("CCFF00 balance changed during owner-control proof");
  }

  return {
    verified: true,
    tokenId: proof.tokenId,
    tokenBoundAccount: proof.tokenBoundAccount,
    currentOwner: proof.sourceSnapshot.currentOwner,
    returnRecipient: proof.withdrawal.returnRecipient,
    proofHash: proof.proofHash,
    transactionHashes
  };
}
