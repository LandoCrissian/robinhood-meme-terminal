import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { hashTypedData, toHex } = requireWeb("viem");
const { privateKeyToAccount } = requireWeb("viem/accounts");
const fixtureReplacement = () => privateKeyToAccount(toHex(1104n, { size: 32 }));
const sameAddress = (a, b) => a.toLowerCase() === b.toLowerCase();
const notice = 2n * 86400n;

export async function currentFixtureSigners(client, directory, abi, original, read) {
  const members = await Promise.all(["signerA", "signerB", "signerC"].map((which) =>
    read(client, directory, abi, which)));
  const known = [...original, fixtureReplacement()];
  return members.map((member) => {
    const signer = known.find(({ address }) => sameAddress(member, address));
    assert.ok(signer, "Directory selected an unknown signer in the isolated fixture");
    return signer;
  });
}

const actionDomain = (chainId, verifyingContract) => ({
  name: "RMT Launch Curve Directory", version: "2", chainId, verifyingContract,
});

export function expectedDirectoryDigest(client, directory, abi, action) {
  const components = abi.find(({ name }) => name === "actionDigest").inputs[0].components;
  const types = { Action: components.map(({ name, type }) => ({ name, type })) };
  return hashTypedData({ domain: actionDomain(client.chain.id, directory), primaryType: "Action", types, message: action });
}

const migrationTypes = { CurveAssetMigration: [
  { name: "token", type: "address" },
  { name: "sourceCurve", type: "address" },
  { name: "nonce", type: "uint64" },
  { name: "fromVersion", type: "uint32" },
  { name: "nextCurve", type: "address" },
  { name: "runtimeHash", type: "bytes32" },
  { name: "signerSetEpoch", type: "uint64" },
  { name: "deadline", type: "uint48" },
] };

export async function checkedMigrationDigest(client, registry, registryAbi, directory, directoryAbi, projectAsset, read) {
  const [[, sourceCurve, fromVersion], [nextCurve, runtimeHash, deadline], nonce, signerSetEpoch, observed] =
    await Promise.all([
      read(client, registry, registryAbi, "project", [projectAsset]),
      read(client, registry, registryAbi, "proposal", [projectAsset]),
      read(client, registry, registryAbi, "migrationNonce", [projectAsset]),
      read(client, directory, directoryAbi, "signerSetEpoch"),
      read(client, registry, registryAbi, "migrationDigest", [projectAsset]),
    ]);
  const digest = hashTypedData({
    domain: { name: "RMT Launch Project Registry", version: "3", chainId: client.chain.id, verifyingContract: registry },
    types: migrationTypes, primaryType: "CurveAssetMigration", message: {
      token: projectAsset, sourceCurve, nonce, fromVersion, nextCurve, runtimeHash, signerSetEpoch, deadline,
    },
  });
  assert.equal(digest, observed);
  return digest;
}

export async function reauthorizeAfterFixtureRotation({
  client, operator, directory, projectRegistry, projectAsset, directoryAbi, registryAbi, original,
  signedMigration, read, send, request, warp, oneEvent, receiptEvidence,
}) {
  assert.equal(client.chain.id, 4663);
  const beforeNonce = await read(client, directory, directoryAbi, "nonce");
  const [departing, signerB, signerC] = await currentFixtureSigners(client, directory, directoryAbi, original, read);
  const incoming = fixtureReplacement();
  const epoch = await read(client, directory, directoryAbi, "signerSetEpoch");
  assert.equal(epoch, 1n);
  const rotation = { departingSigner: departing.address, incomingSigner: incoming.address,
    signerSetEpoch: epoch, nonce: await read(client, directory, directoryAbi, "rotationNonce"),
    deadline: (await client.getBlock()).timestamp + 4n * 86400n };

  const domain = actionDomain(client.chain.id, directory);
  const components = directoryAbi.find(({ name }) => name === "signerRotationDigest").inputs[0].components;
  const rotationTypes = { SignerRotation: components.map(({ name, type }) => ({ name, type })) };
  const digest = hashTypedData({ domain, types: rotationTypes, primaryType: "SignerRotation", message: rotation });
  assert.equal(await read(client, directory, directoryAbi, "signerRotationDigest", [rotation]), digest);
  const acceptanceTypes = { RotationAcceptance: [{ name: "rotationDigest", type: "bytes32" }] };
  const acceptanceDigest = hashTypedData({ domain, types: acceptanceTypes, primaryType: "RotationAcceptance",
    message: { rotationDigest: digest } });
  assert.equal(await read(client, directory, directoryAbi, "rotationAcceptanceDigest", [digest]), acceptanceDigest);
  const [first, second, acceptance, wrongAcceptance] = await Promise.all([
    signerB.sign({ hash: digest }), signerC.sign({ hash: digest }), incoming.sign({ hash: acceptanceDigest }),
    incoming.sign({ hash: digest }),
  ]);
  const submit = (...args) => request(directory, directoryAbi, "scheduleSignerRotation", [rotation, ...args]);
  const execute = request(directory, directoryAbi, "executeSignerRotation", [rotation]);
  const insufficient = await send(client, operator, submit(first, first, acceptance), "reverted");
  const noAcceptance = await send(client, operator, submit(first, second, wrongAcceptance), "reverted");
  const scheduled = await send(client, operator, submit(first, second, acceptance));
  const announcement = oneEvent(scheduled, directory, directoryAbi, "SignerRotationScheduled").args;
  assert.equal(announcement.digest, digest);
  assert.equal(announcement.signerSetEpoch, epoch);
  assert.equal(BigInt(announcement.executableAt) - (await client.getBlock({ blockNumber: scheduled.blockNumber })).timestamp, notice);
  const tooEarly = await send(client, operator, execute, "reverted");
  const previousProposal = await read(client, projectRegistry, registryAbi, "proposal", [projectAsset]);
  await warp(client, notice);
  const enacted = await send(client, operator, execute);
  const event = oneEvent(enacted, directory, directoryAbi, "SignerRotationExecuted").args;
  assert.equal(event.digest, digest);
  assert.equal(event.newSignerSetEpoch, epoch + 1n);
  assert.ok(sameAddress(event.departingSigner, departing.address) && sameAddress(event.incomingSigner, incoming.address));
  assert.equal(await read(client, directory, directoryAbi, "isSigner", [departing.address]), false);
  assert.equal(await read(client, directory, directoryAbi, "isSigner", [incoming.address]), true);
  assert.equal(await read(client, directory, directoryAbi, "nonce"), beforeNonce + 1n);

  const staleExecution = await send(client, operator,
    request(projectRegistry, registryAbi, "executeMigration", [projectAsset]), "reverted");
  const cleared = await send(client, operator, request(projectRegistry, registryAbi, "clearStaleMigration", [projectAsset]));
  const renewedProposal = await read(client, projectRegistry, registryAbi, "proposal", [projectAsset]);
  assert.deepEqual(renewedProposal.slice(0, 3), previousProposal.slice(0, 3), "Creator consent changed during clearance");
  assert.equal(BigInt(renewedProposal[3]), 0n);

  const submitMigration = (a, b) => request(projectRegistry, registryAbi, "scheduleMigration", [projectAsset, a, b]);
  const staleApproval = await send(client, operator, submitMigration(...signedMigration), "reverted");
  const currentDigest = await checkedMigrationDigest(client, projectRegistry, registryAbi, directory, directoryAbi, projectAsset, read);
  const [removedApproval, newApproval, continuingApproval] = await Promise.all([
    departing.sign({ hash: currentDigest }), incoming.sign({ hash: currentDigest }), signerB.sign({ hash: currentDigest }),
  ]);
  const removedKey = await send(client, operator, submitMigration(removedApproval, continuingApproval), "reverted");
  const rescheduled = await send(client, operator, submitMigration(newApproval, continuingApproval));
  const authorization = oneEvent(rescheduled, projectRegistry, registryAbi, "MigrationScheduled").args;
  assert.equal(authorization.signerSetEpoch, epoch + 1n);
  assert.equal(BigInt(authorization.executableAt) -
    (await client.getBlock({ blockNumber: rescheduled.blockNumber })).timestamp, notice);

  return { rotation, digest, acceptanceDigest, announcement, event, authorization, creatorProposalPreserved: true,
    scheduled: receiptEvidence(scheduled), enacted: receiptEvidence(enacted), insufficient: receiptEvidence(insufficient),
    wrongAcceptance: receiptEvidence(noAcceptance), tooEarly: receiptEvidence(tooEarly), staleExecution: receiptEvidence(staleExecution),
    cleared: receiptEvidence(cleared), staleApproval: receiptEvidence(staleApproval), removedKey: receiptEvidence(removedKey),
    rescheduled: receiptEvidence(rescheduled) };
}
