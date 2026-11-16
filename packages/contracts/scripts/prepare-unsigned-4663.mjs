import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { governance } from "../../../docs/evidence/rmt-task043/compile-rotation-profile.mjs";
import { normalizeGovernanceWallets, observeGovernanceWallets, proposals }
  from "../../../docs/evidence/rmt-task044/governance-wallets.mjs";
import { runMobileSenderProbe } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { attestDeploymentDependencies, makeReadOnlyRpc, ROBINHOOD_SOURCES } from "../../../scripts/production-readiness/rpc.mjs";
import { deriveDelegatedConstructors } from "./delegated-mobile-constructors.mjs";
import { buildFixedSupplyInput, compileFixedSupplyProfile, rmtFixture, termEvidence } from "./fixed-supply-profile.mjs";
import { buildMobileReviewPlan, mobilePayer, pinnedSafeCreationRows, reviewDelegatedMobileObservation, reviewSources,
  safeProxyRuntimeHash } from "./mobile-review-plan.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { getAddress, isAddressEqual, keccak256, toHex, zeroAddress } = require("viem");
const repository = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) => "0x" + sha256(JSON.stringify(value));
const gate = "BLOCKED_NO_BROADCAST";
const profile = "rmt-curve-fixed-supply-security-v2";
const chainId = 4663;
const provedOwnerConnection = "OWNER_REPORTED_READ_ONLY_ON_PHYSICAL_IPHONE";

const approvals = [
  { id: "treasuries", label: "Approve the two CREATE2 salts, this payer, and treasury transaction bounds" },
  { id: "economics", label: "Approve the proposed immutable launch economics" },
  { id: "protocol-deployment", label: "Approve protocol deployment after verified Safe receipts and security clearance" },
  { id: "first-project", label: "Approve actual name, symbol, metadata URI, creator, treasury and allocation for the first RMT project" },
  { id: "funded-acceptance", label: "Authorize first funded acceptance with a separately approved transaction" },
  { id: "public-activation", label: "Authorize public activation after verified infrastructure and funded acceptance" },
].map((item) => ({ ...item, status: "UNASSIGNED" }));

const terms = Object.freeze({
  fixedSupplyTokens: "1000000000", decimals: termEvidence.decimals, curveTokens: "600000000", liquidityTokens: "400000000",
  projectShareBps: termEvidence.projectBps, operationsShareBps: termEvidence.operationsBps, reserveShareBps: termEvidence.reserveBps,
  creationFeeWei: termEvidence.creationFeeWei, graduationBackingWei: termEvidence.graduationBackingWei,
  curveFeeBps: termEvidence.tradingFeeBps,
});

const stopOnDrift = "Stop if the payer, chain, pending nonce, delegation runtime, fees, input hash or approved destination differs";
const receiptRule = "Check the canonical receipt and the exact transaction sender, nonce, type, destination, value and input hash before advancing";
const protocolReceipt = "Confirm the derived CREATE address and the exact materialized runtime hash";
const treasuryReceipt = "Verify the canonical Safe ProxyCreation, runtime, singleton, owners, 2-of-3 threshold, fallback handler, modules and guard";

export function assertFreshUnsignedBinding(first, second, nowMs = Date.now()) {
  const before = reviewDelegatedMobileObservation(first, nowMs);
  const after = reviewDelegatedMobileObservation(second, nowMs);
  assert.ok(Date.parse(after.observedAt) > Date.parse(before.observedAt), "An independent later observation is required");
  assert.equal(after.pendingNonce, before.pendingNonce, "Sender nonce drift invalidates every prepared transaction");
  assert.ok(BigInt(after.anchor.number) >= BigInt(before.anchor.number), "Later observation moved backwards");
  if (after.anchor.number === before.anchor.number) assert.equal(after.anchor.hash, before.anchor.hash, "Anchor changed at same height");
  assert.deepEqual(after.delegation, before.delegation, "Wallet delegation drift invalidates the plan");
  assert.deepEqual(after.createDestinations, before.createDestinations, "Predicted CREATE destinations changed");
  return after;
}

export function assertUnsignedDependencyEvidence(evidence, observation, expectedPins, nowMs = Date.now()) {
  assert.equal(evidence.scope, "READ_ONLY_4663_DEPENDENCY_BINDING");
  assert.equal(evidence.status, "CORROBORATED", "Protocol dependency evidence is unavailable or contradictory");
  assert.equal(evidence.chainId, chainId);
  assert.equal(evidence.broadcastAuthorized, false);
  assert.deepEqual(evidence.anchor, observation.sender.anchor, "Protocol evidence is bound to a different block");
  assert.ok(evidence.providers.includes("official") && new Set(evidence.providers).size >= 2);
  assert.ok(Date.parse(evidence.expiresAt) >= nowMs, "Protocol dependency evidence is stale");
  assert.deepEqual(evidence.runtimePins, expectedPins);
  return evidence;
}

async function recheckGovernanceAt(anchor) {
  const read = Object.fromEntries(["official", "pinax"].map((name) => {
    const provider = makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] });
    return [name, async (method, params) => {
      const result = await provider(method, params);
      assert.equal(result.status, "observed", "Governance provider unavailable");
      return result.value;
    }];
  }));
  return observeGovernanceWallets({ read, wallets: normalizeGovernanceWallets(proposals, getAddress),
    blockNumber: BigInt(anchor.number), expectedHash: anchor.hash });
}

export function assertUnsignedGovernanceEvidence(evidence, anchor, expectedOwners) {
  assert.equal(evidence.status, "ELIGIBLE_AT_PINNED_BLOCK", "Governance wallets are not eligible at the observed block");
  assert.equal(evidence.anchor.number, anchor.number);
  assert.equal(evidence.anchor.hash, anchor.hash);
  assert.equal(Date.parse(evidence.anchor.timestamp), Date.parse(anchor.blockTimeUtc));
  assert.deepEqual(evidence.wallets.map(({ address }) => address), expectedOwners);
  for (const { address, codeState, codes, policyEligible, keyControl } of evidence.wallets) {
    assert.ok(BigInt(address) > 0xffffn, "Governance address is reserved");
    assert.equal(policyEligible, true);
    assert.equal(codeState, "EMPTY", "Governance address has code");
    assert.deepEqual(codes, { official: "0x", pinax: "0x" }, "Governance account code is not independently corroborated");
    assert.equal(keyControl, "UNVERIFIED");
  }
  return evidence;
}

function firstProject(safeAddresses) {
  return {
    proposedName: rmtFixture.name,
    proposedSymbol: rmtFixture.symbol,
    approvedName: null,
    approvedSymbol: null,
    approvedProjectUri: null,
    creator: null,
    projectTreasury: null,
    treasuryShareBpsOfEligibleFees: null,
    termsApproval: null,
    treasuryRecipients: { operations: safeAddresses[0], reserve: safeAddresses[1], verified: false },
    allocationBasis: "Treasury BPS use eligible fees as denominator, from 0 to 9000. 9000 means 100% of the project allocation. Zero allocation if and only if no treasury. Creator and treasury must differ.",
    tokenIntent: null,
    deadline: null,
  };
}

function makeReviewRow(item, action, gas, status, checks, expectedRuntimeHash = null) {
  const { id, label, dependsOn, sender, nonce, destination, predictedAddress, valueWei, inputHash } = item;
  return { id, label, dependsOn, sender, nonce, destination, predictedAddress, valueWei, inputHash,
    action, status, gas, checks, expectedRuntimeHash };
}

function privateEnvelope(item, input) {
  assert.equal(keccak256(input), item.inputHash, "Exact unsigned input mismatch: " + item.id);
  // Fee/limit fields stay separate from these incomplete type-2 review inputs.
  return {
    id: item.id,
    unsignedFields: { type: "0x2", chainId: toHex(chainId), from: item.sender,
      ...(item.destination !== null && { to: item.destination }),
      nonce: toHex(BigInt(item.nonce)), value: toHex(BigInt(item.valueWei)), data: input },
    gasLimit: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  };
}

function forkGas(receipt) {
  return { gasUnits: receipt.gasUsed, l2GasUnits: null, l1PosterGasUnits: null, estimatedFeeWei: null,
    provenance: "SYNTHETIC_4663_FORK_GAS_USED_ONLY" };
}

function actionTemplate({ observed, constructors, kind, contract, version }) {
  return {
    typedDataDomain: { ...governance.directory.domain, chainId,
      verifyingContract: constructors[0].address },
    typedDataAction: governance.directory.action,
    kind, version, factory: contract.address, runtimeHash: contract.runtimeHash,
    nonce: null, signerSetEpoch: null, deadline: null, scheduledDigest: null, executeAfter: null, executeBy: null,
    outerSender: observed,
    requiredSigners: governance.quorum, noticeSeconds: governance.noticeSeconds,
    maxExecutionWindowSeconds: governance.maximumExecutionWindowSeconds,
  };
}

function codeIdentity(compilation, constructor) {
  const { contract, address, constructorData, initcodeHash, runtimeHash, initcodeBytes, runtimeBytes,
    initcodeHeadroom, runtimeHeadroom, hookPermissionBits, create2Salt } = constructor;
  return { contract: compilation.manifest.templates[contract].file + ":" + contract, address, constructorArguments: constructorData,
    initcodeHash, runtimeHash, initcodeBytes, runtimeBytes, initcodeHeadroom, runtimeHeadroom,
    ...(hookPermissionBits && { hookPermissionBits, create2Salt }) };
}

export function prepareUnsignedDeployment({ compilation, input, rehearsal, firstObservation, secondObservation,
  bindingSource = "FRESH_SUPPLIED_READ_ONLY_RECHECKS", dependencyEvidence, governanceEvidence }) {
  const observed = assertFreshUnsignedBinding(firstObservation, secondObservation);
  assert.equal(compilation.manifest.profile, profile);
  assertUnsignedDependencyEvidence(dependencyEvidence, secondObservation, compilation.manifest.externalRuntimePins);
  const prior = buildMobileReviewPlan(compilation, input, reviewSources(), {
    replay: rehearsal, delegatedObservation: secondObservation,
  });
  const scenario = prior.target.delegatedReview;
  const proof = prior.fixture.delegationProof;
  assert.deepEqual(scenario.observed, observed);
  assert.equal(prior.releaseGate.highFindings, 22);
  assert.equal(prior.releaseGate.governanceMediumFindings, 7);
  assert.equal(prior.releaseGate.status, "FAIL_HIGH");
  const safes = pinnedSafeCreationRows({ includePrivateCalldata: true });
  assertUnsignedGovernanceEvidence(governanceEvidence, secondObservation.sender.anchor, safes[0].details.owners);
  const safeAddresses = safes.map(({ expectedAddress }) => expectedAddress);
  assert.ok(safeAddresses.every((address) => !isAddressEqual(address, mobilePayer) && !isAddressEqual(address, zeroAddress)));
  const { constructors, bootstrapChildren } = deriveDelegatedConstructors(compilation, {
    sender: mobilePayer, createDestinations: observed.createDestinations,
    signers: scenario.governanceSignerProposal, safeAddresses,
  }, { includePrivateInitcode: true });
  const reviewRows = [];
  const privateRows = [];
  for (const [index, item] of scenario.rows.entries()) {
    if (index < 2) {
      const safe = safes[index];
      const { owners, safeProfile, threshold, singleton, fallbackHandler, saltNonce, create2Salt, initializerHash } = safe.details;
      const { nitroGasEstimate, l2GasUnits, l1PosterGasUnits, estimatedTotalWei } = item.estimate;
      const checks = [stopOnDrift, "Recheck the exact pinned Safe infrastructure and vacancy before separate treasury approval",
        `${safeProfile}, ${threshold} of ${owners.length}. Owners ${owners.join(", ")}`,
        "All three proposed governance addresses were code-empty at the observed block. Owner key control is unverified.",
        `Salt nonce ${saltNonce}. CREATE2 salt ${create2Salt}`,
        `Initializer hash ${initializerHash}`,
        `Singleton ${singleton}. Fallback handler ${fallbackHandler}`,
        receiptRule, treasuryReceipt, "Keep the predicted Safe address outside beneficiary configuration until its receipt is verified"];
      if (!secondObservation.safes.budgetAtObservation) checks.push("The observed payer balance was below the combined Safe estimate");
      reviewRows.push(makeReviewRow(item, "createProxyWithNonce(address,bytes,uint256)", {
        gasUnits: nitroGasEstimate, l2GasUnits, l1PosterGasUnits, estimatedFeeWei: estimatedTotalWei,
        provenance: "CURRENT_4663_READ_ONLY_NITRO_GAS_COMPONENTS",
      }, "UNSIGNED_TREASURY_APPROVAL_REQUIRED", checks, safeProxyRuntimeHash));
      privateRows.push({ ...privateEnvelope(item, safe.calldata), setup: safe.details,
        gasAtObservedBlock: item.estimate, syntheticReceipt: proof.safeReceipts[index] });
    } else if (index < 7) {
      const candidate = constructors[index - 2];
      assert.equal(item.inputHash, candidate.initcodeHash);
      assert.equal(item.runtimeHash, candidate.runtimeHash);
      reviewRows.push(makeReviewRow(item, candidate.contract + " constructor", forkGas(proof.constructorReceipts[index - 2]),
        "CONDITIONAL_VERIFIED_SAFE_RECEIPTS_AND_PROTOCOL_APPROVAL_REQUIRED",
        [stopOnDrift, "Bind both verified Safe receipts and approved economics before protocol approval", receiptRule,
          protocolReceipt, ...(item.id === "bootstrap" ? ["Verify all three bootstrap children, hook permission bits and pinned Uniswap runtimes"] : [])],
        candidate.runtimeHash));
      privateRows.push({ ...privateEnvelope(item, candidate.initcode), candidate: codeIdentity(compilation, candidate),
        syntheticReceipt: proof.constructorReceipts[index - 2],
        condition: "PREDICTED_SAFE_ADDRESSES_REQUIRE_VERIFIED_RECEIPTS_AND_PROTOCOL_APPROVAL" });
    } else if (index < 11) {
      const schedule = index % 2 === 1;
      reviewRows.push(makeReviewRow(item, schedule ? "schedule(Action,bytes,bytes)" : "execute(Action)",
        forkGas(proof.publicationReceipts[index - 7]),
        schedule ? "AWAITING_BOUND_CURRENT_GOVERNANCE_SIGNATURES" : "AWAITING_CANONICAL_SCHEDULE_AND_MATURE_NOTICE",
        [stopOnDrift, schedule ? "Bind exact runtime, directory EIP-712 domain, signer epoch, action nonce and deadline before two current signatures"
          : "Confirm the matching canonical scheduled action and enforce its two-day notice and execution deadline",
        receiptRule, "Confirm the exact publication event before moving to the next Directory action"]));
    } else {
      reviewRows.push(makeReviewRow(item, "create(string,string,string,address,uint16,bytes32,uint256)",
        forkGas(proof.firstProjectReceipt), "AWAITING_FIRST_PROJECT_INPUTS_AND_FUNDED_ACCEPTANCE",
        [stopOnDrift, "Bind the real creator, name, symbol, metadata URI, treasury allocation, intent and deadline",
          receiptRule, "Verify the created token and curve, registry row, exact creation fee and beneficiary policy on the canonical receipt"]));
    }
  }
  const noncePair = { pendingNonce: observed.pendingNonce, confirmedNonce: observed.confirmedNonce };
  const summary = {
    schemaVersion: 1, scope: "RMT_4663_UNSIGNED_PRIVATE_REVIEW", status: gate, broadcastAuthorized: false, chainId, sender: mobilePayer,
    observedAt: observed.observedAt, expiresAt: new Date(Math.min(Date.parse(firstObservation.expiresAt), Date.parse(observed.expiresAt),
      Date.parse(dependencyEvidence.expiresAt))).toISOString(), anchor: observed.anchor, ...noncePair,
    balanceWei: observed.balanceWei, delegation: { address: observed.delegation.address, runtimeHash: observed.delegation.runtimeHash,
      designator: observed.delegation.designator },
    rows: reviewRows, terms, approvals,
  };
  const protectedCandidate = {
    bindingSource, walletConnection: provedOwnerConnection, signingAcceptance: "UNVERIFIED",
    initialObservationDigest: digest(firstObservation), recheckObservationDigest: digest(secondObservation),
    observations: { before: firstObservation, recheck: secondObservation },
    noncePair, compiler: prior.fixture.compiler, releaseGate: prior.releaseGate, forkSha256: prior.fixture.forkSha256,
    dependencyEvidenceDigest: digest(dependencyEvidence), dependencyAttestation: dependencyEvidence,
    governanceEvidenceDigest: digest(governanceEvidence), governanceAttestation: governanceEvidence,
    costs: { ...scenario.costs, safeBudgetAtObservation: secondObservation.safes.budgetAtObservation,
      protocolPosterCost: "UNAVAILABLE_FOR_DEPENDENT_CREATIONS_AND_UNAPPROVED_ACTIONS",
      protocolModel: "Synthetic EVM gas times observed L2 base fee, excluding any L1 poster fee. No production fee caps are assigned." },
    sourceVerification: {
      standardInputSha256: compilation.manifest.inputSha256,
      contracts: [...constructors, ...bootstrapChildren].map((item) => codeIdentity(compilation, item)),
      externalRuntimePins: compilation.manifest.externalRuntimePins,
      readiness: "POST_DEPLOYMENT_CANONICAL_RECEIPTS_AND_EXACT_RUNTIME_REQUIRED",
    },
    unsigned: privateRows,
    directoryTemplates: [
      actionTemplate({ observed: null, constructors, kind: 0, contract: bootstrapChildren[2], version: 1 }),
      actionTemplate({ observed: null, constructors, kind: 4, contract: constructors[3], version: 3 }),
    ],
    firstProject: firstProject(safeAddresses),
    recovery: "Leave an unresolved original transaction pending and resolve its canonical hash/receipt. Never submit a replacement or advance from an unknown result.",
  };
  const planId = digest({ summary, protectedCandidate });
  assertFreshUnsignedBinding(firstObservation, secondObservation);
  assertUnsignedDependencyEvidence(dependencyEvidence, secondObservation, compilation.manifest.externalRuntimePins);
  return { review: { ...summary, planId }, privatePackage: {
    schemaVersion: 1, scope: "RMT_4663_PRIVATE_INCOMPLETE_UNSIGNED_PACKAGE", status: gate, broadcastAuthorized: false, planId,
    review: { ...summary, planId }, ...protectedCandidate,
  } };
}

export function privateOutputPath(file, repositoryRoot = repository) {
  assert.ok(typeof file === "string" && isAbsolute(file), "Use an absolute output path outside the checkout");
  const parent = realpathSync(dirname(resolve(file)));
  const relativeParent = relative(repositoryRoot, parent);
  assert.ok(relativeParent.startsWith(".." + sep) || relativeParent === ".." || isAbsolute(relativeParent),
    "Keep private and review files outside the checkout");
  for (let ancestor = parent; ; ancestor = dirname(ancestor)) {
    assert.ok(!existsSync(join(ancestor, ".git")), "Keep private and review files outside Git worktrees");
    if (ancestor === dirname(ancestor)) break;
  }
  const result = join(parent, basename(file));
  assert.ok(!existsSync(result), "Output path must be fresh");
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let stage = "checking arguments and private output paths";
  try {
    const { values } = parseArgs({ options: {
      solc: { type: "string" }, lib: { type: "string" }, rehearsal: { type: "string" },
      refresh: { type: "boolean" }, observation: { type: "string" }, "observation-after": { type: "string" },
      "out-private": { type: "string" }, "out-review": { type: "string" },
    } });
    assert.ok(values.solc && values.rehearsal, "Supply --solc and --rehearsal from the synthetic --delegated 4663 fork");
    assert.ok(values.refresh
      ? !values.observation && !values["observation-after"]
      : values.observation && values["observation-after"], "Supply --refresh or two current read-only observations");
    const privateOutput = privateOutputPath(values["out-private"]);
    const reviewOutput = privateOutputPath(values["out-review"]);
    assert.notEqual(process.platform === "win32" ? privateOutput.toLowerCase() : privateOutput,
      process.platform === "win32" ? reviewOutput.toLowerCase() : reviewOutput, "Use two separate outputs");
    stage = "compiling the frozen 4663 closure";
    const options = { solc: values.solc, lib: values.lib, chainId };
    const { input } = buildFixedSupplyInput(options);
    const compilation = compileFixedSupplyProfile({ ...options, includeImmutableNames: true });
    stage = "reading synthetic fork evidence";
    const replay = readFileSync(values.rehearsal);
    const rehearsal = { report: JSON.parse(replay), sha256: sha256(replay) };
    stage = "corroborating two fresh wallet and Safe observations";
    const firstObservation = values.refresh ? await runMobileSenderProbe({ allowPinnedDelegation: true })
      : JSON.parse(readFileSync(values.observation));
    const secondObservation = values.refresh ? await runMobileSenderProbe({ allowPinnedDelegation: true })
      : JSON.parse(readFileSync(values["observation-after"]));
    assertFreshUnsignedBinding(firstObservation, secondObservation);
    stage = "checking the pinned production dependencies and governance account eligibility";
    const anchor = secondObservation.sender.anchor;
    const [dependencyEvidence, governanceEvidence] = await Promise.all([
      attestDeploymentDependencies(anchor), recheckGovernanceAt(anchor),
    ]);
    stage = "materializing and validating the unsigned deployment";
    const packageOutput = prepareUnsignedDeployment({ compilation, input, rehearsal, firstObservation, secondObservation,
      bindingSource: values.refresh ? "DIRECT_READ_ONLY_RPC_RECHECKS" : "FRESH_SUPPLIED_READ_ONLY_RECHECKS",
      dependencyEvidence, governanceEvidence });
    stage = "writing private local files";
    writeFileSync(privateOutput, JSON.stringify(packageOutput.privatePackage, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    writeFileSync(reviewOutput, JSON.stringify(packageOutput.review, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Prepared the local unsigned package " + packageOutput.review.planId + ". " + gate);
  } catch (error) {
    // Do not log caught assertion values that could include unsigned inputs or raw RPC responses.
    console.error(gate + ": preparation failed while " + stage + ". " + (error.code ? "Error " + error.code + "." : ""));
    process.exitCode = 1;
  }
}
