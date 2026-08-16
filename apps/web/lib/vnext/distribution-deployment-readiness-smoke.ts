import assert from "node:assert/strict";
import {
  buildDistributionDeploymentReadinessPacketV1,
  parseDistributionDeploymentReadinessPacketV1
} from "./distribution-deployment-readiness";

const input = {
  sourceCommit: "6".repeat(40),
  engineCreationCode: "0x6001600055" as const,
  retirementSinkCreationCode: "0x6002600055" as const,
  retirementSinkRuntimeCode: "0x6003600055" as const
};

const packet = buildDistributionDeploymentReadinessPacketV1(input);
assert.deepEqual(parseDistributionDeploymentReadinessPacketV1(packet), packet);
assert.equal(packet.status, "predeployment_unapproved");
assert.equal(packet.utilityPolicy.erc20CostPerRecipientAtomic, null);
assert.equal(packet.operator.deployer, null);
assert.equal(packet.deployment.authorized, false);
assert.equal(packet.activation.publicUiAuthorized, false);
assert.equal(packet.activation.walletSubmissionEnabled, false);
assert.equal(packet.activation.serverSubmissionEnabled, false);
assert.equal(packet.safeForForkRehearsal, true);
assert.equal(packet.safeForLiveDeployment, false);
assert.equal(packet.blockers.length, 8);

const second = buildDistributionDeploymentReadinessPacketV1(input);
assert.equal(second.packetHash, packet.packetHash);
assert.notEqual(
  buildDistributionDeploymentReadinessPacketV1({ ...input, engineCreationCode: "0x6004600055" }).packetHash,
  packet.packetHash
);
assert.notEqual(
  buildDistributionDeploymentReadinessPacketV1({ ...input, sourceCommit: "7".repeat(40) }).packetHash,
  packet.packetHash
);

const mutations: unknown[] = [
  { ...packet, status: "deployed_not_publicly_activated" },
  { ...packet, chainId: 1 },
  { ...packet, utilityPolicy: { ...packet.utilityPolicy, status: "approved" } },
  { ...packet, utilityPolicy: { ...packet.utilityPolicy, erc20CostPerRecipientAtomic: "1" } },
  { ...packet, operator: { status: "approved", deployer: "0x1111111111111111111111111111111111111111" } },
  { ...packet, deployment: { ...packet.deployment, authorized: true } },
  { ...packet, activation: { ...packet.activation, publicUiAuthorized: true } },
  { ...packet, activation: { ...packet.activation, walletSubmissionEnabled: true } },
  { ...packet, activation: { ...packet.activation, serverSubmissionEnabled: true } },
  { ...packet, safeForLiveDeployment: true },
  { ...packet, blockers: packet.blockers.slice(1) },
  { ...packet, packetHash: `0x${"f".repeat(64)}` },
  { ...packet, unexpected: true }
];
for (const mutation of mutations) assert.throws(() => parseDistributionDeploymentReadinessPacketV1(mutation));

assert.throws(() => buildDistributionDeploymentReadinessPacketV1({ ...input, sourceCommit: "main" }));
assert.throws(() => buildDistributionDeploymentReadinessPacketV1({ ...input, engineCreationCode: "0x" }));

console.log("RMT Distribution deployment readiness remains deterministic, unapproved, and non-submittable.");
