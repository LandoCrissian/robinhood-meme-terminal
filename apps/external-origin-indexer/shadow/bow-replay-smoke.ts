import assert from "node:assert/strict";
import { externalOriginAdapters } from "../src/adapter-registry.js";
import { EXTERNAL_ORIGIN_ATTRIBUTION_ACTIVATION_LOCKED } from "../src/config.js";
import {
  BOW_FACTORY,
  BOW_LAUNCHED_TOPIC,
  bowCandidate
} from "../src/candidates/bow-candidate.js";
import { planInclusiveBlockRanges } from "./block-ranges.js";
import {
  BOW_MAX_SHADOW_REPLAY_BLOCKS,
  validateBowShadowReplay,
  type BowReplayLog,
  type BowReplayReceiptLog,
  type BowReplayTranscript
} from "./bow-replay.js";

const hash = (character: string) =>
  `0x${character.repeat(64)}` as `0x${string}`;
const address = (character: string) =>
  `0x${character.repeat(40)}` as `0x${string}`;
const addressWord = (value: `0x${string}`) =>
  `0x${"0".repeat(24)}${value.slice(2)}`;
const uintWord = (value: bigint) => value.toString(16).padStart(64, "0");
const launchData = (
  pool: `0x${string}`,
  positionId: bigint,
  launchId: bigint
) =>
  `0x${addressWord(pool).slice(2)}${uintWord(positionId)}${uintWord(launchId)}`;

assert.deepEqual(
  planInclusiveBlockRanges({ fromBlock: 10n, toBlock: 15n, maxBlocks: 2n }),
  [
    { fromBlock: 10n, toBlock: 11n },
    { fromBlock: 12n, toBlock: 13n },
    { fromBlock: 14n, toBlock: 15n }
  ]
);
assert.deepEqual(
  planInclusiveBlockRanges({ fromBlock: 10n, toBlock: 10n, maxBlocks: 5n }),
  [{ fromBlock: 10n, toBlock: 10n }]
);
for (const invalidPlan of [
  { fromBlock: -1n, toBlock: 1n, maxBlocks: 1n },
  { fromBlock: 2n, toBlock: 1n, maxBlocks: 1n },
  { fromBlock: 1n, toBlock: 2n, maxBlocks: 0n },
  { fromBlock: 1n, toBlock: 2n, maxBlocks: 2_001n },
  { fromBlock: 0n, toBlock: 20_000_000n, maxBlocks: 1n }
]) {
  assert.throws(() => planInclusiveBlockRanges(invalidPlan));
}

// Exact live Bow receipt fields are used for the first log. Transaction index,
// surrounding headers, state reads, code reads, and the second launch are
// explicitly synthetic framing for this offline validator test.
const liveToken = "0x956526231231872760f4e9b47f97b52593e77b03" as const;
const liveDeployer =
  "0x188646a38ebca3011833bc52abacb58efa5e340e" as const;
const livePool = "0x30215daa5629660505cf62cc9c3a952f51c995fc" as const;
const liveBlock = 10_750_292n;
const liveBlockHash =
  "0xf208f9b7efaa708f0d3d0986ba703f41c73d8446ebaf363ada15975f01efee50" as const;
const liveTransactionHash =
  "0x937a171422a36071321ca104d18a0e54c141440ad469ddb66d88656361cb7779" as const;

const firstLog: BowReplayLog = {
  address: BOW_FACTORY,
  topics: [
    BOW_LAUNCHED_TOPIC,
    addressWord(liveToken),
    addressWord(liveDeployer)
  ],
  data: launchData(livePool, 154_188n, 1_052n),
  blockNumber: liveBlock,
  blockHash: liveBlockHash,
  transactionHash: liveTransactionHash,
  transactionIndex: 8,
  logIndex: 14
};

const syntheticToken = address("1");
const syntheticDeployer = address("2");
const syntheticPool = address("3");
const secondLog: BowReplayLog = {
  address: BOW_FACTORY,
  topics: [
    BOW_LAUNCHED_TOPIC,
    addressWord(syntheticToken),
    addressWord(syntheticDeployer)
  ],
  data: launchData(syntheticPool, 154_189n, 1_053n),
  blockNumber: liveBlock,
  blockHash: liveBlockHash,
  transactionHash: hash("a"),
  transactionIndex: 9,
  logIndex: 15
};

function unrelatedReceiptLog(
  launchLog: BowReplayLog,
  logIndex: number
): BowReplayReceiptLog {
  return {
    ...launchLog,
    address: address("b"),
    topics: [hash("c")],
    data: "0x",
    logIndex
  };
}

const firstUnrelatedLog = unrelatedReceiptLog(firstLog, 13);
const secondUnrelatedLog = unrelatedReceiptLog(secondLog, 16);

const fromBlock = liveBlock - 1n;
const parentCheckpoint = {
  blockNumber: fromBlock - 1n,
  blockHash: hash("4"),
  parentHash: hash("5")
} as const;
const firstHeader = {
  blockNumber: fromBlock,
  blockHash: hash("6"),
  parentHash: parentCheckpoint.blockHash
} as const;
const finalHeader = {
  blockNumber: liveBlock,
  blockHash: liveBlockHash,
  parentHash: firstHeader.blockHash
} as const;

const transcript: BowReplayTranscript = {
  schema: "rmt-bow-shadow-replay-transcript-v1",
  candidateId: bowCandidate.candidateId,
  chainId: 4663,
  factory: BOW_FACTORY,
  range: { fromBlock, toBlock: liveBlock },
  reportedFinalizedHead: {
    blockNumber: liveBlock + 20n,
    blockHash: hash("9")
  },
  deploymentAnchor: {
    blockNumber: bowCandidate.deployment.blockNumber,
    blockHash: bowCandidate.deployment.blockHash
  },
  parentCheckpoint,
  blocks: [firstHeader, finalHeader],
  factoryRuntimeChecks: [
    {
      address: BOW_FACTORY,
      blockNumber: fromBlock,
      blockHash: firstHeader.blockHash,
      lengthBytes: bowCandidate.runtime.lengthBytes,
      reportedCodeHash: bowCandidate.runtime.codeHash
    },
    {
      address: BOW_FACTORY,
      blockNumber: liveBlock,
      blockHash: liveBlockHash,
      lengthBytes: bowCandidate.runtime.lengthBytes,
      reportedCodeHash: bowCandidate.runtime.codeHash
    }
  ],
  launchCountBefore: {
    kind: "state-read",
    target: BOW_FACTORY,
    call: "launchCount()",
    sampledAtBlock: fromBlock - 1n,
    sampledAtBlockHash: parentCheckpoint.blockHash,
    value: 1_052n
  },
  launchCountAfter: {
    kind: "state-read",
    target: BOW_FACTORY,
    call: "launchCount()",
    sampledAtBlock: liveBlock,
    sampledAtBlockHash: liveBlockHash,
    value: 1_054n
  },
  logs: [firstLog, secondLog],
  receipts: [
    {
      transactionHash: firstLog.transactionHash,
      status: "success",
      blockNumber: liveBlock,
      blockHash: liveBlockHash,
      transactionIndex: firstLog.transactionIndex,
      logs: [firstUnrelatedLog, firstLog]
    },
    {
      transactionHash: secondLog.transactionHash,
      status: "success",
      blockNumber: liveBlock,
      blockHash: liveBlockHash,
      transactionIndex: secondLog.transactionIndex,
      logs: [secondLog, secondUnrelatedLog]
    }
  ],
  launchState: [
    {
      target: BOW_FACTORY,
      call: "launches(uint256)",
      sampledAtBlock: liveBlock,
      sampledAtBlockHash: liveBlockHash,
      token: liveToken,
      deployer: liveDeployer,
      pool: livePool,
      positionId: 154_188n,
      launchId: 1_052n
    },
    {
      target: BOW_FACTORY,
      call: "launches(uint256)",
      sampledAtBlock: liveBlock,
      sampledAtBlockHash: liveBlockHash,
      token: syntheticToken,
      deployer: syntheticDeployer,
      pool: syntheticPool,
      positionId: 154_189n,
      launchId: 1_053n
    }
  ],
  contractCode: [
    {
      address: liveToken,
      sampledAtBlock: liveBlock,
      sampledAtBlockHash: liveBlockHash,
      lengthBytes: 100
    },
    {
      address: livePool,
      sampledAtBlock: liveBlock,
      sampledAtBlockHash: liveBlockHash,
      lengthBytes: 200
    },
    {
      address: syntheticToken,
      sampledAtBlock: liveBlock,
      sampledAtBlockHash: liveBlockHash,
      lengthBytes: 101
    },
    {
      address: syntheticPool,
      sampledAtBlock: liveBlock,
      sampledAtBlockHash: liveBlockHash,
      lengthBytes: 201
    }
  ]
};

assert.equal(EXTERNAL_ORIGIN_ATTRIBUTION_ACTIVATION_LOCKED, true);
assert.equal(externalOriginAdapters.length, 0);
const result = validateBowShadowReplay(transcript);
assert.equal(result.schema, "rmt-bow-shadow-replay-result-v1");
assert.equal(result.chainId, 4663);
assert.equal(result.factory, BOW_FACTORY);
assert.equal(result.authoritative, false);
assert.equal(result.sourceVerification, "unverified");
assert.equal(result.activationEligible, false);
assert.equal(result.independentProviderAgreement, false);
assert.equal(result.finalizedAncestryProven, false);
assert.equal(result.coverageFromDeploymentProven, false);
assert.equal(result.counterSemanticsLiveProven, false);
assert.equal(result.runtimeHashLocallyComputed, false);
assert.equal(result.stateReadsLocallyDecoded, false);
assert.equal(result.persistence, "none");
assert.equal(result.adapterRegistered, false);
assert.equal(result.observations.length, 2);
assert.equal(result.observations[0]?.deployer, liveDeployer);
assert.equal("creator" in result.observations[0]!, false);
assert.equal("claimKind" in result.observations[0]!, false);
assert.equal(result.checkpoint.blockHash, liveBlockHash);
assert.equal(result.previousCheckpoint.blockHash, parentCheckpoint.blockHash);
assert.equal(result.launchCountBefore, 1_052n);
assert.equal(result.launchCountAfter, 1_054n);
assert.equal(Object.isFrozen(result), true);
assert.equal(Object.isFrozen(result.reportedFinalizedHead), true);
assert.equal(Object.isFrozen(result.observations), true);
assert.equal(Object.isFrozen(result.observations[0]), true);
for (const forbidden of [
  "adapterId",
  "manifestHash",
  "evidenceHash",
  "claimKind",
  "creator"
]) {
  assert.equal(forbidden in result, false);
  assert.equal(forbidden in result.observations[0]!, false);
}
function assertNoForbiddenKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(
      ["adapterId", "manifestHash", "evidenceHash", "claimKind", "creator"].includes(
        key
      ),
      false,
      key
    );
    assertNoForbiddenKeys(child);
  }
}
assertNoForbiddenKeys(result);
assert.equal(
  validateBowShadowReplay(transcript).resultHash,
  result.resultHash
);
assert.equal(
  validateBowShadowReplay({
    ...transcript,
    factoryRuntimeChecks: [...transcript.factoryRuntimeChecks].reverse(),
    receipts: [...transcript.receipts].reverse(),
    launchState: [...transcript.launchState].reverse(),
    contractCode: [...transcript.contractCode].reverse()
  }).resultHash,
  result.resultHash
);

const emptyResult = validateBowShadowReplay({
  ...transcript,
  reportedFinalizedHead: { blockNumber: liveBlock, blockHash: liveBlockHash },
  launchCountBefore: {
    ...transcript.launchCountBefore,
    value: 1_052n
  },
  launchCountAfter: {
    ...transcript.launchCountAfter,
    value: 1_052n
  },
  logs: [],
  receipts: [],
  launchState: [],
  contractCode: []
});
assert.equal(emptyResult.observations.length, 0);

const sameTransactionSecondLog: BowReplayLog = {
  ...secondLog,
  transactionHash: firstLog.transactionHash,
  transactionIndex: firstLog.transactionIndex
};
const sameTransactionResult = validateBowShadowReplay({
  ...transcript,
  logs: [firstLog, sameTransactionSecondLog],
  receipts: [
    {
      transactionHash: firstLog.transactionHash,
      status: "success",
      blockNumber: liveBlock,
      blockHash: liveBlockHash,
      transactionIndex: firstLog.transactionIndex,
      logs: [firstUnrelatedLog, firstLog, sameTransactionSecondLog]
    }
  ]
});
assert.equal(sameTransactionResult.observations.length, 2);

const deploymentParent = {
  blockNumber: bowCandidate.deployment.blockNumber - 1n,
  blockHash: hash("d"),
  parentHash: hash("e")
} as const;
const deploymentHeader = {
  blockNumber: bowCandidate.deployment.blockNumber,
  blockHash: bowCandidate.deployment.blockHash,
  parentHash: deploymentParent.blockHash
} as const;
const deploymentTranscript: BowReplayTranscript = {
  schema: "rmt-bow-shadow-replay-transcript-v1",
  candidateId: bowCandidate.candidateId,
  chainId: 4663,
  factory: BOW_FACTORY,
  range: {
    fromBlock: bowCandidate.deployment.blockNumber,
    toBlock: bowCandidate.deployment.blockNumber
  },
  reportedFinalizedHead: {
    blockNumber: bowCandidate.deployment.blockNumber,
    blockHash: bowCandidate.deployment.blockHash
  },
  deploymentAnchor: {
    blockNumber: bowCandidate.deployment.blockNumber,
    blockHash: bowCandidate.deployment.blockHash
  },
  parentCheckpoint: deploymentParent,
  blocks: [deploymentHeader],
  factoryRuntimeChecks: [
    {
      address: BOW_FACTORY,
      blockNumber: bowCandidate.deployment.blockNumber,
      blockHash: bowCandidate.deployment.blockHash,
      lengthBytes: bowCandidate.runtime.lengthBytes,
      reportedCodeHash: bowCandidate.runtime.codeHash
    }
  ],
  launchCountBefore: {
    kind: "predeployment-zero-assumption",
    target: BOW_FACTORY,
    call: "launchCount()",
    sampledAtBlock: bowCandidate.deployment.blockNumber - 1n,
    sampledAtBlockHash: deploymentParent.blockHash,
    value: 0n
  },
  launchCountAfter: {
    kind: "state-read",
    target: BOW_FACTORY,
    call: "launchCount()",
    sampledAtBlock: bowCandidate.deployment.blockNumber,
    sampledAtBlockHash: bowCandidate.deployment.blockHash,
    value: 0n
  },
  logs: [],
  receipts: [],
  launchState: [],
  contractCode: []
};
assert.equal(
  validateBowShadowReplay(deploymentTranscript).observations.length,
  0
);

type TranscriptMutation = Readonly<{
  name: string;
  value: BowReplayTranscript;
}>;
const mutations: readonly TranscriptMutation[] = [
  {
    name: "wrong schema",
    value: {
      ...transcript,
      schema: "wrong" as BowReplayTranscript["schema"]
    }
  },
  {
    name: "wrong candidate",
    value: {
      ...transcript,
      candidateId: "wrong" as BowReplayTranscript["candidateId"]
    }
  },
  {
    name: "wrong chain",
    value: { ...transcript, chainId: 1 as 4663 }
  },
  {
    name: "wrong factory",
    value: {
      ...transcript,
      factory: address("7") as typeof BOW_FACTORY
    }
  },
  {
    name: "pre-deployment range",
    value: {
      ...transcript,
      range: {
        fromBlock: bowCandidate.deployment.blockNumber - 1n,
        toBlock: liveBlock
      }
    }
  },
  {
    name: "oversized range",
    value: {
      ...transcript,
      range: {
        fromBlock,
        toBlock: fromBlock + BOW_MAX_SHADOW_REPLAY_BLOCKS
      }
    }
  },
  {
    name: "unfinalized range",
    value: {
      ...transcript,
      reportedFinalizedHead: {
        blockNumber: liveBlock - 1n,
        blockHash: hash("9")
      }
    }
  },
  {
    name: "finalized boundary hash mismatch",
    value: {
      ...transcript,
      reportedFinalizedHead: { blockNumber: liveBlock, blockHash: hash("9") }
    }
  },
  {
    name: "wrong deployment anchor",
    value: {
      ...transcript,
      deploymentAnchor: {
        ...transcript.deploymentAnchor,
        blockHash: hash("7")
      }
    }
  },
  {
    name: "missing header",
    value: { ...transcript, blocks: [finalHeader] }
  },
  {
    name: "forked parent",
    value: {
      ...transcript,
      blocks: [{ ...firstHeader, parentHash: hash("7") }, finalHeader]
    }
  },
  {
    name: "repeated self-parent block hash",
    value: {
      ...transcript,
      blocks: [
        firstHeader,
        {
          ...finalHeader,
          blockHash: firstHeader.blockHash,
          parentHash: firstHeader.blockHash
        }
      ]
    }
  },
  {
    name: "self-parent checkpoint",
    value: {
      ...transcript,
      parentCheckpoint: {
        ...parentCheckpoint,
        parentHash: parentCheckpoint.blockHash
      }
    }
  },
  {
    name: "wrong runtime hash",
    value: {
      ...transcript,
      factoryRuntimeChecks: [
        {
          ...transcript.factoryRuntimeChecks[0]!,
          reportedCodeHash: hash("7")
        },
        transcript.factoryRuntimeChecks[1]!
      ]
    }
  },
  {
    name: "wrong runtime target",
    value: {
      ...transcript,
      factoryRuntimeChecks: [
        {
          ...transcript.factoryRuntimeChecks[0]!,
          address: address("7") as typeof BOW_FACTORY
        },
        transcript.factoryRuntimeChecks[1]!
      ]
    }
  },
  {
    name: "missing runtime boundary",
    value: {
      ...transcript,
      factoryRuntimeChecks: [transcript.factoryRuntimeChecks[0]!]
    }
  },
  {
    name: "runtime block hash mismatch",
    value: {
      ...transcript,
      factoryRuntimeChecks: [
        { ...transcript.factoryRuntimeChecks[0]!, blockHash: hash("7") },
        transcript.factoryRuntimeChecks[1]!
      ]
    }
  },
  {
    name: "count mismatch",
    value: {
      ...transcript,
      launchCountAfter: {
        ...transcript.launchCountAfter,
        value: 1_055n
      }
    }
  },
  {
    name: "count block hash mismatch",
    value: {
      ...transcript,
      launchCountAfter: {
        ...transcript.launchCountAfter,
        sampledAtBlockHash: hash("7")
      }
    }
  },
  {
    name: "count call target mismatch",
    value: {
      ...transcript,
      launchCountBefore: {
        ...transcript.launchCountBefore,
        target: address("7") as typeof BOW_FACTORY
      }
    }
  },
  {
    name: "count exceeds uint256",
    value: {
      ...transcript,
      launchCountAfter: {
        ...transcript.launchCountAfter,
        value: 1n << 256n
      }
    }
  },
  {
    name: "deployment count is not explicit zero",
    value: {
      ...deploymentTranscript,
      launchCountBefore: {
        ...deploymentTranscript.launchCountBefore,
        value: 1n
      }
    }
  },
  {
    name: "reordered logs",
    value: { ...transcript, logs: [secondLog, firstLog] }
  },
  {
    name: "duplicate logs",
    value: { ...transcript, logs: [firstLog, firstLog] }
  },
  {
    name: "global log index regression",
    value: {
      ...transcript,
      logs: [firstLog, { ...secondLog, logIndex: 13 }]
    }
  },
  {
    name: "duplicate global log index",
    value: {
      ...transcript,
      logs: [firstLog, { ...secondLog, logIndex: firstLog.logIndex }]
    }
  },
  {
    name: "conflicting transaction position",
    value: {
      ...transcript,
      logs: [
        firstLog,
        { ...secondLog, transactionIndex: firstLog.transactionIndex }
      ]
    }
  },
  {
    name: "removed log",
    value: {
      ...transcript,
      logs: [{ ...firstLog, removed: true }, secondLog]
    }
  },
  {
    name: "log block hash mismatch",
    value: {
      ...transcript,
      logs: [{ ...firstLog, blockHash: hash("7") }, secondLog]
    }
  },
  {
    name: "launch ID gap",
    value: {
      ...transcript,
      logs: [
        firstLog,
        { ...secondLog, data: launchData(syntheticPool, 154_189n, 1_054n) }
      ]
    }
  },
  {
    name: "duplicate token",
    value: {
      ...transcript,
      logs: [
        firstLog,
        {
          ...secondLog,
          topics: [
            secondLog.topics[0]!,
            firstLog.topics[1]!,
            secondLog.topics[2]!
          ]
        }
      ]
    }
  },
  {
    name: "duplicate pool",
    value: {
      ...transcript,
      logs: [
        firstLog,
        {
          ...secondLog,
          data: launchData(livePool, 154_189n, 1_053n)
        }
      ]
    }
  },
  {
    name: "cross-role token and prior pool collision",
    value: {
      ...transcript,
      logs: [
        firstLog,
        {
          ...secondLog,
          topics: [
            secondLog.topics[0]!,
            addressWord(livePool),
            secondLog.topics[2]!
          ]
        }
      ]
    }
  },
  {
    name: "duplicate position",
    value: {
      ...transcript,
      logs: [
        firstLog,
        {
          ...secondLog,
          data: launchData(syntheticPool, 154_188n, 1_053n)
        }
      ]
    }
  },
  {
    name: "missing receipt",
    value: { ...transcript, receipts: [transcript.receipts[0]!] }
  },
  {
    name: "failed receipt",
    value: {
      ...transcript,
      receipts: [
        { ...transcript.receipts[0]!, status: "reverted" },
        transcript.receipts[1]!
      ]
    }
  },
  {
    name: "receipt block mismatch",
    value: {
      ...transcript,
      receipts: [
        { ...transcript.receipts[0]!, blockHash: hash("7") },
        transcript.receipts[1]!
      ]
    }
  },
  {
    name: "receipt log mismatch",
    value: {
      ...transcript,
      receipts: [
        {
          ...transcript.receipts[0]!,
          logs: [{ ...firstLog, data: launchData(livePool, 1n, 1_052n) }]
        },
        transcript.receipts[1]!
      ]
    }
  },
  {
    name: "receipt has no Bow launch",
    value: {
      ...transcript,
      receipts: [
        { ...transcript.receipts[0]!, logs: [firstUnrelatedLog] },
        transcript.receipts[1]!
      ]
    }
  },
  {
    name: "receipt contains an omitted Bow launch",
    value: {
      ...transcript,
      receipts: [
        {
          ...transcript.receipts[0]!,
          logs: [
            firstUnrelatedLog,
            firstLog,
            {
              ...firstLog,
              data: launchData(livePool, 999n, 1_054n),
              logIndex: 17
            }
          ]
        },
        transcript.receipts[1]!
      ]
    }
  },
  {
    name: "duplicate raw receipt log coordinate across transactions",
    value: {
      ...transcript,
      receipts: [
        transcript.receipts[0]!,
        {
          ...transcript.receipts[1]!,
          logs: [
            { ...secondUnrelatedLog, logIndex: firstUnrelatedLog.logIndex },
            secondLog
          ]
        }
      ]
    }
  },
  {
    name: "raw receipt log index regresses across transactions",
    value: {
      ...transcript,
      receipts: [
        transcript.receipts[0]!,
        {
          ...transcript.receipts[1]!,
          logs: [{ ...secondUnrelatedLog, logIndex: 12 }, secondLog]
        }
      ]
    }
  },
  {
    name: "missing launch state",
    value: { ...transcript, launchState: [transcript.launchState[0]!] }
  },
  {
    name: "launch-state deployer mismatch",
    value: {
      ...transcript,
      launchState: [
        { ...transcript.launchState[0]!, deployer: address("8") },
        transcript.launchState[1]!
      ]
    }
  },
  {
    name: "launch-state call target mismatch",
    value: {
      ...transcript,
      launchState: [
        {
          ...transcript.launchState[0]!,
          target: address("7") as typeof BOW_FACTORY
        },
        transcript.launchState[1]!
      ]
    }
  },
  {
    name: "launch-state block hash mismatch",
    value: {
      ...transcript,
      launchState: [
        {
          ...transcript.launchState[0]!,
          sampledAtBlockHash: hash("7")
        },
        transcript.launchState[1]!
      ]
    }
  },
  {
    name: "missing token code",
    value: { ...transcript, contractCode: transcript.contractCode.slice(1) }
  },
  {
    name: "empty pool code",
    value: {
      ...transcript,
      contractCode: [
        { ...transcript.contractCode[0]!, lengthBytes: 0 },
        ...transcript.contractCode.slice(1)
      ]
    }
  },
  {
    name: "token-code block hash mismatch",
    value: {
      ...transcript,
      contractCode: [
        { ...transcript.contractCode[0]!, sampledAtBlockHash: hash("7") },
        ...transcript.contractCode.slice(1)
      ]
    }
  }
];

for (const mutation of mutations) {
  assert.throws(
    () => validateBowShadowReplay(mutation.value),
    /Bow shadow replay rejected:/,
    mutation.name
  );
}

console.info(
  `Bow shadow replay passed ${mutations.length} adversarial rejection checks`
);
