import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pinnedSafeCreationRows } from "../../../packages/contracts/scripts/mobile-review-plan.mjs";
import { approvedFirstProject, approvedRmtTerms, assertApprovedLaunchTerms, assertApprovedOperationsFees, assertApprovedProjectRehearsal, assertFreshUnsignedBinding,
  assertUnsignedDependencyEvidence, assertUnsignedGovernanceEvidence, buildFirstProject, privateOutputPath }
  from "../../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
import { termEvidence } from "../../../packages/contracts/scripts/fixed-supply-profile.mjs";
import { deriveFutureCreateDestinations } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { approvedOperationsFeeCap, operationsFeeApprovalSource, operationsSafePolicyApprovalSource }
  from "../../../packages/contracts/scripts/prepare-operations-safe.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, zeroAddress, zeroHash } = require("viem");
const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const recorded = read("sender-delegation-4663.json");
const now = Date.parse(recorded.observedAt) + 1_000;
const next = () => ({ ...structuredClone(recorded), observedAt: new Date(now).toISOString(),
  expiresAt: new Date(Date.parse(recorded.expiresAt) + 1_000).toISOString() });

test("unsigned package binds two current observations and rejects staleness, reuse and nonce drift", () => {
  const later = next();
  assert.equal(assertFreshUnsignedBinding(recorded, later, now).pendingNonce, recorded.sender.pendingNonce);
  assert.throws(() => assertFreshUnsignedBinding(recorded, recorded, now), /independent later/);
  assert.throws(() => assertFreshUnsignedBinding(recorded, later, now + 121_000), /Stale/);
  const changed = (BigInt(recorded.sender.pendingNonce) + 1n).toString();
  later.sender.confirmedNonce = changed;
  later.sender.pendingNonce = changed;
  for (const provider of later.sender.providers) {
    for (const field of ["pendingBefore", "pendingAfter", "confirmedNonce"]) {
      if (provider[field] !== undefined) provider[field] = changed;
    }
  }
  later.sender.createDestinations = deriveFutureCreateDestinations(changed)
    .map((destination, i) => ({ ...later.sender.createDestinations[i], ...destination }));
  assert.throws(() => assertFreshUnsignedBinding(recorded, later, now), /nonce drift/);
});

test("dependency attestation must match the exact sender anchor and frozen runtime pins", () => {
  const { externalRuntimePins } = read("../fixed-supply-security/4663-profile.json");
  const evidence = { scope: "READ_ONLY_4663_DEPENDENCY_BINDING", chainId: 4663, broadcastAuthorized: false,
    anchor: recorded.sender.anchor, expiresAt: recorded.expiresAt, status: "CORROBORATED",
    providers: ["official", "pocket"], runtimePins: externalRuntimePins };
  assert.equal(assertUnsignedDependencyEvidence(evidence, recorded, externalRuntimePins, now), evidence);
  for (const invalid of [
    { status: "UNVERIFIED" }, { chainId: 31337 }, { broadcastAuthorized: true }, { providers: ["pocket", "pinax"] },
    { providers: ["official", "official"] }, { expiresAt: recorded.observedAt }, { runtimePins: [] },
    { anchor: { ...evidence.anchor, number: "1" } },
  ]) assert.throws(() => assertUnsignedDependencyEvidence({ ...evidence, ...invalid }, recorded, externalRuntimePins, now));
});

test("governance evidence requires all three exact accounts code-empty on both pinned providers and the same block", () => {
  const { owners } = pinnedSafeCreationRows()[0].details;
  const anchor = recorded.sender.anchor;
  const evidence = { status: "ELIGIBLE_AT_PINNED_BLOCK", anchor: { ...anchor, timestamp: anchor.blockTimeUtc },
    wallets: owners.map((address) => ({ address, codeState: "EMPTY", codes: { official: "0x", pinax: "0x" },
      keyControl: "UNVERIFIED", policyEligible: true })) };
  assert.equal(assertUnsignedGovernanceEvidence(evidence, anchor, owners), evidence);
  for (const replacement of [
    { policyEligible: false }, { codeState: "EIP_7702_DELEGATION" }, { codes: { official: "0x", pinax: "0x01" } },
    { codes: { official: "0x" } }, { keyControl: "PRESUMED" }, { address: owners[1] },
  ]) {
    const changed = [{ ...evidence.wallets[0], ...replacement }, ...evidence.wallets.slice(1)];
    assert.throws(() => assertUnsignedGovernanceEvidence({ ...evidence, wallets: changed }, anchor, owners));
  }
  assert.throws(() => assertUnsignedGovernanceEvidence({ ...evidence, anchor: { ...evidence.anchor, number: "1" } },
    anchor, owners));
});

test("only explicitly private Safe rows contain exact initializer calldata", () => {
  const publicRows = pinnedSafeCreationRows();
  const privateRows = pinnedSafeCreationRows({ includePrivateCalldata: true });
  const abi = parseAbi(["function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns(address proxy)"]);
  assert.notEqual(privateRows[0].expectedAddress, privateRows[1].expectedAddress);
  for (const [index, { calldata, ...row }] of privateRows.entries()) {
    assert.deepEqual(publicRows[index], row);
    assert.equal(keccak256(calldata), row.dataHash);
    const { functionName, args: [singleton, initializer, saltNonce] } = decodeFunctionData({ abi, data: calldata });
    assert.equal(functionName, "createProxyWithNonce");
    assert.equal(singleton.toLowerCase(), row.details.singleton.toLowerCase());
    assert.equal(keccak256(initializer), row.details.initializerHash);
    assert.equal(saltNonce, BigInt(row.details.saltNonce));
    assert.equal(row.details.threshold, 2);
    assert.equal(row.details.owners.length, 3);
    assert.equal(row.details.beneficiaryStatus, "UNASSIGNED");
  }
});

test("owner-approved fee terms match the frozen 4663 compile profile and v4 pool fee", () => {
  const file = "src/RMTV4CurveGraduationV1.sol";
  const content = readFileSync(new URL("../../../packages/contracts/" + file, import.meta.url), "utf8");
  const compileInput = (source) => JSON.stringify({ sources: { [file]: { content: source } } });
  assert.doesNotThrow(() => assertApprovedLaunchTerms(compileInput(content), termEvidence));
  assert.throws(() => assertApprovedLaunchTerms(compileInput(content.replace("POOL_FEE = 3_000;", "POOL_FEE = 3_001;")),
    termEvidence), /compiled v4 pool fee/);
  assert.throws(() => assertApprovedLaunchTerms(compileInput(content), { ...termEvidence, creationFeeWei: "0" }), /compiled terms/);
  assert.equal(approvedRmtTerms.v4PoolFeeBps, 30);
});

test("the combined package preserves every approved Operations fee limit and requires the standalone pending recheck", () => {
  const quote = { nitroGasEstimate: "313391", rpcEstimateGas: "313391", l2BaseFeeWei: "20000000" };
  const binding = assertApprovedOperationsFees(quote);
  assert.deepEqual(binding.feeCap, approvedOperationsFeeCap);
  assert.equal(binding.policyApproval, operationsSafePolicyApprovalSource);
  assert.equal(binding.feeApproval, operationsFeeApprovalSource);
  assert.equal(binding.signingReviewEligible, false);
  assert.equal(binding.transactionApproval, null);
  assert.match(binding.prerequisite, /fresh canonical and pending vacancy/);
  for (const change of [
    { nitroGasEstimate: "313392" }, { rpcEstimateGas: "313392" }, { l2BaseFeeWei: "20010001" },
    { nitroGasEstimate: "0" }, { rpcEstimateGas: "NaN" }, { l2BaseFeeWei: "-1" },
  ]) assert.throws(() => assertApprovedOperationsFees({ ...quote, ...change }));
});

test("approved RMT configuration binds exactly the owner and zero treasury without authorizing a live creation", () => {
  const safeAddresses = pinnedSafeCreationRows().map(({ expectedAddress }) => expectedAddress);
  const project = buildFirstProject(safeAddresses);
  assert.deepEqual(approvedFirstProject, {
    name: "RMT", symbol: "RMT", projectURI: "", creator: recorded.proposedSender, treasuryShareBpsOfEligibleFees: 0,
  });
  assert.equal(project.projectShareRecipient, recorded.proposedSender);
  assert.equal(project.projectTreasury, zeroAddress);
  assert.equal(project.scope, "OWNER_APPROVED_WEBSITE_DEFAULTS_ONLY");
  assert.equal(project.method, "ORDINARY_WEBSITE_CREATOR_INTERFACE");
  assert.equal(project.path, "/create-token");
  assert.equal(project.creationEnabled, false);
  assert.equal(project.tokenAddress, null);
  assert.deepEqual(project.terms, approvedRmtTerms);
  assert.equal(project.prerequisites.length, 3);
  assert.doesNotMatch(JSON.stringify(project), /plannedCall|intentId|calldata|predictedFactory|nonce/);
  assert.deepEqual(project.revenueRecipients, {
    operations: { predictedAddress: safeAddresses[0], beneficiary: null },
    reserve: { predictedAddress: safeAddresses[1], beneficiary: null },
  });
  assert.equal(project.transactionApproval, null);
});

test("production preparation requires approved configuration in the full synthetic rehearsal", () => {
  const [operations, reserve] = pinnedSafeCreationRows().map(({ expectedAddress }) => expectedAddress);
  const factory = "0x0000000000000000000000000000000000000001";
  const curve = "0x0000000000000000000000000000000000000002";
  const mockHash = "0x" + "f".repeat(64);
  const receipt = { status: "success", from: approvedFirstProject.creator, calldataHash: mockHash, transactionHash: mockHash };
  const abi = parseAbi(["function create(string,string,string,address,uint16,bytes32,uint256) payable returns (address,address)"]);
  const exactCreationCalldataHash = keccak256(encodeFunctionData({ abi, functionName: "create",
    args: ["RMT", "RMT", "", zeroAddress, 0, mockHash, 1n] }));
  const proof = {
    scope: "SYNTHETIC_APPROVED_FIRST_RMT", broadcastAuthorized: false, rollbackVerified: true,
    project: approvedFirstProject, factory, curve, operations, reserve, erc20RuntimeHash: mockHash,
    exactCreationFeeWei: approvedRmtTerms.creationFeeWei, intentId: mockHash, deadline: "1", curveTradeFeeWei: "20",
    creation: { ...receipt, to: factory, valueWei: approvedRmtTerms.creationFeeWei, calldataHash: exactCreationCalldataHash },
    buy: { ...receipt, to: curve },
    curveFeeCreditsWei: ["18", "0", "1", "1"],
  };
  const report = { approvedFirstRmt: proof, deployment: { factory }, delegatedSender: { phase: "LIFECYCLE_REHEARSED" } };
  assert.equal(assertApprovedProjectRehearsal(report, [operations, reserve], mockHash), proof);
  for (const changed of [
    undefined,
    { ...proof, rollbackVerified: false },
    { ...proof, project: { ...approvedFirstProject, projectURI: "https://example.test" } },
    { ...proof, project: { ...approvedFirstProject, treasuryShareBpsOfEligibleFees: 1 } },
    { ...proof, operations: reserve },
    { ...proof, creation: { ...receipt, to: factory, valueWei: "0" } },
    { ...proof, creation: { ...proof.creation, calldataHash: mockHash } },
    { ...proof, intentId: zeroHash },
    { ...proof, deadline: "2" },
    { ...proof, curveTradeFeeWei: "21" },
    { ...proof, curveFeeCreditsWei: ["17", "1", "1", "1"] },
  ]) assert.throws(() => assertApprovedProjectRehearsal({ ...report, approvedFirstRmt: changed }, [operations, reserve], mockHash));
});

test("the generator requires fresh absolute paths outside source control", (context) => {
  const outside = mkdtempSync(join(tmpdir(), "rmt-unsigned-path-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const newOutput = join(outside, "unsigned.json");
  context.after(() => {
    rmSync(newOutput, { force: true });
    rmSync(join(outside, ".git"), { force: true });
    rmdirSync(outside);
  });
  assert.throws(() => privateOutputPath("unsigned.json"), /absolute/);
  assert.throws(() => privateOutputPath(join(root, "unsigned.json")), /outside the checkout/);
  assert.equal(privateOutputPath(newOutput), newOutput);
  assert.equal(existsSync(newOutput), false);
  writeFileSync(newOutput, "existing");
  assert.throws(() => privateOutputPath(newOutput), /fresh/);
  writeFileSync(join(outside, ".git"), "simulated Git worktree marker");
  assert.throws(() => privateOutputPath(join(outside, "another.json")), /outside Git worktrees/);
});
