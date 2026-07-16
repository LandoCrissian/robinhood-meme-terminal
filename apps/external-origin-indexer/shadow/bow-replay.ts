import { createHash } from "node:crypto";
import {
  BOW_FACTORY,
  bowCandidate,
  decodeBowLaunchedLog,
  type BowRawLaunchedLog,
  type DecodedBowLaunch
} from "../src/candidates/bow-candidate.js";

export const BOW_MAX_SHADOW_REPLAY_BLOCKS = 2_000n;
export const BOW_MAX_SHADOW_REPLAY_LOGS = 10_000;

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const DATA_PATTERN = /^0x[0-9a-f]*$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_HASH = `0x${"0".repeat(64)}`;

export type BowReplayBlockHeader = Readonly<{
  blockNumber: bigint;
  blockHash: `0x${string}`;
  parentHash: `0x${string}`;
}>;

export type BowReplayLog = Readonly<
  Omit<
    BowRawLaunchedLog,
    "address" | "blockHash" | "transactionHash"
  > & {
    address: `0x${string}`;
    blockHash: `0x${string}`;
    transactionHash: `0x${string}`;
    transactionIndex: number;
  }
>;

export type BowReplayReceipt = Readonly<{
  transactionHash: `0x${string}`;
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionIndex: number;
  logs: readonly BowReplayLog[];
}>;

export type BowReplayLaunchState = DecodedBowLaunch &
  Readonly<{
    sampledAtBlock: bigint;
    sampledAtBlockHash: `0x${string}`;
  }>;

export type BowReplayTranscript = Readonly<{
  chainId: 4663;
  range: Readonly<{ fromBlock: bigint; toBlock: bigint }>;
  finalizedHead: Readonly<{
    blockNumber: bigint;
    blockHash: `0x${string}`;
  }>;
  deploymentAnchor: Readonly<{
    blockNumber: bigint;
    blockHash: `0x${string}`;
  }>;
  parentCheckpoint: BowReplayBlockHeader;
  blocks: readonly BowReplayBlockHeader[];
  factoryRuntimeChecks: readonly Readonly<{
    blockNumber: bigint;
    blockHash: `0x${string}`;
    lengthBytes: number;
    reportedCodeHash: `0x${string}`;
  }>[];
  launchCountBefore: Readonly<{
    sampledAtBlock: bigint;
    sampledAtBlockHash: `0x${string}`;
    value: bigint;
  }>;
  launchCountAfter: Readonly<{
    sampledAtBlock: bigint;
    sampledAtBlockHash: `0x${string}`;
    value: bigint;
  }>;
  logs: readonly BowReplayLog[];
  receipts: readonly BowReplayReceipt[];
  launchState: readonly BowReplayLaunchState[];
  contractCode: readonly Readonly<{
    address: `0x${string}`;
    sampledAtBlock: bigint;
    sampledAtBlockHash: `0x${string}`;
    lengthBytes: number;
  }>[];
}>;

export type BowShadowObservation = Readonly<{
  kind: "shadow-bow-launch-observation";
  sourceId: "bow";
  chainId: 4663;
  factory: typeof BOW_FACTORY;
  token: `0x${string}`;
  deployer: `0x${string}`;
  pool: `0x${string}`;
  positionId: bigint;
  launchId: bigint;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}>;

export type BowShadowReplayResult = Readonly<{
  schema: "rmt-bow-shadow-replay-result-v1";
  kind: "shadow-bow-replay-result";
  candidateId: typeof bowCandidate.candidateId;
  sourceVerification: "unverified";
  authoritative: false;
  activationEligible: false;
  independentProviderAgreement: false;
  finalizedAncestryProven: false;
  runtimeHashLocallyComputed: false;
  persistence: "none";
  adapterRegistered: false;
  range: Readonly<{ fromBlock: bigint; toBlock: bigint }>;
  previousCheckpoint: BowReplayBlockHeader;
  checkpoint: BowReplayBlockHeader;
  launchCountBefore: bigint;
  launchCountAfter: bigint;
  observations: readonly BowShadowObservation[];
  transcriptHash: `0x${string}`;
}>;

function reject(reason: string): never {
  throw new Error(`Bow shadow replay rejected: ${reason}`);
}

function requireHash(value: string, name: string): `0x${string}` {
  if (!HASH_PATTERN.test(value) || value === ZERO_HASH) {
    return reject(`${name} must be a nonzero lowercase hash`);
  }
  return value as `0x${string}`;
}

function requireAddress(value: string, name: string): `0x${string}` {
  if (!ADDRESS_PATTERN.test(value) || value === ZERO_ADDRESS) {
    return reject(`${name} must be a nonzero lowercase address`);
  }
  return value as `0x${string}`;
}

function requireIndex(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    reject(`${name} must be a nonnegative safe integer`);
  }
}

function requireLength(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    reject(`${name} must be a positive safe integer`);
  }
}

function logIdentity(log: BowReplayLog) {
  return `${log.transactionHash}:${log.logIndex}`;
}

function canonicalReplayLog(log: BowReplayLog) {
  requireAddress(log.address, "log emitter");
  requireHash(log.blockHash, "log blockHash");
  requireHash(log.transactionHash, "log transactionHash");
  requireIndex(log.transactionIndex, "log transactionIndex");
  requireIndex(log.logIndex, "log logIndex");
  if (log.removed) reject("removed logs are not canonical");
  if (log.topics.length !== 3) reject("launch logs must have three topics");
  for (const [index, topic] of log.topics.entries()) {
    requireHash(topic, `log topic ${index}`);
  }
  if (!DATA_PATTERN.test(log.data) || log.data.length !== 194) {
    reject("launch log data must be exactly three lowercase ABI words");
  }
  return JSON.stringify({
    address: log.address,
    topics: log.topics,
    data: log.data,
    blockNumber: log.blockNumber.toString(),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex
  });
}

function compareChainPosition(left: BowReplayLog, right: BowReplayLog) {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber < right.blockNumber ? -1 : 1;
  }
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  return left.logIndex - right.logIndex;
}

function replayHash(input: unknown): `0x${string}` {
  const digest = createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
  return `0x${digest}`;
}

export function validateBowShadowReplay(
  transcript: BowReplayTranscript
): BowShadowReplayResult {
  if (transcript.chainId !== bowCandidate.chainId) {
    reject("wrong chain ID");
  }
  const { fromBlock, toBlock } = transcript.range;
  if (fromBlock < bowCandidate.deployment.blockNumber) {
    reject("range begins before the pinned factory deployment");
  }
  if (toBlock < fromBlock) reject("range end precedes its start");
  const blockCount = toBlock - fromBlock + 1n;
  if (blockCount > BOW_MAX_SHADOW_REPLAY_BLOCKS) {
    reject("range exceeds the bounded replay window");
  }
  if (transcript.finalizedHead.blockNumber < toBlock) {
    reject("range extends beyond the supplied finalized head");
  }
  requireHash(transcript.finalizedHead.blockHash, "finalized head blockHash");
  if (
    transcript.deploymentAnchor.blockNumber !==
      bowCandidate.deployment.blockNumber ||
    requireHash(
      transcript.deploymentAnchor.blockHash,
      "deployment anchor blockHash"
    ) !== bowCandidate.deployment.blockHash
  ) {
    reject("deployment anchor does not match the pinned candidate");
  }

  if (transcript.parentCheckpoint.blockNumber !== fromBlock - 1n) {
    reject("parent checkpoint is not immediately before the range");
  }
  requireHash(transcript.parentCheckpoint.blockHash, "parent checkpoint hash");
  requireHash(
    transcript.parentCheckpoint.parentHash,
    "parent checkpoint parentHash"
  );

  if (BigInt(transcript.blocks.length) !== blockCount) {
    reject("canonical header coverage is incomplete");
  }
  let previous = transcript.parentCheckpoint;
  const blockByNumber = new Map<bigint, BowReplayBlockHeader>();
  for (let index = 0; index < transcript.blocks.length; index += 1) {
    const block = transcript.blocks[index]!;
    const expectedNumber = fromBlock + BigInt(index);
    if (block.blockNumber !== expectedNumber) {
      reject("canonical headers contain a gap, duplicate, or reordering");
    }
    const blockHash = requireHash(block.blockHash, "block hash");
    const parentHash = requireHash(block.parentHash, "block parentHash");
    if (parentHash !== previous.blockHash) {
      reject("canonical header parent linkage is broken");
    }
    if (
      block.blockNumber === bowCandidate.deployment.blockNumber &&
      blockHash !== bowCandidate.deployment.blockHash
    ) {
      reject("deployment block hash conflicts with the pinned candidate");
    }
    blockByNumber.set(block.blockNumber, block);
    previous = block;
  }

  if (
    transcript.finalizedHead.blockNumber === toBlock &&
    transcript.finalizedHead.blockHash !== previous.blockHash
  ) {
    reject("finalized head hash conflicts with the replay boundary");
  }

  if (transcript.logs.length > BOW_MAX_SHADOW_REPLAY_LOGS) {
    reject("launch-log count exceeds the replay safety bound");
  }
  const requiredRuntimeBlocks = new Set([
    fromBlock,
    toBlock,
    ...transcript.logs.map((log) => log.blockNumber)
  ]);
  if (transcript.factoryRuntimeChecks.length !== requiredRuntimeBlocks.size) {
    reject("factory runtime must be checked at both replay boundaries");
  }
  const checkedRuntimeBlocks = new Set<bigint>();
  for (const check of transcript.factoryRuntimeChecks) {
    if (!requiredRuntimeBlocks.has(check.blockNumber)) {
      reject("factory runtime was checked at an unexpected block");
    }
    if (checkedRuntimeBlocks.has(check.blockNumber)) {
      reject("factory runtime boundary check is duplicated");
    }
    checkedRuntimeBlocks.add(check.blockNumber);
    const runtimeHeader = blockByNumber.get(check.blockNumber);
    if (
      !runtimeHeader ||
      requireHash(check.blockHash, "factory runtime blockHash") !==
        runtimeHeader.blockHash
    ) {
      reject("factory runtime check is not tied to a canonical header");
    }
    requireLength(check.lengthBytes, "factory runtime length");
    if (
      check.lengthBytes !== bowCandidate.runtime.lengthBytes ||
      requireHash(check.reportedCodeHash, "factory runtime reportedCodeHash") !==
        bowCandidate.runtime.codeHash
    ) {
      reject("factory runtime does not match the pinned candidate");
    }
  }

  if (
    transcript.launchCountBefore.sampledAtBlock !== fromBlock - 1n ||
    transcript.launchCountAfter.sampledAtBlock !== toBlock ||
    requireHash(
      transcript.launchCountBefore.sampledAtBlockHash,
      "launchCount-before blockHash"
    ) !== transcript.parentCheckpoint.blockHash ||
    requireHash(
      transcript.launchCountAfter.sampledAtBlockHash,
      "launchCount-after blockHash"
    ) !== previous.blockHash
  ) {
    reject("launch counts were not sampled at exact canonical block tags");
  }
  if (
    transcript.launchCountBefore.value < 0n ||
    transcript.launchCountAfter.value < transcript.launchCountBefore.value
  ) {
    reject("launch counts are invalid or decreasing");
  }
  const launchDelta =
    transcript.launchCountAfter.value - transcript.launchCountBefore.value;
  if (launchDelta !== BigInt(transcript.logs.length)) {
    reject("launchCount delta does not equal the number of logs");
  }

  const observations: BowShadowObservation[] = [];
  const observationByLaunchId = new Map<bigint, BowShadowObservation>();
  const decodedByLaunchId = new Map<bigint, DecodedBowLaunch>();
  const seenLogs = new Set<string>();
  const seenTokens = new Set<string>();
  const seenPools = new Set<string>();
  const seenPositions = new Set<bigint>();
  let priorLog: BowReplayLog | undefined;
  for (let index = 0; index < transcript.logs.length; index += 1) {
    const log = transcript.logs[index]!;
    canonicalReplayLog(log);
    if (priorLog && compareChainPosition(priorLog, log) >= 0) {
      reject("launch logs are duplicated or not in canonical chain order");
    }
    priorLog = log;
    if (log.blockNumber < fromBlock || log.blockNumber > toBlock) {
      reject("launch log lies outside the replay range");
    }
    const header = blockByNumber.get(log.blockNumber);
    if (!header || header.blockHash !== log.blockHash) {
      reject("launch log block hash conflicts with canonical headers");
    }
    const identity = logIdentity(log);
    if (seenLogs.has(identity)) reject("duplicate launch log identity");
    seenLogs.add(identity);

    let decoded: DecodedBowLaunch;
    try {
      decoded = decodeBowLaunchedLog(log);
    } catch (error) {
      reject(
        `candidate decoder failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
    const expectedLaunchId =
      transcript.launchCountBefore.value + BigInt(index);
    if (decoded.launchId !== expectedLaunchId) {
      reject("launch IDs are not exactly contiguous with launchCount");
    }
    if (decodedByLaunchId.has(decoded.launchId)) {
      reject("duplicate launch ID");
    }
    if (seenTokens.has(decoded.token)) reject("duplicate launched token");
    if (seenPools.has(decoded.pool)) reject("duplicate launch pool");
    if (seenPositions.has(decoded.positionId)) {
      reject("duplicate launch position ID");
    }
    if (
      decoded.token === decoded.pool ||
      decoded.token === BOW_FACTORY ||
      decoded.pool === BOW_FACTORY
    ) {
      reject("factory, token, and pool addresses must be distinct");
    }
    decodedByLaunchId.set(decoded.launchId, decoded);
    seenTokens.add(decoded.token);
    seenPools.add(decoded.pool);
    seenPositions.add(decoded.positionId);
    const observation = Object.freeze({
      kind: "shadow-bow-launch-observation",
      sourceId: "bow",
      chainId: 4663,
      factory: BOW_FACTORY,
      ...decoded,
      transactionHash: requireHash(
        log.transactionHash,
        "observation transactionHash"
      ),
      transactionIndex: log.transactionIndex,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      blockHash: requireHash(log.blockHash, "observation blockHash")
    });
    observations.push(observation);
    observationByLaunchId.set(decoded.launchId, observation);
  }

  if (transcript.receipts.length > transcript.logs.length) {
    reject("receipt count exceeds launch-log coverage");
  }
  const receiptLogs = new Map<string, string>();
  const receiptTransactions = new Set<string>();
  for (const receipt of transcript.receipts) {
    const transactionHash = requireHash(
      receipt.transactionHash,
      "receipt transactionHash"
    );
    if (receiptTransactions.has(transactionHash)) {
      reject("duplicate receipt transaction");
    }
    receiptTransactions.add(transactionHash);
    if (receipt.status !== "success") reject("launch receipt was not successful");
    requireIndex(receipt.transactionIndex, "receipt transactionIndex");
    const header = blockByNumber.get(receipt.blockNumber);
    if (
      !header ||
      requireHash(receipt.blockHash, "receipt blockHash") !== header.blockHash
    ) {
      reject("receipt block does not match canonical headers");
    }
    let priorReceiptLog: BowReplayLog | undefined;
    for (const log of receipt.logs) {
      if (receiptLogs.size >= transcript.logs.length) {
        reject("receipt-log count exceeds range-log coverage");
      }
      if (log.transactionHash !== transactionHash) {
        reject("receipt contains a log from another transaction");
      }
      if (
        log.blockNumber !== receipt.blockNumber ||
        log.blockHash !== receipt.blockHash ||
        log.transactionIndex !== receipt.transactionIndex
      ) {
        reject("receipt metadata conflicts with its launch log");
      }
      if (priorReceiptLog && compareChainPosition(priorReceiptLog, log) >= 0) {
        reject("receipt launch logs are duplicated or reordered");
      }
      priorReceiptLog = log;
      const identity = logIdentity(log);
      if (receiptLogs.has(identity)) reject("duplicate receipt log identity");
      receiptLogs.set(identity, canonicalReplayLog(log));
    }
  }
  if (receiptLogs.size !== transcript.logs.length) {
    reject("receipt coverage does not match range-log coverage");
  }
  for (const log of transcript.logs) {
    if (receiptLogs.get(logIdentity(log)) !== canonicalReplayLog(log)) {
      reject("receipt launch log does not exactly match the range log");
    }
  }

  if (transcript.launchState.length !== observations.length) {
    reject("launch-state coverage is incomplete");
  }
  const launchStateIds = new Set<bigint>();
  for (const state of transcript.launchState) {
    if (launchStateIds.has(state.launchId)) reject("duplicate launch-state record");
    launchStateIds.add(state.launchId);
    const decoded = decodedByLaunchId.get(state.launchId);
    if (!decoded) reject("launch state has no matching event");
    const observation = observationByLaunchId.get(state.launchId)!;
    if (
      state.sampledAtBlock !== observation.blockNumber ||
      requireHash(
        state.sampledAtBlockHash,
        "launch-state sampledAtBlockHash"
      ) !== observation.blockHash
    ) {
      reject("launch state was not sampled at its exact event block");
    }
    if (
      requireAddress(state.token, "launch-state token") !== decoded.token ||
      requireAddress(state.deployer, "launch-state deployer") !==
        decoded.deployer ||
      requireAddress(state.pool, "launch-state pool") !== decoded.pool ||
      state.positionId !== decoded.positionId
    ) {
      reject("launch state conflicts with decoded event evidence");
    }
  }

  const expectedCodeAddresses = new Map<
    string,
    Readonly<{ blockNumber: bigint; blockHash: `0x${string}` }>
  >();
  for (const observation of observations) {
    expectedCodeAddresses.set(observation.token, {
      blockNumber: observation.blockNumber,
      blockHash: observation.blockHash
    });
    expectedCodeAddresses.set(observation.pool, {
      blockNumber: observation.blockNumber,
      blockHash: observation.blockHash
    });
  }
  if (transcript.contractCode.length !== expectedCodeAddresses.size) {
    reject("token/pool runtime coverage is incomplete");
  }
  const checkedCodeAddresses = new Set<string>();
  for (const check of transcript.contractCode) {
    const address = requireAddress(check.address, "contract-code address");
    const expectedBlock = expectedCodeAddresses.get(address);
    if (!expectedBlock) {
      reject("contract-code check covers an unexpected address");
    }
    if (checkedCodeAddresses.has(address)) {
      reject("contract-code check is duplicated");
    }
    checkedCodeAddresses.add(address);
    if (
      check.sampledAtBlock !== expectedBlock.blockNumber ||
      requireHash(
        check.sampledAtBlockHash,
        "contract-code sampledAtBlockHash"
      ) !== expectedBlock.blockHash
    ) {
      reject("contract code was not sampled at its exact event block");
    }
    requireLength(check.lengthBytes, "contract runtime length");
  }

  const checkpoint = Object.freeze({ ...transcript.blocks.at(-1)! });
  const immutableObservations = Object.freeze(observations);
  const transcriptHash = replayHash({
    schema: "rmt-bow-shadow-replay-v1",
    chainId: transcript.chainId,
    candidateId: bowCandidate.candidateId,
    deploymentAnchor: {
      blockNumber: transcript.deploymentAnchor.blockNumber.toString(),
      blockHash: transcript.deploymentAnchor.blockHash
    },
    range: {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString()
    },
    finalizedHead: {
      blockNumber: transcript.finalizedHead.blockNumber.toString(),
      blockHash: transcript.finalizedHead.blockHash
    },
    parentCheckpoint: {
      blockNumber: transcript.parentCheckpoint.blockNumber.toString(),
      blockHash: transcript.parentCheckpoint.blockHash,
      parentHash: transcript.parentCheckpoint.parentHash
    },
    blocks: transcript.blocks.map((block) => ({
      blockNumber: block.blockNumber.toString(),
      blockHash: block.blockHash,
      parentHash: block.parentHash
    })),
    launchCountBefore: {
      sampledAtBlock: transcript.launchCountBefore.sampledAtBlock.toString(),
      sampledAtBlockHash: transcript.launchCountBefore.sampledAtBlockHash,
      value: transcript.launchCountBefore.value.toString()
    },
    launchCountAfter: {
      sampledAtBlock: transcript.launchCountAfter.sampledAtBlock.toString(),
      sampledAtBlockHash: transcript.launchCountAfter.sampledAtBlockHash,
      value: transcript.launchCountAfter.value.toString()
    },
    factoryRuntimeChecks: [...transcript.factoryRuntimeChecks]
      .map((check) => ({
        blockNumber: check.blockNumber.toString(),
        blockHash: check.blockHash,
        lengthBytes: check.lengthBytes,
        reportedCodeHash: check.reportedCodeHash
      }))
      .sort((left, right) => left.blockNumber.localeCompare(right.blockNumber)),
    observations: observations.map((observation) => ({
      ...observation,
      positionId: observation.positionId.toString(),
      launchId: observation.launchId.toString(),
      blockNumber: observation.blockNumber.toString()
    })),
    contractCode: [...transcript.contractCode]
      .map((check) => ({
        address: check.address,
        sampledAtBlock: check.sampledAtBlock.toString(),
        sampledAtBlockHash: check.sampledAtBlockHash,
        lengthBytes: check.lengthBytes
      }))
      .sort((left, right) => left.address.localeCompare(right.address))
  });

  return Object.freeze({
    schema: "rmt-bow-shadow-replay-result-v1",
    kind: "shadow-bow-replay-result",
    candidateId: bowCandidate.candidateId,
    sourceVerification: "unverified",
    authoritative: false,
    activationEligible: false,
    independentProviderAgreement: false,
    finalizedAncestryProven: false,
    runtimeHashLocallyComputed: false,
    persistence: "none",
    adapterRegistered: false,
    range: Object.freeze({ fromBlock, toBlock }),
    previousCheckpoint: Object.freeze({ ...transcript.parentCheckpoint }),
    checkpoint,
    launchCountBefore: transcript.launchCountBefore.value,
    launchCountAfter: transcript.launchCountAfter.value,
    observations: immutableObservations,
    transcriptHash
  });
}
