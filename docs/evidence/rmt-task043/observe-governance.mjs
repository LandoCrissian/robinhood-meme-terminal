import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Read-only receipt projection for the isolated fork. Copy beside the #594 harness.
const { keccak256, parseAbi, parseEventLogs } =
  createRequire(new URL("../../../apps/web/package.json", import.meta.url))("viem");
const directoryAbi = parseAbi([
  "function signerSetEpoch() view returns (uint64)",
  "function isSigner(address signer) view returns (bool)",
  "event SignerRotationScheduled(bytes32 indexed digest,uint64 indexed signerSetEpoch,uint64 indexed rotationNonce,address departingSigner,address incomingSigner,uint48 executableAt,uint48 expiresAt)",
  "event SignerRotationExecuted(bytes32 indexed digest,uint64 indexed newSignerSetEpoch,uint64 indexed rotationNonce,address departingSigner,address incomingSigner)",
]);
const registryAbi = parseAbi([
  "function directory() view returns (address)",
  "function proposal(address projectAsset) view returns (address nextEngine,bytes32 runtimeHash,uint48 deadline,uint48 executableAt,uint48 expiresAt,uint64 signerSetEpoch)",
  "function project(address projectAsset) view returns (address factory,address curve,uint32 version,address engine,uint64 migrations)",
  "event MigrationScheduled(address indexed token,uint64 indexed nonce,uint48 executableAt,uint48 expiresAt,uint64 signerSetEpoch)",
  "event MigrationAuthorizationInvalidated(address indexed token,uint64 indexed nonce,uint64 indexed previousEpoch,uint64 currentEpoch)",
  "event MigrationCleared(address indexed token,uint64 indexed nonce)",
  "event ProjectMigrated(address indexed token,uint64 indexed index,address indexed nextEngine,uint32 toVersion)",
]);
const same = (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

export async function observeGovernanceReceipts({
  client, directory, registry, directoryRuntimeHash, registryRuntimeHash, migration, projectAsset,
}) {
  assert.equal(await client.getChainId(), 4663);
  const router = { address: directory, abi: directoryAbi };
  const project = { address: registry, abi: registryAbi };
  const plan = [
    [migration.scheduled, project, "MigrationScheduled"],
    [migration.rotation.scheduled, router, "SignerRotationScheduled"],
    [migration.rotation.enacted, router, "SignerRotationExecuted"],
    [migration.rotation.cleared, project, "MigrationAuthorizationInvalidated"],
    [migration.rotation.rescheduled, project, "MigrationScheduled"],
    [migration.migrated, project, "ProjectMigrated"],
  ];
  const read = (contract, functionName, blockNumber, args = []) =>
    client.readContract({ ...contract, functionName, blockNumber, args });
  const epochAt = (blockNumber) => read(router, "signerSetEpoch", blockNumber);
  const rows = [];
  for (const [ref, contract, eventName] of plan) {
    const height = BigInt(ref.blockNumber);
    const [receipt, block, epoch] = await Promise.all([
      client.getTransactionReceipt({ hash: ref.transactionHash }),
      client.getBlock({ blockNumber: height }),
      epochAt(height),
    ]);
    assert.ok(same(receipt.transactionHash, ref.transactionHash) && same(receipt.blockHash, ref.blockHash));
    assert.ok(same(block.hash, receipt.blockHash) && block.number === receipt.blockNumber && block.number === height);
    // Fixture uses one transaction per block so epoch reads cannot be ambiguous within a block.
    assert.ok(block.transactions.length === 1 && same(block.transactions[receipt.transactionIndex], ref.transactionHash));
    assert.ok(same(receipt.to, contract.address) && receipt.status === "success");
    const [log, ...others] = parseEventLogs({
      abi: contract.abi, eventName, strict: true, logs: receipt.logs.filter(({ address }) => same(address, contract.address)),
    });
    assert.ok(log && others.length === 0 && log.removed === false && log.logIndex !== null);
    assert.ok(log.blockNumber === height && same(log.blockHash, block.hash) && same(log.transactionHash, receipt.transactionHash));
    assert.equal(log.transactionIndex, receipt.transactionIndex);
    rows.push({ name: eventName, blockNumber: height, blockHash: block.hash, timestamp: block.timestamp, signerSetEpoch: epoch,
      transactionHash: receipt.transactionHash, logIndex: log.logIndex, args: log.args });
  }
  assert.ok(rows.every((row, i) => i === 0 || row.blockNumber > rows[i - 1].blockNumber));
  const [stale, notice, rotation, cleared, approved, settled] = rows;
  const { departingSigner, incomingSigner } = rotation.args;
  assert.equal(stale.args.signerSetEpoch, stale.signerSetEpoch);
  assert.equal(notice.args.signerSetEpoch, stale.signerSetEpoch);
  assert.equal(notice.signerSetEpoch, stale.signerSetEpoch);
  assert.equal(rotation.signerSetEpoch, stale.signerSetEpoch + 1n);
  assert.equal(rotation.args.newSignerSetEpoch, rotation.signerSetEpoch);
  assert.ok(same(notice.args.departingSigner, departingSigner) && same(notice.args.incomingSigner, incomingSigner));
  assert.equal(notice.args.digest, rotation.args.digest);
  assert.equal(notice.args.rotationNonce, rotation.args.rotationNonce);
  assert.ok(BigInt(notice.args.executableAt) >= notice.timestamp + 172_800n
    && rotation.timestamp >= BigInt(notice.args.executableAt) && rotation.timestamp <= BigInt(notice.args.expiresAt));
  assert.equal(cleared.args.nonce, stale.args.nonce);
  assert.equal(cleared.args.previousEpoch, stale.signerSetEpoch);
  assert.equal(cleared.args.currentEpoch, rotation.signerSetEpoch);
  assert.equal(cleared.signerSetEpoch, rotation.signerSetEpoch);
  assert.equal(approved.args.nonce, stale.args.nonce + 1n);
  assert.equal(approved.args.signerSetEpoch, rotation.signerSetEpoch);
  assert.equal(approved.signerSetEpoch, rotation.signerSetEpoch);
  assert.equal(settled.signerSetEpoch, rotation.signerSetEpoch);
  assert.ok([stale, cleared, approved, settled].every((row) => same(row.args.token, projectAsset)));
  assert.ok(BigInt(approved.args.executableAt) >= approved.timestamp + 172_800n
    && settled.timestamp >= BigInt(approved.args.executableAt) && settled.timestamp <= BigInt(approved.args.expiresAt));

  const terminal = settled.blockNumber;
  const [
    directoryCode, registryCode, bound, previous, consent, renewed, item, priorMember, nextMember,
  ] = await Promise.all([
    client.getCode({ address: directory, blockNumber: terminal }),
    client.getCode({ address: registry, blockNumber: terminal }),
    read(project, "directory", terminal),
    read(project, "proposal", stale.blockNumber, [projectAsset]),
    read(project, "proposal", cleared.blockNumber, [projectAsset]),
    read(project, "proposal", approved.blockNumber, [projectAsset]),
    read(project, "project", terminal, [projectAsset]),
    read(router, "isSigner", terminal, [departingSigner]),
    read(router, "isSigner", terminal, [incomingSigner]),
  ]);
  assert.ok(same(keccak256(directoryCode), directoryRuntimeHash) && same(keccak256(registryCode), registryRuntimeHash));
  assert.ok(same(bound, directory) && !priorMember && nextMember);
  assert.deepEqual(previous.slice(0, 3), consent.slice(0, 3));
  assert.deepEqual(consent.slice(0, 3), renewed.slice(0, 3));
  assert.deepEqual(consent.slice(3), [0, 0, 0n]);
  assert.deepEqual(renewed.slice(3), [approved.args.executableAt, approved.args.expiresAt, approved.signerSetEpoch]);
  assert.ok(same(item[1], settled.args.nextEngine) && same(item[3], settled.args.nextEngine));
  assert.equal(item[2], settled.args.toVersion);
  assert.equal(item[4], settled.args.index);
  const canonical = await client.getBlock({ blockNumber: terminal });
  assert.ok(same(canonical.hash, settled.blockHash), "Governance evidence block changed");
  return { directory, registry, projectAsset, rows,
    creatorConsent: { destination: consent[0], runtimeHash: consent[1], deadline: consent[2] } };
}
