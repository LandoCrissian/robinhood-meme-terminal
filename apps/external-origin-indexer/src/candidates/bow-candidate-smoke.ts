import assert from "node:assert/strict";
import { externalOriginAdapters } from "../adapter-registry.js";
import {
  BOW_FACTORY,
  BOW_LAUNCHED_TOPIC,
  bowCandidate,
  decodeBowLaunchedLog,
  type BowRawLaunchedLog
} from "./bow-candidate.js";

const firstLog: BowRawLaunchedLog = {
  address: BOW_FACTORY,
  topics: [
    BOW_LAUNCHED_TOPIC,
    "0x000000000000000000000000384f2d52ca2eced3f9ed3555b63601327115fb03",
    "0x0000000000000000000000000a5f25a3dd2d707abe9b43393f01fc80655a733f"
  ],
  data: "0x000000000000000000000000aa0d101b6fb82d81de481a97399d309e9afad07e00000000000000000000000000000000000000000000000000000000000264d2000000000000000000000000000000000000000000000000000000000000041d",
  blockNumber: 10_826_821n,
  blockHash:
    "0x01576e335820240787e76c89f335d288e021c71359ce02a6dc14bf8840a46173",
  transactionHash:
    "0x10f06c86dc34fe792f7cb251f6b28d4e9f72464a7980aff0492d201112bce36c",
  logIndex: 51
};

const secondLog: BowRawLaunchedLog = {
  address: BOW_FACTORY,
  topics: [
    BOW_LAUNCHED_TOPIC,
    "0x000000000000000000000000956526231231872760f4e9b47f97b52593e77b03",
    "0x000000000000000000000000188646a38ebca3011833bc52abacb58efa5e340e"
  ],
  data: "0x00000000000000000000000030215daa5629660505cf62cc9c3a952f51c995fc0000000000000000000000000000000000000000000000000000000000025a4c000000000000000000000000000000000000000000000000000000000000041c",
  blockNumber: 10_750_292n,
  blockHash:
    "0xf208f9b7efaa708f0d3d0986ba703f41c73d8446ebaf363ada15975f01efee50",
  transactionHash:
    "0x937a171422a36071321ca104d18a0e54c141440ad469ddb66d88656361cb7779",
  logIndex: 14
};

assert.equal(bowCandidate.activationEligible, false);
assert.equal(bowCandidate.sourceVerification, "unverified_at_review");
assert.equal(externalOriginAdapters.length, 0);

assert.deepEqual(decodeBowLaunchedLog(firstLog), {
  token: "0x384f2d52ca2eced3f9ed3555b63601327115fb03",
  creator: "0x0a5f25a3dd2d707abe9b43393f01fc80655a733f",
  pool: "0xaa0d101b6fb82d81de481a97399d309e9afad07e",
  positionId: 156_882n,
  launchId: 1_053n
});
assert.deepEqual(decodeBowLaunchedLog(secondLog), {
  token: "0x956526231231872760f4e9b47f97b52593e77b03",
  creator: "0x188646a38ebca3011833bc52abacb58efa5e340e",
  pool: "0x30215daa5629660505cf62cc9c3a952f51c995fc",
  positionId: 154_188n,
  launchId: 1_052n
});

const rejectedLogs: readonly BowRawLaunchedLog[] = [
  { ...firstLog, removed: true },
  { ...firstLog, blockNumber: bowCandidate.deployment.blockNumber - 1n },
  { ...firstLog, address: `0x${"1".repeat(40)}` },
  { ...firstLog, topics: [`0x${"2".repeat(64)}`, ...firstLog.topics.slice(1)] },
  { ...firstLog, topics: [...firstLog.topics, `0x${"3".repeat(64)}`] },
  {
    ...firstLog,
    topics: [
      firstLog.topics[0]!,
      `0x${"f".repeat(24)}${firstLog.topics[1]!.slice(-40)}`,
      firstLog.topics[2]!
    ]
  },
  { ...firstLog, data: firstLog.data.slice(0, -2) },
  { ...firstLog, blockHash: "0x1234" },
  { ...firstLog, blockHash: `0x${"0".repeat(64)}` },
  { ...firstLog, transactionHash: `0x${"4".repeat(63)}` },
  { ...firstLog, logIndex: -1 }
];
for (const log of rejectedLogs) {
  assert.throws(() => decodeBowLaunchedLog(log));
}

console.log("Bow candidate decoder smoke checks passed");
