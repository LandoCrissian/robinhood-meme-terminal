import { createHash } from "node:crypto";
import {
  BOW_FACTORY,
  bowCandidate,
  decodeBowLaunchedLog,
  type DecodedBowLaunch
} from "../src/candidates/bow-candidate.js";

export const BOW_MAX_SHADOW_REPLAY_BLOCKS = 2_000n;
export const BOW_MAX_SHADOW_REPLAY_LOGS = 10_000;
export const BOW_MAX_SHADOW_RECEIPT_LOGS = 50_000;

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const DATA_PATTERN = /^0x[0-9a-f]*$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const MAX_UINT256 = (1n << 256n) - 1n;

export type BowReplayBlockHeader = Readonly<{
  blockNumber: bigint;
  blockHash: `0x${string}`;
  parentHash: `0x${string}`;
}>;

export type BowReplayReceiptLog = Readonly<{
  address: `0x${string}`;
  topics: readonly string[];
  data: string;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
  removed?: boolean;
}>;

export type BowReplayLog = BowReplayReceiptLog;

export type BowReplayReceipt = Readonly<{
  transactionHash: `0x${string}`;
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionIndex: number;
  logs: readonly BowReplayReceiptLog[];
}>;

export type BowReplayLaunchState = DecodedBowLaunch &
  Readonly<{
    target: typeof BOW_FACTORY;
    call: "launches(uint256)";
    sampledAtBlock: bigint;
    sampledAtBlockHash: `0x${string}`;
  }>;

export type BowReplayLaunchCountRead = Readonly<{
  kind: "state-read" | "predeployment-zero-assumption";
  target: typeof BOW_FACTORY;
  call: "launchCount()";
  sampledAtBlock: bigint;
  sampledAtBlockHash: `0x${string}`;
  value: bigint;
}>;

export type BowReplayTranscript = Readonly<{
  schema: "rmt-bow-shadow-replay-transcript-v1";
  candidateId: typeof bowCandidate.candidateId;
  chainId: 4663;
  factory: typeof BOW_FACTORY;
  range: Readonly<{ fromBlock: bigint; toBlock: bigint }>;
  reportedFinalizedHead: Readonly<{
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
    address: typeof BOW_FACTORY;
    blockNumber: bigint;
    blockHash: `0x${string}`;
    lengthBytes: number;
    reportedCodeHash: `0x${string}`;
  }>[];
  launchCountBefore: BowReplayLaunchCountRead;
  launchCountAfter: BowReplayLaunchCountRead;
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
  chainId: 4663;
  factory: typeof BOW_FACTORY;
  candidateId: typeof bowCandidate.candidateId;
  sourceVerification: "unverified";
  authoritative: false;
  activationEligible: false;
  independentProviderAgreement: false;
  finalizedAncestryProven: false;
  coverageFromDeploymentProven: false;
  counterSemanticsLiveProven: false;
  runtimeHashLocallyComputed: false;
  stateReadsLocallyDecoded: false;
  persistence: "none";
  adapterRegistered: false;
  range: Readonly<{ fromBlock: bigint; toBlock: bigint }>;
  reportedFinalizedHead: Readonly<{
    blockNumber: bigint;
    blockHash: `0x${string}`;
  }>;
  previousCheckpoint: BowReplayBlockHeader;
  checkpoint: BowReplayBlockHeader;
  launchCountBefore: bigint;
  launchCountAfter: bigint;
  observations: readonly BowShadowObservation[];
  resultHash: `0x${string}`;
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

function requireWord(value: string, name: string): `0x${string}` {
  if (!HASH_PATTERN.test(value)) {
    return reject(`${name} must be a lowercase 32-byte word`);
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

function canonicalReceiptLog(log: BowReplayReceiptLog) {
  requireAddress(log.address, "log emitter");
  requireHash(log.blockHash, "log blockHash");
  requireHash(log.transactionHash, "log transactionHash");
  requireIndex(log.transactionIndex, "log transactionIndex");
  requireIndex(log.logIndex, "log logIndex");
  if (log.removed) reject("removed logs are not canonical");
  if (log.blockNumber < 0n) reject("log blockNumber must be nonnegative");
  if (log.topics.length > 4) reject("receipt logs may have at most four topics");
  for (const [index, topic] of log.topics.entries()) {
    requireWord(topic, `log topic ${index}`);
  }
  if (!DATA_PATTERN.test(log.data) || log.data.length % 2 !== 0) {
    reject("receipt log data must be canonical lowercase hex bytes");
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

function canonicalReplayLog(log: BowReplayLog) {
  canonicalReceiptLog(log);
  if (log.topics.length !== 3) reject("launch logs must have three topics");
  for (const [index, topic] of log.topics.entries()) {
    requireHash(topic, `launch log topic ${index}`);
  }
  if (log.data.length !== 194) {
    reject("launch log data must be exactly three ABI words");
  }
  return canonicalReceiptLog(log);
}

function isBowLaunchedReceiptLog(log: BowReplayReceiptLog) {
  return log.address === BOW_FACTORY && log.topics[0] === bowCandidate.creationEvent.topic0;
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
  if (transcript.schema !== "rmt-bow-shadow-replay-transcript-v1") {
    reject("wrong transcript schema");
  }
  if (transcript.candidateId !== bowCandidate.candidateId) {
    reject("wrong candidate ID");
  }
  if (transcript.chainId !== bowCandidate.chainId) {
    reject("wrong chain ID");
  }
  if (transcript.factory !== BOW_FACTORY) reject("wrong factory address");
  const { fromBlock, toBlock } = transcript.range;
  if (fromBlock < bowCandidate.deployment.blockNumber) {
    reject("range begins before the pinned factory deployment");
  }
  if (toBlock < fromBlock) reject("range end precedes its start");
  const blockCount = toBlock - fromBlock + 1n;
  if (blockCount > BOW_MAX_SHADOW_REPLAY_BLOCKS) {
    reject("range exceeds the bounded replay window");
  }
  if (transcript.reportedFinalizedHead.blockNumber < toBlock) {
    reject("range extends beyond the supplied finalized head");
  }
  requireHash(
    transcript.reportedFinalizedHead.blockHash,
    "reported finalized head blockHash"
  );
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
    transcript.reportedFinalizedHead.blockNumber === toBlock &&
    transcript.reportedFinalizedHead.blockHash !== previous.blockHash
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
    if (check.address !== BOW_FACTORY) {
      reject("factory runtime check targets the wrong address");
    }
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

  for (const [name, count] of [
    ["launchCount-before", transcript.launchCountBefore],
    ["launchCount-after", transcript.launchCountAfter]
  ] as const) {
    if (count.target !== BOW_FACTORY || count.call !== "launchCount()") {
      reject(`${name} has the wrong call identity`);
    }
    if (count.value < 0n || count.value > MAX_UINT256) {
      reject(`${name} is outside uint256`);
    }
  }
  if (
    fromBlock === bowCandidate.deployment.blockNumber &&
    (transcript.launchCountBefore.kind !==
      "predeployment-zero-assumption" ||
      transcript.launchCountBefore.value !== 0n)
  ) {
    reject("deployment window requires an explicit zero-count assumption");
  }
  if (
    fromBlock > bowCandidate.deployment.blockNumber &&
    transcript.launchCountBefore.kind !== "state-read"
  ) {
    reject("continuation window requires a prior state-read count");
  }
  if (transcript.launchCountAfter.kind !== "state-read") {
    reject("ending launchCount must be a state read");
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
  const seenLogCoordinates = new Set<string>();
  const seenContractAddresses = new Set<string>();
  const seenPositions = new Set<bigint>();
  const transactionByPosition = new Map<string, string>();
  const expectedReceiptByTransaction = new Map<
    string,
    Readonly<{
      blockNumber: bigint;
      blockHash: `0x${string}`;
      transactionIndex: number;
    }>
  >();
  let priorLog: BowReplayLog | undefined;
  for (let index = 0; index < transcript.logs.length; index += 1) {
    const log = transcript.logs[index]!;
    canonicalReplayLog(log);
    if (priorLog && compareChainPosition(priorLog, log) >= 0) {
      reject("launch logs are duplicated or not in canonical chain order");
    }
    if (
      priorLog?.blockNumber === log.blockNumber &&
      priorLog.logIndex >= log.logIndex
    ) {
      reject("launch logIndex is not globally increasing within its block");
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
    const logCoordinate = `${log.blockNumber}:${log.logIndex}`;
    if (seenLogCoordinates.has(logCoordinate)) {
      reject("duplicate global launch-log coordinate");
    }
    seenLogCoordinates.add(logCoordinate);
    const transactionPosition = `${log.blockNumber}:${log.transactionIndex}`;
    const positionedTransaction = transactionByPosition.get(transactionPosition);
    if (
      positionedTransaction !== undefined &&
      positionedTransaction !== log.transactionHash
    ) {
      reject("multiple transactions claim the same block position");
    }
    transactionByPosition.set(transactionPosition, log.transactionHash);
    const expectedReceipt = expectedReceiptByTransaction.get(
      log.transactionHash
    );
    if (
      expectedReceipt &&
      (expectedReceipt.blockNumber !== log.blockNumber ||
        expectedReceipt.blockHash !== log.blockHash ||
        expectedReceipt.transactionIndex !== log.transactionIndex)
    ) {
      reject("one transaction hash has conflicting chain coordinates");
    }
    expectedReceiptByTransaction.set(log.transactionHash, {
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionIndex: log.transactionIndex
    });

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
    if (
      seenContractAddresses.has(decoded.token) ||
      seenContractAddresses.has(decoded.pool)
    ) {
      reject("token/pool address is duplicated or reused across roles");
    }
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
    seenContractAddresses.add(decoded.token);
    seenContractAddresses.add(decoded.pool);
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

  if (transcript.receipts.length !== expectedReceiptByTransaction.size) {
    reject("receipt transaction coverage does not match launch logs");
  }
  const receiptLogs = new Map<string, string>();
  const receiptTransactions = new Set<string>();
  let totalReceiptLogs = 0;
  for (const receipt of transcript.receipts) {
    const transactionHash = requireHash(
      receipt.transactionHash,
      "receipt transactionHash"
    );
    if (receiptTransactions.has(transactionHash)) {
      reject("duplicate receipt transaction");
    }
    receiptTransactions.add(transactionHash);
    const expectedReceipt = expectedReceiptByTransaction.get(transactionHash);
    if (!expectedReceipt) reject("receipt transaction has no range launch log");
    if (receipt.status !== "success") reject("launch receipt was not successful");
    requireIndex(receipt.transactionIndex, "receipt transactionIndex");
    const header = blockByNumber.get(receipt.blockNumber);
    if (
      !header ||
      requireHash(receipt.blockHash, "receipt blockHash") !== header.blockHash
    ) {
      reject("receipt block does not match canonical headers");
    }
    if (
      expectedReceipt.blockNumber !== receipt.blockNumber ||
      expectedReceipt.blockHash !== receipt.blockHash ||
      expectedReceipt.transactionIndex !== receipt.transactionIndex
    ) {
      reject("receipt transaction coordinates conflict with range logs");
    }
    totalReceiptLogs += receipt.logs.length;
    if (totalReceiptLogs > BOW_MAX_SHADOW_RECEIPT_LOGS) {
      reject("receipt-log count exceeds the replay safety bound");
    }
    let priorReceiptLog: BowReplayReceiptLog | undefined;
    let launchedLogsInReceipt = 0;
    for (const log of receipt.logs) {
      canonicalReceiptLog(log);
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
      if (priorReceiptLog && priorReceiptLog.logIndex >= log.logIndex) {
        reject("full receipt logs are duplicated or reordered");
      }
      priorReceiptLog = log;
      if (!isBowLaunchedReceiptLog(log)) continue;
      launchedLogsInReceipt += 1;
      const identity = logIdentity(log);
      if (receiptLogs.has(identity)) reject("duplicate receipt log identity");
      receiptLogs.set(identity, canonicalReplayLog(log));
    }
    if (launchedLogsInReceipt < 1) {
      reject("receipt omits its expected Bow launch log");
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
    if (state.target !== BOW_FACTORY || state.call !== "launches(uint256)") {
      reject("launch-state observation has the wrong call identity");
    }
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
  const resultHash = replayHash({
    schema: "rmt-bow-shadow-replay-normalized-v1",
    chainId: transcript.chainId,
    candidateId: bowCandidate.candidateId,
    factory: BOW_FACTORY,
    deploymentAnchor: {
      blockNumber: transcript.deploymentAnchor.blockNumber.toString(),
      blockHash: transcript.deploymentAnchor.blockHash
    },
    range: {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString()
    },
    reportedFinalizedHead: {
      blockNumber: transcript.reportedFinalizedHead.blockNumber.toString(),
      blockHash: transcript.reportedFinalizedHead.blockHash
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
      kind: transcript.launchCountBefore.kind,
      target: transcript.launchCountBefore.target,
      call: transcript.launchCountBefore.call,
      sampledAtBlock: transcript.launchCountBefore.sampledAtBlock.toString(),
      sampledAtBlockHash: transcript.launchCountBefore.sampledAtBlockHash,
      value: transcript.launchCountBefore.value.toString()
    },
    launchCountAfter: {
      kind: transcript.launchCountAfter.kind,
      target: transcript.launchCountAfter.target,
      call: transcript.launchCountAfter.call,
      sampledAtBlock: transcript.launchCountAfter.sampledAtBlock.toString(),
      sampledAtBlockHash: transcript.launchCountAfter.sampledAtBlockHash,
      value: transcript.launchCountAfter.value.toString()
    },
    factoryRuntimeChecks: [...transcript.factoryRuntimeChecks]
      .map((check) => ({
        address: check.address,
        blockNumber: check.blockNumber.toString(),
        blockHash: check.blockHash,
        lengthBytes: check.lengthBytes,
        reportedCodeHash: check.reportedCodeHash
      }))
      .sort((left, right) => left.blockNumber.localeCompare(right.blockNumber)),
    logs: transcript.logs.map((log) => JSON.parse(canonicalReplayLog(log))),
    receipts: [...transcript.receipts]
      .map((receipt) => ({
        transactionHash: receipt.transactionHash,
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        transactionIndex: receipt.transactionIndex,
        logs: receipt.logs.map((log) =>
          JSON.parse(canonicalReceiptLog(log))
        )
      }))
      .sort((left, right) =>
        left.transactionHash.localeCompare(right.transactionHash)
      ),
    launchState: [...transcript.launchState]
      .map((state) => ({
        target: state.target,
        call: state.call,
        sampledAtBlock: state.sampledAtBlock.toString(),
        sampledAtBlockHash: state.sampledAtBlockHash,
        token: state.token,
        deployer: state.deployer,
        pool: state.pool,
        positionId: state.positionId.toString(),
        launchId: state.launchId.toString()
      }))
      .sort((left, right) => left.launchId.localeCompare(right.launchId)),
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
    chainId: 4663,
    factory: BOW_FACTORY,
    candidateId: bowCandidate.candidateId,
    sourceVerification: "unverified",
    authoritative: false,
    activationEligible: false,
    independentProviderAgreement: false,
    finalizedAncestryProven: false,
    coverageFromDeploymentProven: false,
    counterSemanticsLiveProven: false,
    runtimeHashLocallyComputed: false,
    stateReadsLocallyDecoded: false,
    persistence: "none",
    adapterRegistered: false,
    range: Object.freeze({ fromBlock, toBlock }),
    reportedFinalizedHead: Object.freeze({
      ...transcript.reportedFinalizedHead
    }),
    previousCheckpoint: Object.freeze({ ...transcript.parentCheckpoint }),
    checkpoint,
    launchCountBefore: transcript.launchCountBefore.value,
    launchCountAfter: transcript.launchCountAfter.value,
    observations: immutableObservations,
    resultHash
  });
}
