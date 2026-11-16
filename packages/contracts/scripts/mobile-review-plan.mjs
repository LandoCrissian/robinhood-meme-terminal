import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { governance } from "../../../docs/evidence/rmt-task043/compile-rotation-profile.mjs";
import { encodeSafeSetup } from "../../../docs/evidence/rmt-task045/operations-safe-initializer.mjs";
import { buildTreasurySafeInitializers } from "../../../docs/evidence/rmt-task046/treasury-safe-initializers.mjs";
import { assertCurrentMobileObservation, MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { deriveDelegatedConstructors } from "./delegated-mobile-constructors.mjs";
import { verifyDirectType2Outcome } from "./delegated-mobile-transaction.mjs";
import { verifyExportInputs } from "./export-blockscout-4663.mjs";
import { buildFixedSupplyInput, compileFixedSupplyProfile } from "./fixed-supply-profile.mjs";
import { buildBundle } from "./verify-fixed-supply-bundle.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const viem = require("viem");
const { encodeFunctionData, getContractAddress, hashTypedData, isAddressEqual, keccak256, parseAbi, zeroAddress } = viem;
const evidence = new URL("../../../docs/evidence/", import.meta.url);
const read = (path) => readFileSync(new URL(path, evidence));
const readJson = (path) => JSON.parse(read(path));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export const mobilePayer = MOBILE_DEPLOYMENT_PAYER;
const chainId = 4663;
const { noticeSeconds } = governance;
const safeProxyRuntimeHash = "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
const createProxyAbi = parseAbi(["function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)"]);
const constructorStages = [
  ["directory", "Deploy governance directory", ["operations-safe", "reserve-safe"]],
  ["registry", "Deploy project registry", ["directory"]],
  ["successor-v2", "Deploy the V2 migration helper", ["registry"]],
  ["successor-v3", "Deploy the V3 migration helper", ["successor-v2"]],
  ["bootstrap", "Deploy the guarded launch factory and graduation engine", ["registry", "successor-v2", "successor-v3"]],
];

function assertHash(value) {
  assert.match(value, /^0x[0-9a-f]{64}$/);
}

function nonce(value) {
  assert.equal(typeof value, "string");
  assert.match(value, /^(0|[1-9][0-9]{0,19})$/);
  const result = BigInt(value);
  assert.ok(result < (1n << 64n), "Nonce exceeds the EVM limit");
  return result;
}

export function verifyCreateVacancies({ sender, confirmedNonce, pendingNonce, destinations }) {
  assert.ok(isAddressEqual(sender, mobilePayer), "Invalid proposed transaction payer");
  const start = nonce(pendingNonce);
  assert.equal(start, nonce(confirmedNonce), "Pending nonce differs from confirmed nonce");
  assert.equal(destinations.length, constructorStages.length);
  return constructorStages.map(([id], index) => {
    const expectedNonce = start + 2n + BigInt(index);
    assert.ok(expectedNonce < ((1n << 64n) - 1n), "No usable nonce for a constructor");
    const address = getContractAddress({ from: sender, nonce: expectedNonce });
    const observed = destinations[index];
    assert.ok(isAddressEqual(observed.address, address), "Unexpected predicted constructor address");
    assert.equal(nonce(observed.deploymentNonce), expectedNonce, "Unexpected proposed constructor nonce");
    assert.equal(observed.code, "0x", "Predicted constructor address contains code");
    assert.equal(nonce(observed.accountNonce), 0n, "Predicted constructor address has a nonzero nonce");
    return { id, address, nonce: expectedNonce.toString(), status: "VACANT_AT_OBSERVED_BLOCK_ONLY" };
  });
}

function row({ id, label, dependsOn, from, to, nonce = null, valueWei = "0", dataHash = null, expectedAddress = null,
  receipt, authorization, scope = "LOOPBACK_FIXTURE_ONLY", details }) {
  if (dataHash !== null) assertHash(dataHash);
  if (receipt) {
    assert.equal(receipt.status, "success");
    assertHash(receipt.transactionHash);
    assertHash(receipt.blockHash);
  }
  return {
    id, label, dependsOn, scope, chainId, from, to, nonce, valueWei, dataHash, expectedAddress,
    observedForkGas: receipt?.gasUsed ?? null,
    receiptHash: receipt?.transactionHash ?? null,
    receiptBlock: receipt ? { number: receipt.blockNumber, hash: receipt.blockHash } : null,
    authorization, details,
  };
}

function safeRows() {
  const policy = readJson("rmt-task045/operations-safe-policy.json").operations;
  const approved = buildTreasurySafeInitializers(viem);
  const { factory, singleton, owners, setup, safeProfile, threshold } = policy;
  assert.equal(threshold, 2);
  assert.equal(owners.length, 3);
  assert.equal(new Set(owners.map((owner) => owner.toLowerCase())).size, 3);
  assert.ok(owners.every((owner) => !isAddressEqual(owner, mobilePayer)));
  const initializer = encodeSafeSetup(viem, owners, setup);
  return approved.proposals.map((proposal, index) => {
    assert.equal(proposal.initializerKeccak256, keccak256(initializer));
    assert.equal(proposal.verifiedBeneficiary, null);
    assert.equal(proposal.approvedDeploymentSaltNonce, null);
    return row({
      id: index === 0 ? "operations-safe" : "reserve-safe",
      label: "Prepare " + proposal.role,
      dependsOn: index === 0 ? [] : ["operations-safe"],
      scope: "PROPOSED_SAFE_REVIEW_ONLY",
      from: mobilePayer, to: factory,
      dataHash: keccak256(encodeFunctionData({
        abi: createProxyAbi, functionName: "createProxyWithNonce",
        args: [singleton, initializer, BigInt(proposal.saltNonce)],
      })),
      expectedAddress: proposal.counterfactualAddress,
      authorization: "SALT_APPROVAL_AND_LIVE_AUTHORIZATION_REQUIRED",
      details: {
        safeProfile, owners, threshold, singleton, fallbackHandler: setup.fallbackHandler,
        initialFundingWei: "0",
        saltNonce: proposal.saltNonce,
        create2Salt: proposal.create2Salt,
        initializerHash: proposal.initializerKeccak256,
        beneficiaryStatus: "UNASSIGNED",
        payerIsOwner: false,
        requiredReceiptChecks: ["ProxyCreation emitted by the pinned proxy factory", "Exact proxy and singleton",
          "Expected proxy runtime, three owners and threshold 2"],
      },
    });
  });
}

function constructorRows(archived) {
  const { fixtureOnly: fixture } = archived.bundle;
  const closure = archived.fork.deployment.deployment;
  const receipts = [closure.constructors.directory.receipt, closure.constructors.registry.receipt,
    closure.constructors.v2.receipt, closure.constructors.v3.receipt, closure];
  return fixture.transactions.map((tx, index) => {
    const [id, label, dependsOn] = constructorStages[index];
    assert.equal(tx.name, id);
    assert.equal(tx.observedForkReceipt, receipts[index].transactionHash);
    return row({
      id, label, dependsOn, from: fixture.deployer, to: null, nonce: String(tx.nonce),
      dataHash: tx.initcodeHash, expectedAddress: tx.address, receipt: receipts[index],
      authorization: "FIXTURE_ONLY_PRODUCTION_INPUTS_UNASSIGNED",
      details: {
        contract: tx.contract,
        runtimeHash: tx.runtimeHash,
        initcodeBytes: tx.initcodeBytes,
        runtimeBytes: tx.runtimeBytes,
        requiredReceiptChecks: ["Receipt contract address matches sender and nonce", "Exact materialized runtime hash"],
        ...(id === "directory" ? { signers: fixture.signers, threshold: fixture.quorum } : {}),
        ...(id === "bootstrap" ? {
          operatingRecipient: fixture.operatingRecipient,
          futureReserveRecipient: fixture.futureReserveRecipient,
          children: fixture.bootstrapChildren.map(({ contract, address, runtimeHash, create2Salt, hookPermissionBits }) => ({
            contract, address, runtimeHash, ...(create2Salt ? { create2Salt, hookPermissionBits } : {}),
          })),
        } : {}),
      },
    });
  });
}

function governanceRows(fixtureSource, directoryAbi, exactReplay) {
  const { fixtureOnly: fixture } = fixtureSource.bundle;
  const [directory, , , successorV3] = fixture.transactions;
  const factory = fixture.bootstrapChildren[2];
  const { deployment: closure } = fixtureSource.fork.deployment;
  const definitions = [
    { id: "factory", label: "launch factory", kind: 0, version: 1, publication: closure.publication,
      target: factory, dependsOn: ["bootstrap"] },
    { id: "migration-template", label: "V3 migration template", kind: 4, version: 3,
      publication: closure.templatePublication, target: successorV3, dependsOn: ["execute-factory", "successor-v3"] },
  ];
  const domain = { chainId, verifyingContract: directory.address, ...governance.directory.domain };
  const digestAbi = directoryAbi.find(({ type, name }) => type === "function" && name === "actionDigest");
  const actionFields = digestAbi.inputs[0].components.map(({ name, type }) => ({ name, type }));
  assert.equal("Action(" + actionFields.map(({ name, type }) => type + " " + name).join(",") + ")", governance.directory.action);
  const actionTypes = { Action: actionFields };
  const anchorSeconds = Math.floor(Date.parse(fixtureSource.fork.report.network.timestamp) / 1000);
  return definitions.flatMap(({ id, label, kind, version, publication, target, dependsOn }, index) => {
    const deadline = exactReplay ? publication.reviewAction.deadline : anchorSeconds + (index + 2) * noticeSeconds;
    assert.ok(Number.isSafeInteger(deadline) && deadline > anchorSeconds && deadline < 2 ** 48);
    const message = {
      kind, nonce: String(index), version, factory: target.address, runtimeHash: target.runtimeHash,
      signerSetEpoch: String(governance.initialSignerSetEpoch), deadline,
    };
    const digest = hashTypedData({ domain, types: actionTypes, primaryType: "Action", message });
    if (exactReplay) {
      assert.deepEqual(publication.reviewAction, message, "Replayed typed-data base fields differ");
      assert.equal(publication.actionDigest, digest, "Replayed typed-data digest differs");
    }
    const { scheduled, executed } = publication;
    for (const receipt of [scheduled, executed]) {
      assert.equal(receipt.status, "success");
      assertHash(receipt.transactionHash);
      assertHash(receipt.blockHash);
    }
    const executeDataHash = keccak256(encodeFunctionData({ abi: directoryAbi, functionName: "execute", args: [message] }));
    const scheduleInputObserved = exactReplay && hasTransactionEvidence(scheduled);
    const executeInputObserved = exactReplay && hasTransactionEvidence(executed);
    if (scheduleInputObserved || executeInputObserved) {
      const scheduleNonce = BigInt(fixture.transactions.at(-1).nonce) + 1n + 2n * BigInt(index);
      if (scheduleInputObserved) validateOperation(scheduled, fixture.deployer, directory.address, "0", scheduleNonce);
      if (executeInputObserved) {
        validateOperation(executed, fixture.deployer, directory.address, "0", scheduleNonce + 1n);
        assert.equal(executed.calldataHash, executeDataHash);
      }
    }
    return [
      row({
        id: "schedule-" + id, label: "Schedule publication of the " + label, dependsOn,
        from: fixture.deployer, to: directory.address, nonce: scheduled.nonce?.toString() ?? null,
        authorization: "TWO_CURRENT_GOVERNANCE_SIGNATURES_REQUIRED",
        receipt: exactReplay ? scheduled : undefined,
        details: {
          digest, domain, primaryType: "Action", types: actionTypes, message, noticeSeconds,
          timing: exactReplay ? "FORK_TYPED_DATA" : "ILLUSTRATIVE_FIXTURE_DEADLINE",
          ...(!exactReplay ? { archivedNoticeReceipt: scheduled.transactionHash, archivedNoticeGas: scheduled.gasUsed } : {}),
          callDataStatus: "WITHHELD_WITHOUT_GOVERNANCE_AUTHORIZATION",
          ...(exactReplay ? { receiptInputStatus: scheduleInputObserved ? "HASH_AND_NONCE_OBSERVED" : "UNAVAILABLE" } : {}),
          ...(scheduleInputObserved ? { syntheticReceiptInputHash: scheduled.calldataHash } : {}),
          requiredReceiptChecks: ["ActionScheduled binds digest, governance nonce, earliest execution and expiry"],
        },
      }),
      row({
        id: "execute-" + id, label: "Execute publication of the " + label, dependsOn: ["schedule-" + id],
        from: fixture.deployer, to: directory.address, nonce: executed.nonce?.toString() ?? null,
        dataHash: executeDataHash, authorization: "EXECUTABLE_ONLY_AFTER_TWO_DAY_NOTICE_AND_BEFORE_EXPIRY",
        receipt: exactReplay ? executed : undefined,
        details: {
          digest, noticeSeconds, timing: exactReplay ? "FORK_TYPED_DATA" : "ILLUSTRATIVE_FIXTURE_DEADLINE",
          ...(!exactReplay ? { archivedNoticeReceipt: executed.transactionHash, archivedNoticeGas: executed.gasUsed } : {}),
          ...(exactReplay ? { receiptInputStatus: executeInputObserved ? "HASH_AND_NONCE_OBSERVED" : "UNAVAILABLE" } : {}),
          requiredReceiptChecks: [kind === 0 ? "FactoryPublished binds version, factory and runtime hash" :
            "MigrationTemplatePublished binds successor version, deployer and runtime hash"],
        },
      }),
    ];
  });
}

function hasTransactionEvidence(receipt) {
  const fields = ["from", "to", "nonce", "valueWei", "calldataHash"];
  const count = fields.filter((field) => Object.hasOwn(receipt, field)).length;
  assert.ok(count === 0 || count === fields.length, "Incomplete fork transaction identity");
  return count === fields.length;
}

function validateOperation(receipt, from, to, valueWei, expectedNonce) {
  assert.ok(isAddressEqual(receipt.from, from));
  assert.ok(isAddressEqual(receipt.to, to));
  assert.equal(receipt.valueWei, valueWei);
  assertHash(receipt.calldataHash);
  const actualNonce = nonce(String(receipt.nonce));
  if (expectedNonce !== undefined) assert.equal(actualNonce, expectedNonce);
}

function projectRow(archived, replay) {
  const { firstProject } = archived.bundle.fixtureOnly;
  const first = archived.fork.projects[0];
  assert.equal(first.symbol, "RMT");
  assert.equal(firstProject.observesCreation, first.creation.transactionHash);
  const dataHash = keccak256(firstProject.data);
  const inputObserved = replay && hasTransactionEvidence(first.creation);
  if (inputObserved) {
    validateOperation(first.creation, firstProject.from, firstProject.to, firstProject.value);
    assert.equal(first.creation.calldataHash, dataHash);
  }
  return row({
    id: "first-rmt", label: "Create the first fixed-supply RMT project", dependsOn: ["execute-factory", "execute-migration-template"],
    from: firstProject.from, to: firstProject.to, nonce: first.creation.nonce?.toString() ?? null,
    valueWei: firstProject.value, dataHash, expectedAddress: firstProject.token.address,
    receipt: first.creation, authorization: "FIXTURE_ONLY_FIRST_PROJECT_TERMS_UNAPPROVED",
    details: {
      name: first.name, symbol: first.symbol, projectURI: first.projectURI,
      supplyWei: first.supplyWei, initialBackingWei: first.initialBackingWei,
      treasury: first.treasury, treasuryShareBpsOfEligibleFees: first.treasuryBps,
      erc20RuntimeHash: firstProject.token.runtimeHash, reviewedGraduationPoolKey: firstProject.poolKey,
      ...(replay ? { receiptInputStatus: inputObserved ? "HASH_AND_NONCE_OBSERVED" : "UNAVAILABLE" } : {}),
      requiredReceiptChecks: ["Canonical CurveCreated and CreationFeePaid from the exact factory",
        "Verified registry identity, token runtime and fixed supply", "Exact native trace if a refund must be proven"],
    },
  });
}

export function reviewCurrentMobileObservation(observation, nowMs) {
  return summarizeObservation(observation, assertCurrentMobileObservation(observation, nowMs));
}

function summarizeObservation(observation, { anchor, confirmedNonce, pendingNonce, balanceWei, createDestinations }) {
  const destinations = verifyCreateVacancies({ sender: mobilePayer, confirmedNonce, pendingNonce, destinations: createDestinations });
  return {
    scope: "READ_ONLY_4663_MOBILE_PREPARATION",
    observedAt: new Date(observation.observedAt).toISOString(), expiresAt: new Date(observation.expiresAt).toISOString(),
    anchor: { number: String(anchor.number), hash: anchor.hash, blockTimeUtc: new Date(anchor.blockTimeUtc).toISOString() },
    confirmedNonce, pendingNonce, balanceWei,
    safes: observation.safes.proposals.map(({ role, counterfactualAddress, gas }) => ({
      role, counterfactualAddress, gas, estimateStatus: gas ? "ESTIMATED_AT_OBSERVED_BLOCK" : "UNAVAILABLE",
    })),
    createDestinations: destinations,
    observedSignerControl: "UNVERIFIED",
  };
}

export function reviewDelegatedMobileObservation(observation, nowMs) {
  const summary = assertCurrentMobileObservation(observation, nowMs, { allowPinnedDelegation: true });
  assert.equal(summary.accountType, "EIP_7702_DELEGATION");
  assert.equal(summary.delegation?.status, "PINNED_RUNTIME");
  return { ...summarizeObservation(observation, summary), accountType: summary.accountType, delegation: summary.delegation };
}

// The sender, nonce and beneficiary addresses only define a counterfactual scenario.
// The directory cannot publish without human-authorized governance actions.
export function delegatedCounterfactual(compilation, observation, fixtureRows, nowMs) {
  const verified = reviewDelegatedMobileObservation(observation, nowMs);
  const safeProposals = safeRows();
  const safeAddresses = safeProposals.map(({ expectedAddress }) => expectedAddress);
  const signers = safeProposals[0].details.owners;
  const { constructors, bootstrapChildren } = deriveDelegatedConstructors(compilation, {
    sender: mobilePayer, createDestinations: verified.createDestinations, signers, safeAddresses,
  });
  const initialNonce = BigInt(verified.pendingNonce);
  assert.deepEqual(fixtureRows.map(({ id }) => id), ["operations-safe", "reserve-safe", ...constructorStages.map(([id]) => id),
    "schedule-factory", "execute-factory", "schedule-migration-template", "execute-migration-template", "first-rmt"]);
  const rows = fixtureRows.map(({ id, label, dependsOn, valueWei }, index) => {
    const base = { id, label, dependsOn, valueWei };
    if (index < 2) {
      const safe = safeProposals[index];
      return { ...base, sender: mobilePayer, nonce: (initialNonce + BigInt(index)).toString(), destination: safe.to,
        predictedAddress: safe.expectedAddress, inputHash: safe.dataHash, estimate: verified.safes[index].gas,
        authorization: "SAFE_SALT_AND_TRANSACTION_APPROVAL_REQUIRED" };
    }
    if (index < 7) {
      const { address, nonce, initcodeHash, runtimeHash, initcodeBytes, runtimeBytes } = constructors[index - 2];
      return { ...base, sender: mobilePayer, nonce, destination: null, predictedAddress: address, inputHash: initcodeHash,
        runtimeHash, initcodeBytes, runtimeBytes, estimate: null, authorization: "VERIFIED_SAFE_RECEIPTS_AND_DEPLOYMENT_APPROVAL_REQUIRED" };
    }
    if (index < 11) {
      return { ...base, sender: null, nonce: null, destination: constructors[0].address, predictedAddress: null,
        inputHash: null, estimate: null, authorization: index % 2 === 1 ? "CURRENT_2_OF_3_GOVERNANCE_APPROVAL_REQUIRED" : "MATCHING_SCHEDULED_NOTICE_REQUIRED" };
    }
    return { ...base, sender: null, nonce: null, destination: bootstrapChildren[2].address, predictedAddress: null,
      inputHash: null, estimate: null, authorization: "FIRST_PROJECT_TERMS_AND_CREATOR_APPROVAL_REQUIRED" };
  });
  return {
    scope: "UNAPPROVED_COUNTERFACTUAL_4663", observed: verified, transactionType: "DIRECT_EIP_1559",
    broadcastAuthorized: false, predictedTreasuriesAreBeneficiaries: false, governanceSignerProposal: signers, threshold: 2,
    walletAcceptance: "UNVERIFIED_PHYSICAL_IPHONE", rows, bootstrapChildren,
  };
}

function verifyDelegatedRehearsal(compilation, fixture, rows) {
  const { fork } = fixture;
  const observed = fork.delegatedSender;
  assert.ok(observed?.status === "BLOCKED_NO_BROADCAST" && observed.scope === "LOOPBACK_FIXTURE_ONLY"
    && observed.broadcastAuthorized === false && observed.ownerKeyControl === "UNVERIFIED", "Exact delegated fork proof required");
  assert.equal(fork.report.execution.hardfork, "prague");
  assert.ok(isAddressEqual(observed.sender, mobilePayer));
  assert.ok(isAddressEqual(observed.delegate, MOBILE_DELEGATE_POLICY.address));
  assert.equal(observed.designator, MOBILE_DELEGATE_POLICY.designator);
  assert.equal(observed.delegateRuntimeHash, MOBILE_DELEGATE_POLICY.runtimeHash);
  const start = nonce(String(observed.initialNonce));
  const safes = safeRows();
  assert.equal(observed.platformSafes.length, safes.length);
  const safeReceipts = safes.map((row, index) => {
    const safe = observed.platformSafes[index];
    assert.ok(isAddressEqual(safe.address, row.expectedAddress));
    assert.equal(safe.role, index === 0 ? "RMT-OPERATIONS" : "RMT-RESERVE");
    assert.deepEqual(safe.owners, row.details.owners);
    assert.equal(safe.threshold, 2);
    assert.equal(safe.version, "1.4.1");
    assert.equal(safe.initializerHash, row.details.initializerHash);
    assert.equal(safe.saltNonce, row.details.saltNonce);
    assert.equal(safe.create2Salt, row.details.create2Salt);
    assert.equal(safe.runtimeHash, safeProxyRuntimeHash);
    return verifyDirectType2Outcome(safe.receipt, { sender: mobilePayer, to: row.to, nonce: start + BigInt(index),
      valueWei: row.valueWei, dataHash: row.dataHash });
  });
  const { constructors, bootstrapChildren } = deriveDelegatedConstructors(compilation, {
    sender: mobilePayer, signers: safes[0].details.owners, safeAddresses: safes.map(({ expectedAddress }) => expectedAddress),
    createDestinations: constructorStages.map(([id], index) => {
      const deploymentNonce = start + 2n + BigInt(index);
      return { id, nonce: deploymentNonce.toString(), address: getContractAddress({ from: mobilePayer, nonce: deploymentNonce }) };
    }),
  });
  assert.deepEqual(observed.exactGovernors, safes[0].details.owners);
  assert.equal(observed.exactConstructorReplay, "ROLLED_BACK_BEFORE_DISPOSABLE_GOVERNORS_REPLAY");
  assert.ok(isAddressEqual(observed.exactFactory, bootstrapChildren[2].address));
  assert.equal(observed.exactFactoryRuntimeHash, bootstrapChildren[2].runtimeHash);
  assert.equal(observed.exactConstructorReceipts.length, constructors.length);
  const constructorReceipts = constructors.map(({ id, address, nonce, initcodeHash, runtimeHash }, index) => {
    const receipt = observed.exactConstructorReceipts[index];
    assert.equal(receipt.name, id);
    assert.equal(receipt.runtimeHash, runtimeHash);
    return { id, ...verifyDirectType2Outcome(receipt, { sender: mobilePayer, to: null, nonce, valueWei: "0",
      dataHash: initcodeHash, expectedAddress: address }) };
  });
  const smoke = observed.signedSmoke;
  assert.ok(!isAddressEqual(smoke.account, mobilePayer) && safes[0].details.owners.every((owner) => !isAddressEqual(owner, smoke.account)));
  const smokeCreated = verifyDirectType2Outcome(smoke.signedTopLevelType2, { sender: smoke.account, to: null, nonce: "0",
    valueWei: "0", dataHash: keccak256("0x6001600c60003960016000f300"),
    expectedAddress: getContractAddress({ from: smoke.account, nonce: 0n }) });
  const smokeReverted = verifyDirectType2Outcome(smoke.minedRevert, { sender: smoke.account, to: null, nonce: "1",
    valueWei: "0", dataHash: keccak256("0x60006000fd"), expectedStatus: "reverted", expectedAddress: smoke.revertedDestination });
  assert.equal(smoke.stateRolledBack, true);
  assert.equal(smoke.revertingTransactionConsumedNonce, true);
  assert.equal(smoke.revokedRejected, true);
  assert.equal(smoke.changedDelegateRejected, true);
  assert.equal(smoke.noDelegationMutationToProposedSender, true);
  assert.equal(observed.replayedNotices.length, 4);
  const publicationReceipts = observed.replayedNotices.map((receipt, index) => {
    const row = rows[7 + index];
    assert.equal(receipt.transactionHash, row.receiptHash);
    return { id: row.id, ...verifyDirectType2Outcome(receipt, { sender: mobilePayer, to: row.to, nonce: start + 7n + BigInt(index),
      valueWei: row.valueWei, dataHash: row.dataHash ?? row.details.syntheticReceiptInputHash }) };
  });
  const first = rows.at(-1);
  assert.equal(observed.replayedRmtCreation.transactionHash, first.receiptHash);
  const firstProjectReceipt = verifyDirectType2Outcome(observed.replayedRmtCreation, { sender: mobilePayer, to: first.to,
    nonce: start + 11n, valueWei: first.valueWei, dataHash: first.dataHash });
  return {
    scope: "SYNTHETIC_PRAGUE_4663_IMPERSONATED_SENDER", ownerKeyControl: "UNVERIFIED",
    safeReceipts, constructorReceipts, publicationReceipts, firstProjectReceipt,
    signedDisposableSmoke: { created: smokeCreated, reverted: smokeReverted, revokedRejected: true, changedDelegateRejected: true },
  };
}

function summarizeDelegatedCosts(observation, proof) {
  const safeQuotes = observation.safes.map(({ gas }) => gas);
  const forkReceipts = [...proof.constructorReceipts, ...proof.publicationReceipts, proof.firstProjectReceipt];
  const observedForkGasUnits = forkReceipts.reduce((sum, receipt) => sum + BigInt(receipt.gasUsed), 0n);
  const baseFees = new Set(safeQuotes.map((quote) => quote?.l2BaseFeeWei));
  const observedL2BaseFeeWei = baseFees.size === 1 ? safeQuotes[0]?.l2BaseFeeWei ?? null : null;
  return {
    estimatedSafesWeiAtObservedBlock: safeQuotes.every(Boolean)
      ? safeQuotes.reduce((sum, quote) => sum + BigInt(quote.estimatedTotalWei), 0n).toString() : null,
    protocolObservedForkGasUnits: observedForkGasUnits.toString(),
    protocolPaidInSyntheticWei: forkReceipts.reduce((sum, { gasUsed, effectiveGasPriceWei }) =>
      sum + BigInt(gasUsed) * BigInt(effectiveGasPriceWei), 0n).toString(),
    observedL2BaseFeeWei,
    protocolForkGasAtObservedL2BaseFeeWei: observedL2BaseFeeWei === null
      ? null : (observedForkGasUnits * BigInt(observedL2BaseFeeWei)).toString(),
    protocolLiveEstimate: "UNAVAILABLE_UNTIL_EXACT_VERIFIED_DEPLOYMENT_INPUTS",
  };
}

export function buildMobileReviewPlan(compilation, input, sources, { observation = null, replay = null, delegatedObservation = null,
  reconstructRecordedObservation = false } = {}) {
  assert.ok(!observation || !delegatedObservation, "Select one account observation mode");
  assert.ok(!delegatedObservation || replay, "A pinned delegated fork rehearsal must accompany the observation");
  assert.ok(!reconstructRecordedObservation || delegatedObservation, "Archived reconstruction requires explicit delegated evidence");
  const archived = verifyExportInputs({ input, ...sources, compiled: compilation.manifest });
  assert.deepEqual(buildBundle(compilation, archived.fork, archived.rawSha256), archived.bundle);
  let replayed = null;
  if (replay) {
    assert.ok(replay.report?.projects?.[0]?.unsigned && replay.report.projects[0]?.creation?.status === "success",
      "Incomplete 4663 replay. The first RMT creation and receipt are required");
    assert.equal(replay.report.report.execution.host, "127.0.0.1");
    assert.equal(replay.report.report.execution.chainId, chainId);
    assert.equal(replay.report.report.execution.fixtureKeys, 0);
    assert.equal(replay.report.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
    replayed = buildBundle(compilation, replay.report, replay.sha256);
    assert.deepEqual(replayed.fixtureOnly.anchor, archived.bundle.fixtureOnly.anchor, "Fork replay did not use the pinned block");
  }
  const fixture = replayed ? { fork: replay.report, rawSha256: replay.sha256, bundle: replayed } : archived;
  const rows = [
    ...safeRows(),
    ...constructorRows(fixture),
    ...governanceRows(fixture, compilation.artifacts.RMTLaunchCurveDirectoryV2.abi, Boolean(replay)),
    projectRow(fixture, replay),
  ];
  const prior = new Set();
  for (const { id, dependsOn } of rows) {
    assert.ok(!prior.has(id) && dependsOn.every((dependency) => prior.has(dependency)), "Incorrect review sequence");
    prior.add(id);
  }
  const delegationProof = delegatedObservation && verifyDelegatedRehearsal(compilation, fixture, rows);
  const delegatedReview = delegatedObservation && delegatedCounterfactual(compilation, delegatedObservation, rows,
    reconstructRecordedObservation ? Date.parse(delegatedObservation.observedAt) : undefined);
  return {
    schemaVersion: 1, status: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false,
    target: { chainId, proposedSender: mobilePayer, senderApproval: "PROPOSED_ONLY",
      productionInputs: fixture.bundle.production, transactions: [],
      observation: observation === null ? null : reviewCurrentMobileObservation(observation),
      ...(delegatedReview && { delegatedReview: { ...delegatedReview, costs: summarizeDelegatedCosts(delegatedReview.observed, delegationProof),
        observationMode: reconstructRecordedObservation ? "ARCHIVED_RECONSTRUCTION_REFRESH_REQUIRED" : "FRESH_READ_ONLY_OBSERVATION" } }) },
    fixture: {
      chainId, scope: "LOOPBACK_FIXTURE_ONLY", profile: fixture.bundle.profile,
      compiler: fixture.bundle.compiler, forkSha256: fixture.rawSha256, anchor: fixture.bundle.fixtureOnly.anchor, rows,
      ...(delegationProof && { delegationProof }),
    },
    terms: { ...fixture.bundle.provisionalTerms, status: "PROVISIONAL_UNAPPROVED" },
    releaseGate: { status: sources.release.staticAnalysis.status, highFindings: sources.release.staticAnalysis.highFindings,
      engineHighFindings: sources.release.staticAnalysis.engineHighFindings,
      dependencyHighFindings: sources.release.staticAnalysis.dependencyHighFindings,
      governanceMediumFindings: sources.release.staticAnalysis.governanceMediumFindings,
      sourceCommit: sources.release.deployableSourceCommit },
  };
}

export function reviewSources() {
  return {
    archive: read("fixed-supply-release/fork-4663.json.gz"),
    release: readJson("fixed-supply-release/release-manifest.json"),
    pinned: readJson("fixed-supply-security/4663-profile.json"),
    savedBundle: read("fixed-supply-release/unsigned-bundle.json"),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: {
    solc: { type: "string" }, lib: { type: "string" }, output: { type: "string" }, verify: { type: "string" },
    observation: { type: "string" }, rehearsal: { type: "string" }, "delegated-observation": { type: "string" },
    "reconstruct-recorded-observation": { type: "boolean" },
  } });
  assert.ok(values.solc, "Supply the pinned compiler with --solc");
  assert.ok(!values.verify || !values.output, "Select either --verify or --output");
  const options = { solc: values.solc, lib: values.lib, chainId };
  const { input } = buildFixedSupplyInput(options);
  const compilation = compileFixedSupplyProfile({ ...options, includeImmutableNames: true });
  const observation = values.observation ? JSON.parse(readFileSync(values.observation)) : null;
  const delegatedObservation = values["delegated-observation"] ? JSON.parse(readFileSync(values["delegated-observation"])) : null;
  const reconstructRecordedObservation = values["reconstruct-recorded-observation"] === true;
  let replay = null;
  if (values.rehearsal) {
    const bytes = readFileSync(values.rehearsal);
    replay = { report: JSON.parse(bytes), sha256: sha256(bytes) };
  }
  const review = buildMobileReviewPlan(compilation, input, reviewSources(), {
    observation, replay, delegatedObservation, reconstructRecordedObservation,
  });
  const result = JSON.stringify(review, null, 2) + "\n";
  if (values.verify) {
    assert.deepEqual(JSON.parse(readFileSync(values.verify)), review, "Checked-in mobile review differs from exact input");
    console.log("Verified " + review.fixture.rows.length + " read-only stages. BLOCKED_NO_BROADCAST");
  } else if (values.output) {
    writeFileSync(resolve(values.output), result, { flag: "wx" });
  } else {
    process.stdout.write(result);
  }
}
