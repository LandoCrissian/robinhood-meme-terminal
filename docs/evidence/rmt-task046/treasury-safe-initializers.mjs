import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import {
  buildOperationsSafeInitializer, deriveSafeProxy, encodeSafeSetup, observeSafeProxyDerivation,
} from "../rmt-task045/operations-safe-initializer.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const sourceCommit = "613c438151004dc7ba3bf561d6b221b4434ed22d";
const operationsApproval = "../rmt-task045/operations-safe-policy.json";
const reserveApproval = "./reserve-safe-policy.json";
const proposalStatus = "SALT_PROPOSED_UNAPPROVED";

export function buildTreasurySafeInitializers(viem, reservePolicy = read(reserveApproval), operationsPolicy = read(operationsApproval)) {
  const verified = buildOperationsSafeInitializer(viem, operationsPolicy);
  const { operations, reserve: priorReserve } = operationsPolicy;
  const reserve = {
    ...operations,
    name: priorReserve.name,
    creationFeeShareBps: priorReserve.creationFeeShareBps,
    eligibleCurveAndOriginalLpFeeShareBps: priorReserve.eligibleCurveAndOriginalLpFeeShareBps,
  };
  assert.deepEqual(reservePolicy, {
    schema: "rmt-launch-reserve-safe-policy-v1",
    approvalReference: "https://github.com/LandoCrissian/robinhood-meme-terminal/issues/621",
    baseCommit: sourceCommit,
    chainId: operationsPolicy.chainId,
    candidateCommit: operationsPolicy.candidateCommit,
    releaseManifestSha256Lf: operationsPolicy.releaseManifestSha256Lf,
    state: operationsPolicy.state,
    approval: "APPROVED_FOR_PREPARATION_ONLY",
    broadcastAuthorized: false,
    operationsApproval,
    reserve,
    deployer: null,
    economicsApprovalReference: null,
  }, "Reserve policy differs from the exact preparation-only approval");

  const initcodeKeccak256 = verified.fixture.initcodeKeccak256;
  const proposals = [operations, reserve].map(({ name, factory, owners, setup }) => {
    const initializer = encodeSafeSetup(viem, owners, setup);
    const initializerKeccak256 = viem.keccak256(initializer);
    assert.equal(initializerKeccak256, verified.approved.initializerKeccak256);
    const label = `RMT Launch / Task 046 / chain 4663 / SafeL2 1.4.1 / ${name} / salt candidate 1`;
    const saltNonce = viem.keccak256(viem.stringToHex(label));
    const { create2Salt, address } = deriveSafeProxy(viem, factory, initializer, saltNonce, initcodeKeccak256);
    assert.ok(!owners.includes(address));
    return {
      role: name, status: proposalStatus, saltLabel: label, saltNonce, create2Salt,
      initializerKeccak256, initializerBytes: viem.size(initializer), counterfactualAddress: address,
      approvedDeploymentSaltNonce: null, verifiedBeneficiary: null,
    };
  });
  for (const field of ["saltNonce", "create2Salt", "counterfactualAddress"]) {
    assert.notEqual(proposals[0][field], proposals[1][field], `Treasury ${field} collision`);
  }
  return {
    chainId: operationsPolicy.chainId, candidateCommit: operationsPolicy.candidateCommit,
    releaseManifestSha256Lf: operationsPolicy.releaseManifestSha256Lf,
    state: operationsPolicy.state, broadcastAuthorized: false, initcodeKeccak256, proposals,
  };
}

async function observeSaltProposals(viem, operationsPolicy, report) {
  const observe = (proposal, block) => observeSafeProxyDerivation(viem, operationsPolicy, {
    scope: proposal.status, ownerAddresses: operationsPolicy.operations.owners, saltNonce: proposal.saltNonce,
    initcodeKeccak256: report.initcodeKeccak256, fixtureAddress: proposal.counterfactualAddress,
  }, block);
  const first = await observe(report.proposals[0]);
  const second = await observe(report.proposals[1], BigInt(first.blockNumber));
  assert.deepEqual([second.chainId, second.blockNumber, second.blockHash], [first.chainId, first.blockNumber, first.blockHash]);
  return {
    provider: first.provider, blockNumber: first.blockNumber, blockHash: first.blockHash, blockTimeUtc: first.blockTimeUtc,
    runtimePins: first.runtimePins, writeMethodsCalled: false,
    proposals: [first, second].map(({ fixtureCode, fixtureNonce, simulatedAddress }, index) => ({
      role: report.proposals[index].role, code: fixtureCode, nonce: fixtureNonce, simulatedAddress,
    })),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { checkout: { type: "string" }, "observe-salt-proposals": { type: "boolean" } } });
  assert.ok(values.checkout, "Provide --checkout with pinned viem installed");
  const viem = webTools(resolve(values.checkout));
  const operationsPolicy = read(operationsApproval);
  const report = buildTreasurySafeInitializers(viem, read(reserveApproval), operationsPolicy);
  if (values["observe-salt-proposals"]) report.observation = await observeSaltProposals(viem, operationsPolicy, report);
  console.log(JSON.stringify(report, null, 2));
}
