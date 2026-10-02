import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import {
  decodeLaunchEvent,
  boundedProgress,
  applyLaunchEvent,
  type LaunchLog,
} from "./launch-domain.js";
import { replayLaunchHistory } from "./launch-store.js";
import { launchSourceManifest } from "./launch-sources.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/launch-authority-evidence.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(fixture.chainId, 4663);
for (const source of fixture.sources)
  assert.equal(
    keccak256(source.code),
    launchSourceManifest.sources.find((s) => s.id === source.id)!.runtimeHash,
  );
assert.equal(
  keccak256(fixture.lens.code),
  launchSourceManifest.lens.runtimeHash,
);
const events = fixture.rows.map((row: any) => {
  const source = launchSourceManifest.sources.find(
    (s) => s.id === row.sourceId,
  )!;
  const log: LaunchLog = {
    ...row.log,
    blockNumber: BigInt(row.log.blockNumber),
    logIndex: Number(BigInt(row.log.logIndex)),
  };
  const event = decodeLaunchEvent(source, log, row.timestamp);
  assert.equal(event.creation?.token, row.token);
  assert.equal(event.creation?.launchBlock, String(log.blockNumber));
  assert.equal(event.creation?.launchTransaction, log.transactionHash);
  assert.equal(event.creation?.sourceVersion, source.version);
  if (source.source === "STONKBROKERS")
    assert.equal(event.creation?.quoteAsset, source.quoteAsset);
  assert.throws(
    () =>
      decodeLaunchEvent(
        source,
        { ...log, address: `0x${"9".repeat(40)}` },
        row.timestamp,
      ),
    /envelope/,
  );
  assert.throws(
    () => decodeLaunchEvent(source, { ...log, removed: true }, row.timestamp),
    /envelope/,
  );
  assert.throws(() =>
    decodeLaunchEvent(source, { ...log, data: "0x01" }, row.timestamp),
  );
  assert.throws(() => decodeLaunchEvent(source, log, "not a date"), /envelope/);
  return event;
});
assert.equal(
  events.filter((e: any) => e.creation.sourceVersion === "V1").length,
  3,
);
assert.equal(
  events.filter(
    (e: any) =>
      e.creation.sourceVersion === "V2" && e.creation.source === "PONS",
  ).length,
  2,
);
const enrolled = events.find((e: any) => e.creation.sourceVersion === "V2_R2")!;
assert.equal(enrolled.creation.relationship, "TOKEN_ENROLLED");
const created = events.find(
  (e: any) => e.creation.sourceId === "stonk-v2-weth",
)!;
const graduation = {
  ...created,
  key: `0x${"1".repeat(64)}:7`,
  name: "LaunchBonded",
  block: String(BigInt(created.block) + 10n),
  transaction: `0x${"1".repeat(64)}` as Hex,
  logIndex: 7,
  creation: null,
  market: `0x${"2".repeat(40)}` as Hex,
};
const graduated = applyLaunchEvent(created.creation, graduation);
assert.equal(graduated.state, "GRADUATED");
assert.equal(graduated.graduationTransaction, graduation.transaction);
assert.equal(replayLaunchHistory([graduation, created])!.state, "GRADUATED");
assert.equal(
  replayLaunchHistory([created, graduation], {
    ...graduated,
    graduationTransaction: null,
    graduationBlock: null,
  })!.graduationTransaction,
  graduation.transaction,
  "Historical replay supplies transaction evidence after a view observed graduation",
);
assert.throws(
  () =>
    replayLaunchHistory([created], {
      ...graduated,
      token: enrolled.creation.token,
    }),
  /identity conflict/,
);
assert.throws(
  () =>
    replayLaunchHistory([
      created,
      {
        ...created,
        key: "another",
        creation: { ...created.creation, creator: enrolled.creation.creator },
      },
    ]),
  /conflicting launch creation/,
);
assert.equal(boundedProgress(1n, 0n), null);
assert.equal(boundedProgress(20n, 10n), 10000);
assert.equal(boundedProgress(1n, 3n), 3333);
assert.equal(
  replayLaunchHistory([{ ...graduation, creation: null }]),
  null,
  "Lifecycle evidence alone never invents a token launch",
);
console.info(
  JSON.stringify({
    evidence: fixture.evidence,
    genuineCreationReplays: events.length,
    sourceGenerations: [
      "PONS_V1",
      "PONS_V2",
      "STONKBROKERS_V2",
      "STONKBROKERS_V2_R2",
    ],
    pass: true,
  }),
);
