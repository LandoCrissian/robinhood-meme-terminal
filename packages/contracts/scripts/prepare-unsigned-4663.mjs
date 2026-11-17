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
import { buildFixedSupplyInput, compileFixedSupplyProfile, termEvidence } from "./fixed-supply-profile.mjs";
import { buildLaunchpadReviewPlan, mobilePayer, pinnedSafeCreationRows, reviewDelegatedMobileObservation, reviewSources,
  safeProxyRuntimeHash } from "./mobile-review-plan.mjs";
import { approvedOperationsFeeCap, operationsFeeApprovalSource, operationsSafeBaseline, operationsSafePolicyApprovalSource,
  recommendOperationsFeeCap } from "./prepare-operations-safe.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, getAddress, isAddressEqual, keccak256, parseAbi, toHex, zeroAddress, zeroHash } = require("viem");
const repository = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) => "0x" + sha256(JSON.stringify(value));
const gate = "BLOCKED_NO_BROADCAST";
const profile = "rmt-curve-fixed-supply-security-v2";
const chainId = 4663;
const provedOwnerConnection = "OWNER_REPORTED_READ_ONLY_ON_PHYSICAL_IPHONE";
const createProjectAbi = parseAbi(["function create(string,string,string,address,uint16,bytes32,uint256) payable returns (address,address)"]);

const configurationApproval = Object.freeze({
  scope: "OWNER_APPROVED_CONFIGURATION_ONLY",
  source: "https://github.com/LandoCrissian/robinhood-meme-terminal/issues/645#issuecomment-6930920399",
  owner: "LandoCrissian",
  transactionApproval: null,
});

export const approvedFirstProject = Object.freeze({
  name: "RMT", symbol: "RMT", projectURI: "", creator: mobilePayer, treasuryShareBpsOfEligibleFees: 0,
});

export const approvedRmtTerms = Object.freeze({
  fixedSupplyTokens: "1000000000", decimals: 18, curveTokens: "600000000", liquidityTokens: "400000000",
  projectShareBps: 9000, operationsShareBps: 500, reserveShareBps: 500,
  creationFeeWei: "400000000000000", graduationBackingWei: "2000000000000000000", curveFeeBps: 100, v4PoolFeeBps: 30,
});

export function assertApprovedLaunchTerms(input, compiledTerms) {
  const { fixedSupplyTokens, decimals, curveTokens, liquidityTokens, creationFeeWei, graduationBackingWei,
    curveFeeBps, projectShareBps, operationsShareBps, reserveShareBps, v4PoolFeeBps } = approvedRmtTerms;
  const supplyScale = 10n ** BigInt(decimals);
  const supplyWei = (amount) => (BigInt(amount) * supplyScale).toString();
  const approved = {
    fixedSupplyWei: supplyWei(fixedSupplyTokens), decimals,
    curveInventoryWei: supplyWei(curveTokens), initialLiquidityInventoryWei: supplyWei(liquidityTokens),
    creationFeeWei, graduationBackingWei, tradingFeeBps: curveFeeBps,
    projectBps: projectShareBps, operationsBps: operationsShareBps, reserveBps: reserveShareBps,
  };
  assert.deepEqual(termEvidence, approved, "Owner approval differs from the fixed-supply profile");
  assert.deepEqual(compiledTerms, approved, "Owner approval differs from the compiled terms");
  const { content } = JSON.parse(input).sources["src/RMTV4CurveGraduationV1.sol"];
  const poolFees = Array.from(content.matchAll(/\buint24 public constant POOL_FEE = ([\d_]+);/g),
    ([, literal]) => Number(literal.replaceAll("_", "")));
  assert.deepEqual(poolFees,
    [v4PoolFeeBps * 100], "Owner approval differs from the compiled v4 pool fee");
}

const transactionApprovals = Object.freeze({
  operationsSafe: null, reserveSafe: null, protocolDeployment: null, websiteRmtCreation: null,
  firstFundedAcceptance: null, publicActivation: null,
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
      assert.equal(result.status, "observed", `Governance ${name} ${method} unavailable`);
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

export function buildFirstProject(safeAddresses) {
  const { name, symbol, projectURI, creator, treasuryShareBpsOfEligibleFees } = approvedFirstProject;
  return {
    scope: "OWNER_APPROVED_WEBSITE_DEFAULTS_ONLY",
    method: "ORDINARY_WEBSITE_CREATOR_INTERFACE", path: "/create-token", creationEnabled: false, tokenAddress: null,
    name, symbol, projectURI, creator, projectTreasury: zeroAddress, treasuryShareBpsOfEligibleFees,
    projectShareRecipient: creator,
    revenueRecipients: {
      operations: { predictedAddress: safeAddresses[0], beneficiary: null },
      reserve: { predictedAddress: safeAddresses[1], beneficiary: null },
    },
    terms: approvedRmtTerms,
    prerequisites: ["Verified launchpad deployment and Blockscout source/runtime",
      "Production indexing, finality, v4 routing and wallet recovery acceptance",
      "Separate owner approval to create through the website"],
    transactionApproval: null,
  };
}

export function assertApprovedProjectRehearsal(report, safeAddresses, tokenRuntimeHash) {
  const proven = report.approvedFirstRmt;
  assert.ok(proven?.scope === "SYNTHETIC_APPROVED_FIRST_RMT" && proven.broadcastAuthorized === false &&
    proven.rollbackVerified === true, "A complete --approved-rmt synthetic fork rehearsal is required");
  assert.equal(report.delegatedSender.phase, "LIFECYCLE_REHEARSED");
  assert.deepEqual(proven.project, approvedFirstProject, "Synthetic creation did not use the approved inputs");
  assert.deepEqual([proven.operations, proven.reserve], safeAddresses, "Synthetic fee recipients differ from pinned Safe addresses");
  assert.equal(proven.factory, report.deployment.factory);
  assert.equal(proven.erc20RuntimeHash, tokenRuntimeHash);
  assert.equal(proven.exactCreationFeeWei, approvedRmtTerms.creationFeeWei);
  for (const [receipt, destination] of [[proven.creation, proven.factory], [proven.buy, proven.curve]]) {
    assert.equal(receipt.status, "success");
    assert.ok(isAddressEqual(receipt.from, approvedFirstProject.creator) && isAddressEqual(receipt.to, destination));
    assert.match(receipt.calldataHash, /^0x[a-f0-9]{64}$/);
    assert.match(receipt.transactionHash, /^0x[a-f0-9]{64}$/);
  }
  assert.equal(proven.creation.valueWei, approvedRmtTerms.creationFeeWei);
  const { name, symbol, projectURI, treasuryShareBpsOfEligibleFees } = approvedFirstProject;
  assert.match(proven.intentId, /^0x[a-f0-9]{64}$/);
  assert.notEqual(proven.intentId, zeroHash);
  assert.match(proven.deadline, /^[1-9]\d*$/);
  const data = encodeFunctionData({ abi: createProjectAbi, functionName: "create",
    args: [name, symbol, projectURI, zeroAddress, treasuryShareBpsOfEligibleFees, proven.intentId, BigInt(proven.deadline)] });
  assert.equal(proven.creation.calldataHash, keccak256(data), "Synthetic calldata differs from the approved configuration");
  const credits = proven.curveFeeCreditsWei.map(BigInt);
  assert.match(proven.curveTradeFeeWei, /^[1-9]\d*$/);
  const total = BigInt(proven.curveTradeFeeWei);
  const platform = total / 10n;
  const operations = platform / 2n;
  assert.deepEqual(credits, [total - platform, 0n, operations, platform - operations]);
  return proven;
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

function safeGas(estimate) {
  const { nitroGasEstimate, l2GasUnits, l1PosterGasUnits, estimatedTotalWei, l1PosterWei, l2ExecutionWei } = estimate;
  return { gasUnits: nitroGasEstimate, l2GasUnits, l1PosterGasUnits, estimatedFeeWei: estimatedTotalWei,
    estimatedL1FeeWei: l1PosterWei, estimatedL2FeeWei: l2ExecutionWei, provenance: "CURRENT_4663_READ_ONLY_NITRO_GAS_COMPONENTS" };
}

export function assertApprovedOperationsFees(estimate) {
  const recommendation = recommendOperationsFeeCap({ nitroGas: estimate.nitroGasEstimate,
    rpcGas: estimate.rpcEstimateGas, l2BaseFee: estimate.l2BaseFeeWei });
  for (const field of ["gasLimit", "maxFeePerGasWei", "maxPriorityFeePerGasWei", "maxNetworkFeeWei"]) {
    assert.ok(BigInt(recommendation[field]) <= BigInt(approvedOperationsFeeCap[field]),
      "Operations Safe quote exceeds an approved fee limit");
  }
  return {
    policyApproval: operationsSafePolicyApprovalSource, feeApproval: operationsFeeApprovalSource,
    feeCap: approvedOperationsFeeCap, freshRecommendation: recommendation,
    signingReviewEligible: false, transactionApproval: null,
    prerequisite: "Run the standalone Operations Safe validator with fresh canonical and pending vacancy before separate signing authorization",
  };
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
  assertApprovedLaunchTerms(input, compilation.manifest.terms);
  assertUnsignedDependencyEvidence(dependencyEvidence, secondObservation, compilation.manifest.externalRuntimePins);
  const prior = buildLaunchpadReviewPlan(compilation, input, reviewSources(), {
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
  const approvedRehearsal = assertApprovedProjectRehearsal(rehearsal.report, safeAddresses,
    keccak256(compilation.artifacts.RMTLaunchCurveTokenV2.runtime));
  const { constructors, bootstrapChildren } = deriveDelegatedConstructors(compilation, {
    sender: mobilePayer, createDestinations: observed.createDestinations,
    signers: scenario.governanceSignerProposal, safeAddresses,
  }, { includePrivateInitcode: true });
  const [operations, reserve, ...projectedProtocol] = scenario.rows;
  for (const [field, expected] of Object.entries({ sender: operationsSafeBaseline.sender, nonce: operationsSafeBaseline.nonce,
    destination: operationsSafeBaseline.destination, inputHash: operationsSafeBaseline.inputHash,
    predictedAddress: operationsSafeBaseline.predictedAddress, valueWei: operationsSafeBaseline.valueWei })) {
    assert.equal(operations[field], expected, "Operations Safe identity differs from its scoped fee approval");
  }
  const [operationsSafe, reserveSafe] = safes;
  const { owners, safeProfile: safeVersion, threshold, saltNonce, initializerHash } = operationsSafe.details;
  const signature = "createProxyWithNonce(address,bytes,uint256)";
  const operationsGas = safeGas(operations.estimate);
  const operationsFeeBinding = assertApprovedOperationsFees(operations.estimate);
  const operationsChecks = [stopOnDrift, "Recheck the exact pinned Safe infrastructure and vacancy before separate transaction approval",
    receiptRule, treasuryReceipt, "Verify Operations before preparing a separate Reserve review", operationsFeeBinding.prerequisite];
  if (BigInt(observed.balanceWei) < BigInt(operationsGas.estimatedFeeWei)) {
    operationsChecks.push("The observed payer balance was below this Operations Safe estimate");
  }
  const operation = {
    ...makeReviewRow(operations, signature, operationsGas, "UNSIGNED_OPERATIONS_APPROVAL_REQUIRED", operationsChecks, safeProxyRuntimeHash),
    owners, threshold, safeVersion, saltNonce, initializerHash,
  };
  const unsigned = {
    ...privateEnvelope(operations, operationsSafe.calldata),
    gasLimit: approvedOperationsFeeCap.gasLimit, maxFeePerGas: approvedOperationsFeeCap.maxFeePerGasWei,
    maxPriorityFeePerGas: approvedOperationsFeeCap.maxPriorityFeePerGasWei,
    setup: operationsSafe.details, gasAtObservedBlock: operations.estimate, syntheticReceipt: proof.safeReceipts[0],
    ...operationsFeeBinding,
  };
  const project = buildFirstProject(safeAddresses);
  const queue = [
    { ...makeReviewRow({ ...reserve, nonce: null }, signature, safeGas(reserve.estimate),
      "QUEUED_AWAITING_CANONICAL_OPERATIONS_SAFE_AND_SEPARATE_APPROVAL",
      [stopOnDrift, receiptRule, treasuryReceipt, "Verify the Operations receipt and refresh the Reserve nonce, vacancy and fee quote before review"],
      safeProxyRuntimeHash), projectedNonce: reserve.nonce, setup: reserveSafe.details, syntheticReceipt: proof.safeReceipts[1] },
  ];
  for (const [offset, item] of projectedProtocol.entries()) {
    const index = offset + 2;
    if (index < 7) {
      const candidate = constructors[index - 2];
      assert.equal(item.inputHash, candidate.initcodeHash);
      assert.equal(item.runtimeHash, candidate.runtimeHash);
      const receipt = proof.constructorReceipts[index - 2];
      queue.push({ ...makeReviewRow({ ...item, nonce: null }, candidate.contract + " constructor", forkGas(receipt),
        "QUEUED_AWAITING_VERIFIED_SAFE_RECEIPTS_AND_PROTOCOL_APPROVAL",
        [stopOnDrift, "Bind both verified Safe receipts before protocol review", receiptRule,
          protocolReceipt, ...(item.id === "bootstrap" ? ["Verify all three bootstrap children, hook permission bits and pinned Uniswap runtimes"] : [])],
        candidate.runtimeHash), projectedNonce: item.nonce, candidate: codeIdentity(compilation, candidate), syntheticReceipt: receipt });
    } else if (index < 11) {
      const schedule = index % 2 === 1;
      queue.push(makeReviewRow(item, schedule ? "schedule(Action,bytes,bytes)" : "execute(Action)",
        forkGas(proof.publicationReceipts[index - 7]),
        schedule ? "QUEUED_AWAITING_BOUND_CURRENT_GOVERNANCE_SIGNATURES" : "QUEUED_AWAITING_CANONICAL_SCHEDULE_AND_MATURE_NOTICE",
        [stopOnDrift, schedule ? "Bind exact runtime, directory EIP-712 domain, signer epoch, action nonce and deadline before two current signatures"
          : "Confirm the matching canonical scheduled action and enforce its two-day notice and execution deadline",
        receiptRule, "Confirm the exact publication event before moving to the next Directory action"]));
    } else assert.fail("Token issuance is outside the infrastructure deployment sequence");
  }
  const noncePair = { pendingNonce: observed.pendingNonce, confirmedNonce: observed.confirmedNonce };
  const summary = {
    schemaVersion: 2, scope: "RMT_4663_OPERATIONS_SAFE_UNSIGNED_REVIEW", status: gate, broadcastAuthorized: false, chainId, sender: mobilePayer,
    observedAt: observed.observedAt, expiresAt: new Date(Math.min(Date.parse(firstObservation.expiresAt), Date.parse(observed.expiresAt),
      Date.parse(dependencyEvidence.expiresAt))).toISOString(), anchor: observed.anchor, ...noncePair,
    balanceWei: observed.balanceWei, delegation: { address: observed.delegation.address, runtimeHash: observed.delegation.runtimeHash,
      designator: observed.delegation.designator },
    operation, terms: approvedRmtTerms, firstProject: approvedFirstProject,
  };
  const protocolForkGas = queue.slice(1).reduce((total, item) => total + BigInt(item.gas.gasUnits), 0n);
  const { estimatedSafesWeiAtObservedBlock, observedL2BaseFeeWei, protocolLiveEstimate } = scenario.costs;
  const protectedCandidate = {
    bindingSource, walletConnection: provedOwnerConnection, signingAcceptance: "UNVERIFIED",
    initialObservationDigest: digest(firstObservation), recheckObservationDigest: digest(secondObservation),
    observations: { before: firstObservation, recheck: secondObservation },
    noncePair, compiler: prior.fixture.compiler, releaseGate: prior.releaseGate, forkSha256: prior.fixture.forkSha256,
    dependencyEvidenceDigest: digest(dependencyEvidence), dependencyAttestation: dependencyEvidence,
    governanceEvidenceDigest: digest(governanceEvidence), governanceAttestation: governanceEvidence,
    costs: { estimatedSafesWeiAtObservedBlock, observedL2BaseFeeWei, protocolLiveEstimate,
      safeBudgetAtObservation: secondObservation.safes.budgetAtObservation,
      protocolObservedForkGasUnits: protocolForkGas.toString(),
      protocolForkGasAtObservedL2BaseFeeWei: observedL2BaseFeeWei === null
        ? null : (protocolForkGas * BigInt(observedL2BaseFeeWei)).toString(),
      protocolPosterCost: "UNAVAILABLE_FOR_DEPENDENT_CREATIONS_AND_QUEUED_ACTIONS",
      protocolModel: "Synthetic EVM gas times observed L2 base fee, excluding any L1 poster fee. Protocol deployment fee caps remain unassigned." },
    sourceVerification: {
      standardInputSha256: compilation.manifest.inputSha256,
      contracts: [...constructors, ...bootstrapChildren].map((item) => codeIdentity(compilation, item)),
      externalRuntimePins: compilation.manifest.externalRuntimePins,
      readiness: "POST_DEPLOYMENT_CANONICAL_RECEIPTS_AND_EXACT_RUNTIME_REQUIRED",
    },
    configurationApproval, transactionApprovals, operationsFeeBinding,
    unsigned: [unsigned], queue,
    directoryTemplates: [
      actionTemplate({ observed: null, constructors, kind: 0, contract: bootstrapChildren[2], version: 1 }),
      actionTemplate({ observed: null, constructors, kind: 4, contract: constructors[3], version: 3 }),
    ],
    firstProject: project,
    syntheticCreatorFlowEvidence: approvedRehearsal,
    recovery: "Leave an unresolved original transaction pending and resolve its canonical hash/receipt. Never submit a replacement or advance from an unknown result.",
  };
  const planId = digest({ summary, protectedCandidate });
  assertFreshUnsignedBinding(firstObservation, secondObservation);
  assertUnsignedDependencyEvidence(dependencyEvidence, secondObservation, compilation.manifest.externalRuntimePins);
  return { review: { ...summary, planId }, privatePackage: {
    schemaVersion: 2, scope: "RMT_4663_PRIVATE_INCOMPLETE_UNSIGNED_PACKAGE", status: gate, broadcastAuthorized: false, planId,
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
    assert.ok(values.solc && values.rehearsal, "Supply --solc and --rehearsal from the synthetic --delegated --approved-rmt 4663 fork");
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
    const governanceFailure = error.message?.match(/^Governance (official|pinax) (eth_chainId|eth_getBlockByNumber|eth_getCode) unavailable$/);
    if (governanceFailure) console.error("Required governance read unavailable at " + governanceFailure[1] + " for " + governanceFailure[2] + ".");
    process.exitCode = 1;
  }
}
