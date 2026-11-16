import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  mobilePayer, reviewCurrentMobileObservation, verifyCreateVacancies,
} from "../../../packages/contracts/scripts/mobile-review-plan.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, getContractAddress, hashTypedData, isAddressEqual, keccak256, parseAbi, zeroAddress } = require("viem");
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const plan = read("review-plan-4663.json");
const bundle = read("../fixed-supply-release/unsigned-bundle.json");
const policy = read("../rmt-task045/operations-safe-policy.json").operations;

test("mobile review follows both Safe proposals, exact constructor order, notice pairs and first RMT project", () => {
  const ordered = ["operations-safe", "reserve-safe", "directory", "registry", "successor-v2", "successor-v3",
    "bootstrap", "schedule-factory", "execute-factory", "schedule-migration-template", "execute-migration-template", "first-rmt"];
  const rows = plan.fixture.rows;
  assert.deepEqual(rows.map(({ id }) => id), ordered);
  for (const [index, row] of rows.entries()) {
    assert.ok(row.dependsOn.every((dependency) => ordered.slice(0, index).includes(dependency)));
  }
  const constructors = rows.slice(2, 7);
  for (const [index, row] of constructors.entries()) {
    const saved = bundle.fixtureOnly.transactions[index];
    assert.ok(isAddressEqual(row.expectedAddress, getContractAddress({ from: row.from, nonce: BigInt(row.nonce) })));
    assert.equal(row.expectedAddress.toLowerCase(), saved.address.toLowerCase());
    assert.equal(row.dataHash, saved.initcodeHash);
    assert.equal(row.details.runtimeHash, saved.runtimeHash);
    assert.equal(row.receiptHash, saved.observedForkReceipt);
  }

  const firstRmt = rows.at(-1);
  assert.equal(firstRmt.details.symbol, "RMT");
  assert.equal(firstRmt.valueWei, bundle.provisionalTerms.creationFeeWei);
  assert.equal(firstRmt.details.initialBackingWei, "0");
  assert.equal(firstRmt.details.supplyWei, "1000000000000000000000000000");
  assert.equal(firstRmt.dataHash, keccak256(bundle.fixtureOnly.firstProject.data));
  assert.equal(firstRmt.expectedAddress, bundle.fixtureOnly.firstProject.token.address);
  assert.equal(firstRmt.receiptHash, bundle.fixtureOnly.firstProject.observesCreation);
});

test("personal payer stays outside Safe ownership and both predicted beneficiaries stay unassigned", () => {
  const safes = plan.fixture.rows.slice(0, 2);
  assert.notEqual(safes[0].expectedAddress, safes[1].expectedAddress);
  assert.notEqual(safes[0].details.saltNonce, safes[1].details.saltNonce);
  assert.notEqual(safes[0].dataHash, safes[1].dataHash);
  for (const safe of safes) {
    assert.equal(safe.from, mobilePayer);
    assert.equal(safe.to, policy.factory);
    assert.equal(safe.details.threshold, 2);
    assert.deepEqual(safe.details.owners, policy.owners);
    assert.ok(safe.details.owners.every((owner) => owner !== mobilePayer));
    assert.equal(safe.details.initialFundingWei, "0");
    assert.equal(safe.details.beneficiaryStatus, "UNASSIGNED");
    assert.equal(safe.nonce, null);
    assert.equal(safe.receiptHash, null);
  }
});

test("governance intent binds exact chain, directory, action and runtime, withholding authorization calldata", () => {
  const [scheduleFactory, executeFactory, scheduleMigration, executeMigration] = plan.fixture.rows.slice(7, 11);
  const abi = parseAbi(["function execute((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline) action)"]);
  for (const [schedule, execute] of [[scheduleFactory, executeFactory], [scheduleMigration, executeMigration]]) {
    const { digest, domain, message, primaryType, types } = schedule.details;
    assert.equal(domain.chainId, 4663);
    assert.equal(domain.verifyingContract, schedule.to);
    assert.equal(message.signerSetEpoch, "1");
    assert.equal(schedule.dataHash, null);
    assert.equal(schedule.details.noticeSeconds, 172800);
    assert.equal(execute.details.digest, digest);
    const typed = { domain, message, primaryType, types };
    assert.equal(hashTypedData(typed), digest);
    assert.notEqual(hashTypedData({ ...typed, domain: { ...domain, chainId: 31337 } }), digest);
    assert.notEqual(hashTypedData({ ...typed, domain: { ...domain, verifyingContract: zeroAddress } }), digest);
    assert.notEqual(hashTypedData({ ...typed, message: { ...message, runtimeHash: "0x" + "ff".repeat(32) } }), digest);
    assert.equal(keccak256(encodeFunctionData({ abi, functionName: "execute", args: [message] })), execute.dataHash);
    assert.equal(execute.details.timing, "ILLUSTRATIVE_FIXTURE_DEADLINE");
    assert.equal(execute.receiptHash, null);
    assert.match(execute.details.archivedNoticeReceipt, /^0x[0-9a-f]{64}$/);
  }
  assert.equal(scheduleFactory.details.message.kind, 0);
  assert.equal(scheduleMigration.details.message.kind, 4);
  assert.equal(scheduleMigration.details.message.nonce, "1");
});

test("public-safe review exposes only transaction digests and leaves executable mainnet inputs empty", () => {
  assert.equal(plan.status, "BLOCKED_NO_BROADCAST");
  assert.equal(plan.broadcastAuthorized, false);
  assert.deepEqual(plan.target.transactions, []);
  assert.deepEqual(plan.target.productionInputs, bundle.production);
  assert.equal(plan.target.observation, null);
  assert.equal(plan.releaseGate.status, "FAIL_HIGH");
  assert.equal(plan.releaseGate.highFindings, 22);
  const keys = (obj) => Object.entries(obj).flatMap(([name, value]) =>
    [name, ...(typeof value === "object" && value !== null ? keys(value) : [])]);
  assert.ok(!keys(plan).some((key) => /^(data|calldata|initcode|bytecode|constructorData|signature|signatures|rawTransaction)$/i.test(key)));
});

function vacancies() {
  return {
    sender: mobilePayer, confirmedNonce: "11", pendingNonce: "11",
    destinations: Array.from({ length: 5 }, (_, index) => ({
      address: getContractAddress({ from: mobilePayer, nonce: 13n + BigInt(index) }),
      deploymentNonce: String(13 + index), accountNonce: "0", code: "0x",
    })),
  };
}

test("constructor predictions consume both Safe-stage nonces using the proposed sender only", () => {
  assert.deepEqual(verifyCreateVacancies(vacancies()).map(({ nonce }) => nonce), ["13", "14", "15", "16", "17"]);
});

test("nonce drift, overflow, wrong sender, malformed nonce, wrong address and occupied CREATE destinations fail closed", () => {
  const valid = vacancies();
  for (const mutation of [
    { pendingNonce: "12" }, { pendingNonce: "011" }, { pendingNonce: -1 }, { sender: zeroAddress },
    { confirmedNonce: "18446744073709551615", pendingNonce: "18446744073709551615" },
    { destinations: [] },
    { destinations: valid.destinations.map((row) => ({ ...row, code: "0x00" })) },
    { destinations: valid.destinations.map((row) => ({ ...row, address: zeroAddress })) },
    { destinations: valid.destinations.map((row) => ({ ...row, accountNonce: "1" })) },
  ]) assert.throws(() => verifyCreateVacancies({ ...valid, ...mutation }));
  assert.throws(() => reviewCurrentMobileObservation({ status: "READY", broadcastAuthorized: true }));
});

test("code-empty synthetic proof yields sanitized metadata only, while the observed delegated payer is blocked", () => {
  const archived = read("sender-observation-4663.json");
  const time = Date.parse(archived.observedAt);
  assert.throws(() => reviewCurrentMobileObservation(archived, time), /code-empty account/);
  const synthetic = structuredClone(archived);
  synthetic.sender.accountType = "CODE_EMPTY";
  for (const provider of synthetic.sender.providers) provider.code = "0x";
  const pending = BigInt(synthetic.sender.pendingNonce);
  synthetic.sender.createDestinations = Array.from({ length: 5 }, (_, index) => {
    const deploymentNonce = pending + 2n + BigInt(index);
    return {
      address: getContractAddress({ from: mobilePayer, nonce: deploymentNonce }),
      deploymentNonce: deploymentNonce.toString(), accountNonce: "0", code: "0x", status: "VACANT",
      providers: synthetic.sender.providers.map(({ name }) => ({ name, code: "0x", nonce: "0" })),
    };
  });
  synthetic.safes.proposals[0].estimateStatus = "do not copy unvalidated text";
  const sanitized = reviewCurrentMobileObservation(synthetic, time);
  assert.equal(sanitized.observedSignerControl, "UNVERIFIED");
  assert.equal(sanitized.confirmedNonce, synthetic.sender.confirmedNonce);
  assert.equal(sanitized.createDestinations[0].nonce, (pending + 2n).toString());
  assert.equal(sanitized.safes[0].estimateStatus, "ESTIMATED_AT_OBSERVED_BLOCK");
  assert.ok(sanitized.createDestinations.every((item) => item.status === "VACANT_AT_OBSERVED_BLOCK_ONLY"));
  assert.ok(!JSON.stringify(sanitized).includes("do not copy unvalidated text"));
  assert.throws(() => reviewCurrentMobileObservation(synthetic, time + 121_000), /Stale/);
});
