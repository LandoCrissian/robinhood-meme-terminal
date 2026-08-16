import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  getAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex
} from "viem";
import {
  MAX_DISTRIBUTION_ROWS,
  RMT_DISTRIBUTION_CHAIN_ID,
  UINT256_MAX,
  buildDistributionManifestV1,
  canonicalDistributionJson,
  parseDistributionCsvV1,
  parseDistributionDecimal,
  parseDistributionManifestV1,
  pendingDistributionBatches,
  type BuildDistributionManifestInput,
  type DistributionActionKind,
  type DistributionManifestV1
} from "./distribution-domain";
import {
  RMT_DISTRIBUTION_ENGINE_V1_ABI,
  buildDistributionAuthorizationPlanV1,
  parseDistributionAuthorizationPlanV1,
  type DistributionAuthorizationPlanV1
} from "./distribution-authorization";
import {
  reconcileDistributionReceiptV1,
  type DistributionReceiptLogV1,
  type DistributionReceiptV1
} from "./distribution-settlement";

const sender = getAddress("0x1111111111111111111111111111111111111111");
const engine = getAddress("0x2222222222222222222222222222222222222222");
const sink = getAddress("0x3333333333333333333333333333333333333333");
const rmt = getAddress("0x4444444444444444444444444444444444444444");
const erc20 = getAddress("0x5555555555555555555555555555555555555555");
const erc721 = getAddress("0x6666666666666666666666666666666666666666");
const erc1155 = getAddress("0x7777777777777777777777777777777777777777");
const alice = getAddress("0x8888888888888888888888888888888888888888");
const bob = getAddress("0x9999999999999999999999999999999999999999");
const carol = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const dave = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const erin = getAddress("0xcccccccccccccccccccccccccccccccccccccccc");
const HASH_A = `0x${"a".repeat(64)}` as Hex;
const HASH_B = `0x${"b".repeat(64)}` as Hex;
const HASH_C = `0x${"c".repeat(64)}` as Hex;
const HASH_D = `0x${"d".repeat(64)}` as Hex;
const txHash = `0x${"e".repeat(64)}` as Hex;

const infrastructure = {
  engine,
  engineRuntimeHash: HASH_A,
  retirementSink: sink,
  retirementSinkRuntimeHash: HASH_B,
  rmtToken: rmt,
  rmtTokenRuntimeHash: HASH_C,
  utilityPolicyVersion: 1,
  erc20CostPerRecipientAtomic: "7",
  erc721CostPerRecipientAtomic: "11",
  erc1155CostPerRecipientAtomic: "13"
};

function gasEvidence(actionKind: DistributionActionKind, overrides: Partial<BuildDistributionManifestInput["gasEvidence"]> = {}) {
  return {
    chainId: RMT_DISTRIBUTION_CHAIN_ID,
    actionKind,
    measuredAtBlock: "40000000",
    blockGasLimit: "1000",
    safetyMarginBps: 8000,
    source: "foundry_simulation" as const,
    samples: [
      { recipientCount: 1, gasUsed: "200" },
      { recipientCount: 2, gasUsed: "400" },
      { recipientCount: 3, gasUsed: "700" },
      { recipientCount: 4, gasUsed: "900" }
    ],
    ...overrides
  };
}

function buildInput(actionKind: DistributionActionKind, overrides: Partial<BuildDistributionManifestInput> = {}): BuildDistributionManifestInput {
  const identity = actionKind.startsWith("erc20")
    ? { address: erc20, standard: "erc20" as const, decimals: 6 }
    : actionKind === "erc721"
      ? { address: erc721, standard: "erc721" as const, decimals: null }
      : { address: erc1155, standard: "erc1155" as const, decimals: null };
  const csv = actionKind === "erc20_equal"
    ? `recipient\n${carol}\n${alice}\n${bob}\n${erin}\n${dave}\n`
    : actionKind === "erc20_custom"
      ? `recipient,amount\n${carol},3\n${alice},1.25\n${bob},2\n`
      : actionKind === "erc721"
        ? `recipient,tokenId\n${alice},3\n${alice},1\n${bob},2\n`
        : `recipient,tokenId,amount\n${carol},2,30\n${alice},1,10\n${bob},1,20\n`;
  return {
    sender,
    actionKind,
    asset: { chainId: RMT_DISTRIBUTION_CHAIN_ID, ...identity },
    csv,
    equalAmount: actionKind === "erc20_equal" ? "1.5" : undefined,
    sourceEvidence: { snapshotBlock: "39999999", sourceId: "synthetic.fixture", evidenceHash: HASH_D },
    infrastructure,
    gasEvidence: gasEvidence(actionKind),
    ...overrides
  };
}

assert.equal(parseDistributionDecimal("1.25", 6), 1_250_000n);
assert.equal(parseDistributionDecimal("0.000001", 6), 1n);
assert.equal(parseDistributionDecimal(UINT256_MAX.toString(), 0), UINT256_MAX);
for (const invalid of ["", "00", "01", ".1", "1.", "1e3", "-1", "+1", "1,000", " 1", "1 "]) {
  assert.throws(() => parseDistributionDecimal(invalid, 6), /rejected distribution input/);
}
assert.throws(() => parseDistributionDecimal("0", 6));
assert.throws(() => parseDistributionDecimal("0.0000001", 6));
assert.throws(() => parseDistributionDecimal((UINT256_MAX + 1n).toString(), 0));

const equalManifest = buildDistributionManifestV1(buildInput("erc20_equal"));
assert.equal(equalManifest.entries.length, 5);
assert.deepEqual(equalManifest.entries.map((entry) => entry.recipient), [alice, bob, carol, dave, erin]);
assert.equal(equalManifest.expectedTotalDistributionAtomic, "7500000");
assert.equal(equalManifest.expectedTotalRmtRetirementAtomic, "35");
assert.deepEqual(equalManifest.batches.map((batch) => batch.recipientCount), [3, 2]);
assert.deepEqual(equalManifest.batches.map((batch) => batch.utilityCostAtomic), ["21", "14"]);
assert.deepEqual(equalManifest.batches.map((batch) => batch.conservativeGasEstimate), ["700", "400"]);
assert.equal(equalManifest.batches.reduce((sum, batch) => sum + BigInt(batch.utilityCostAtomic), 0n), 35n);
assert.equal(parseDistributionManifestV1(equalManifest).manifestHash, equalManifest.manifestHash);

const reorderedEqual = buildDistributionManifestV1(buildInput("erc20_equal", {
  csv: `recipient\n${bob}\n${erin}\n${alice}\n${dave}\n${carol}\n`
}));
assert.equal(reorderedEqual.manifestHash, equalManifest.manifestHash);
assert.deepEqual(reorderedEqual.batches.map((batch) => batch.batchId), equalManifest.batches.map((batch) => batch.batchId));
assert.equal(reorderedEqual.canonicalCsv, equalManifest.canonicalCsv);

const customManifest = buildDistributionManifestV1(buildInput("erc20_custom"));
assert.equal(customManifest.expectedTotalDistributionAtomic, "6250000");
assert.equal(customManifest.batches.length, 1);
const nftManifest = buildDistributionManifestV1(buildInput("erc721"));
assert.deepEqual(nftManifest.entries.map((entry) => entry.tokenId), ["1", "2", "3"]);
assert.equal(nftManifest.expectedTotalDistributionAtomic, "3");
const multiTokenManifest = buildDistributionManifestV1(buildInput("erc1155"));
assert.deepEqual(multiTokenManifest.entries.map((entry) => `${entry.tokenId}:${entry.recipient}`), [`1:${alice}`, `1:${bob}`, `2:${carol}`]);
assert.equal(multiTokenManifest.expectedTotalDistributionAtomic, "60");

for (const actionKind of ["erc20_equal", "erc20_custom", "erc721", "erc1155"] as const) {
  const manifest = buildDistributionManifestV1(buildInput(actionKind));
  assert.match(manifest.manifestHash, /^0x[0-9a-f]{64}$/);
  assert.ok(manifest.batches.every((batch) => batch.manifestHash === manifest.manifestHash));
  assert.equal(new Set(manifest.batches.map((batch) => batch.batchId)).size, manifest.batches.length);
}

assert.throws(() => parseDistributionManifestV1({ ...equalManifest, expectedTotalDistributionAtomic: "1" }), /inconsistent/);
assert.throws(() => parseDistributionManifestV1({ ...equalManifest, manifestHash: HASH_A }), /inconsistent/);
assert.throws(() => parseDistributionManifestV1({ ...equalManifest, unexpected: true }), /schema/);
assert.throws(() => buildDistributionManifestV1(buildInput("erc20_equal", { asset: { chainId: 1, address: erc20, standard: "erc20", decimals: 6 } })));
assert.throws(() => buildDistributionManifestV1(buildInput("erc721", { asset: { chainId: 4_663, address: erc721, standard: "erc20", decimals: 6 } })));
assert.throws(() => buildDistributionManifestV1(buildInput("erc20_equal", { gasEvidence: gasEvidence("erc20_equal", { actionKind: "erc721" }) })));
assert.throws(() => buildDistributionManifestV1(buildInput("erc20_equal", { gasEvidence: gasEvidence("erc20_equal", { evidenceHash: HASH_A }) })), /gas evidence hash/);
assert.throws(() => buildDistributionManifestV1(buildInput("erc20_equal", {
  infrastructure: { ...infrastructure, engineRuntimeHash: `0x${"0".repeat(64)}` }
})), /nonzero bytes32/);
assert.throws(() => buildDistributionManifestV1(buildInput("erc20_equal", {
  gasEvidence: gasEvidence("erc20_equal", { measuredAtBlock: "0" })
})), /outside uint256 bounds/);
assert.throws(() => buildDistributionManifestV1(buildInput("erc20_equal", {
  gasEvidence: gasEvidence("erc20_equal", { samples: [{ recipientCount: 1, gasUsed: "900" }] })
})), /does not prove/);
assert.throws(() => buildDistributionManifestV1(buildInput("erc20_equal", {
  gasEvidence: gasEvidence("erc20_equal", { samples: [{ recipientCount: 1, gasUsed: "300" }, { recipientCount: 2, gasUsed: "200" }] })
})), /not monotonic/);

const strictCsvBase = { actionKind: "erc20_custom" as const, decimals: 6, sender, engine, retirementSink: sink };
for (const csv of [
  `Recipient,amount\n${alice},1\n`,
  `recipient,amount\n${alice},1\n\n`,
  `recipient,amount\n ${alice},1\n`,
  `recipient,amount\n"${alice}",1\n`,
  `recipient,amount\n${alice},1e2\n`,
  `recipient,amount\n${alice},0\n`,
  `recipient,amount\n${alice},1\n${alice.toLowerCase()},2\n`,
  `recipient,amount\n${sender},1\n`,
  `recipient,amount\n${engine},1\n`,
  `recipient,amount\n${sink},1\n`
]) assert.throws(() => parseDistributionCsvV1({ ...strictCsvBase, csv }));
assert.equal(parseDistributionCsvV1({ ...strictCsvBase, csv: `recipient,amount\r\n${alice},1\r\n` }).entries.length, 1);
assert.throws(() => parseDistributionCsvV1({ ...strictCsvBase, csv: `\ufeffrecipient,amount\n${alice},1\n` }));
assert.throws(() => parseDistributionCsvV1({ ...strictCsvBase, csv: `recipient,amount\n${alice},1\r${bob},2` }));
assert.throws(() => parseDistributionCsvV1({
  ...strictCsvBase,
  csv: `recipient,amount\n${Array.from({ length: MAX_DISTRIBUTION_ROWS + 1 }, (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")},1`).join("\n")}\n`
}), /row limit/);
assert.throws(() => parseDistributionCsvV1({
  actionKind: "erc721", decimals: null, sender, engine, retirementSink: sink,
  csv: `recipient,tokenId\n${alice},1\n${bob},1\n`
}), /duplicates/);
assert.throws(() => parseDistributionCsvV1({
  actionKind: "erc1155", decimals: null, sender, engine, retirementSink: sink,
  csv: `recipient,tokenId,amount\n${alice},1,2\n${alice},1,3\n`
}), /duplicates/);

const customPlan = buildDistributionAuthorizationPlanV1(customManifest, 0);
assert.equal(customPlan.target, engine);
assert.equal(customPlan.transactionValueAtomic, "0");
assert.equal(customPlan.walletSubmissionEnabled, false);
assert.equal(customPlan.serverSubmissionEnabled, false);
assert.equal(customPlan.userAuthorizationRequired, true);
assert.equal(customPlan.approvals.length, 2);
assert.deepEqual(customPlan.approvals.filter((approval) => approval.kind === "erc20_exact").map((approval) => approval.exactAmountAtomic), ["6250000", "21"]);
const decodedCustom = decodeFunctionData({ abi: RMT_DISTRIBUTION_ENGINE_V1_ABI, data: customPlan.calldata });
assert.equal(decodedCustom.functionName, "airdropERC20");
assert.equal(decodedCustom.args[0], customPlan.batchId);
assert.equal(decodedCustom.args[1], erc20);
assert.deepEqual(decodedCustom.args[2], customManifest.batches[0].entries.map((entry) => entry.recipient));
assert.equal(parseDistributionAuthorizationPlanV1(customPlan, customManifest).planId, customPlan.planId);
assert.throws(() => parseDistributionAuthorizationPlanV1({ ...customPlan, target: rmt }, customManifest), /inconsistent/);
assert.throws(() => parseDistributionAuthorizationPlanV1({ ...customPlan, walletSubmissionEnabled: true }, customManifest), /malformed/);

const rmtAssetManifest = buildDistributionManifestV1(buildInput("erc20_equal", {
  asset: { chainId: 4_663, address: rmt, standard: "erc20", decimals: 18 },
  equalAmount: "2",
  csv: `recipient\n${alice}\n${bob}\n`
}));
const rmtAssetPlan = buildDistributionAuthorizationPlanV1(rmtAssetManifest, 0);
assert.equal(rmtAssetPlan.approvals.length, 1);
assert.equal(rmtAssetPlan.approvals[0].kind, "erc20_exact");
assert.equal(rmtAssetPlan.approvals[0].kind === "erc20_exact" ? rmtAssetPlan.approvals[0].exactAmountAtomic : null, (4n * 10n ** 18n + 14n).toString());

const nftPlan = buildDistributionAuthorizationPlanV1(nftManifest, 0);
assert.equal(nftPlan.approvals[0].kind, "erc721_exact");
assert.equal(nftPlan.approvals[0].kind === "erc721_exact" ? nftPlan.approvals[0].calldatas.length : 0, 3);
assert.equal(nftPlan.approvals[1].kind, "erc20_exact");
const multiTokenPlan = buildDistributionAuthorizationPlanV1(multiTokenManifest, 0);
assert.equal(multiTokenPlan.approvals[0].kind, "erc1155_operator");
assert.equal(multiTokenPlan.approvals[0].revokeRecommended, true);
assert.notEqual(
  multiTokenPlan.approvals[0].kind === "erc1155_operator" ? multiTokenPlan.approvals[0].enableCalldata : "",
  multiTokenPlan.approvals[0].kind === "erc1155_operator" ? multiTokenPlan.approvals[0].revokeCalldata : ""
);

const executionDomain = keccak256(toBytes("RMT_DISTRIBUTION_EXECUTION_V1"));
const transferEventAbi = [{
  type: "event", name: "Transfer", anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false }
  ]
}] as const;
const erc721TransferEventAbi = [{
  type: "event", name: "Transfer", anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true }
  ]
}] as const;
const erc1155TransferEventAbi = [{
  type: "event", name: "TransferSingle", anonymous: false,
  inputs: [
    { name: "operator", type: "address", indexed: true },
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "id", type: "uint256", indexed: false },
    { name: "value", type: "uint256", indexed: false }
  ]
}] as const;

function erc20TransferLog(token: Address, from: Address, to: Address, value: bigint, logIndex: number): DistributionReceiptLogV1 {
  return {
    address: token,
    topics: encodeEventTopics({ abi: transferEventAbi, eventName: "Transfer", args: { from, to } }) as readonly Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex
  };
}

function erc721TransferLog(token: Address, from: Address, to: Address, tokenId: bigint, logIndex: number): DistributionReceiptLogV1 {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc721TransferEventAbi, eventName: "Transfer", args: { from, to, tokenId } }) as readonly Hex[],
    data: "0x",
    logIndex
  };
}

function erc1155TransferLog(token: Address, operator: Address, from: Address, to: Address, tokenId: bigint, amount: bigint, logIndex: number): DistributionReceiptLogV1 {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc1155TransferEventAbi, eventName: "TransferSingle", args: { operator, from, to } }) as readonly Hex[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [tokenId, amount]),
    logIndex
  };
}

function canonicalEventLog(plan: DistributionAuthorizationPlanV1, logIndex: number, overrides: Partial<{
  batchHash: Hex;
  rmtRetired: bigint;
}> = {}): DistributionReceiptLogV1 {
  const executionKey = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" }],
    [executionDomain, 4_663n, plan.target, plan.sender, plan.batchId]
  ));
  return {
    address: plan.target,
    topics: encodeEventTopics({
      abi: RMT_DISTRIBUTION_ENGINE_V1_ABI,
      eventName: "DistributionExecuted",
      args: { executionKey, sender: plan.sender, asset: plan.asset }
    }) as readonly Hex[],
    data: encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "address" }, { type: "bytes32" }
      ],
      [
        plan.batchId,
        plan.actionKind === "erc20_equal" ? 0 : plan.actionKind === "erc20_custom" ? 1 : plan.actionKind === "erc721" ? 2 : 3,
        BigInt(plan.recipientCount),
        BigInt(plan.totalAssetAmountAtomic),
        overrides.rmtRetired ?? BigInt(plan.exactRmtRetirementAtomic),
        plan.retirementSink,
        overrides.batchHash ?? plan.batchHash
      ]
    ),
    logIndex
  };
}

function successfulReceipt(manifest: DistributionManifestV1, plan: DistributionAuthorizationPlanV1): DistributionReceiptV1 {
  const entries = manifest.batches[plan.batchIndex].entries;
  const logs: DistributionReceiptLogV1[] = [];
  let index = 0;
  logs.push(erc20TransferLog(rmt, sender, sink, BigInt(plan.exactRmtRetirementAtomic), index++));
  if (plan.actionKind === "erc20_equal" || plan.actionKind === "erc20_custom") {
    for (const entry of entries) logs.push(erc20TransferLog(plan.asset, sender, entry.recipient, BigInt(entry.amountAtomic!), index++));
  } else if (plan.actionKind === "erc721") {
    for (const entry of entries) logs.push(erc721TransferLog(plan.asset, sender, entry.recipient, BigInt(entry.tokenId!), index++));
  } else {
    for (const entry of entries) logs.push(erc1155TransferLog(plan.asset, engine, sender, entry.recipient, BigInt(entry.tokenId!), BigInt(entry.amountAtomic!), index++));
  }
  logs.push(canonicalEventLog(plan, index));
  return { chainId: 4_663, transactionHash: txHash, blockNumber: "40000001", status: "success", logs };
}

for (const manifest of [equalManifest, customManifest, nftManifest, multiTokenManifest]) {
  const plan = buildDistributionAuthorizationPlanV1(manifest, 0);
  const settlement = reconcileDistributionReceiptV1({ manifest, plan, receipt: successfulReceipt(manifest, plan) });
  assert.equal(settlement.status, "confirmed");
  assert.equal(settlement.batchId, plan.batchId);
  assert.equal(settlement.exactAssetAmountAtomic, plan.totalAssetAmountAtomic);
  assert.equal(settlement.exactRmtRetiredAtomic, plan.exactRmtRetirementAtomic);
}

const equalPlan = buildDistributionAuthorizationPlanV1(equalManifest, 0);
const equalReceipt = successfulReceipt(equalManifest, equalPlan);
assert.throws(() => reconcileDistributionReceiptV1({ manifest: equalManifest, plan: equalPlan, receipt: { ...equalReceipt, status: "reverted" } }));
assert.throws(() => reconcileDistributionReceiptV1({ manifest: equalManifest, plan: equalPlan, receipt: { ...equalReceipt, chainId: 1 } }));
assert.throws(() => reconcileDistributionReceiptV1({ manifest: equalManifest, plan: equalPlan, receipt: { ...equalReceipt, logs: equalReceipt.logs.slice(0, -1) } }), /canonical/);
assert.throws(() => reconcileDistributionReceiptV1({
  manifest: equalManifest,
  plan: equalPlan,
  receipt: { ...equalReceipt, logs: [...equalReceipt.logs.slice(0, -1), canonicalEventLog(equalPlan, equalReceipt.logs.length - 1, { batchHash: HASH_A })] }
}), /canonical settlement event/);
assert.throws(() => reconcileDistributionReceiptV1({
  manifest: equalManifest,
  plan: equalPlan,
  receipt: { ...equalReceipt, logs: [...equalReceipt.logs, erc20TransferLog(erc20, sender, alice, 1n, equalReceipt.logs.length)] }
}), /count/);
assert.throws(() => reconcileDistributionReceiptV1({
  manifest: equalManifest,
  plan: equalPlan,
  receipt: { ...equalReceipt, logs: equalReceipt.logs.map((log, index) => index === 1 ? erc20TransferLog(erc20, sender, alice, 1n, log.logIndex) : log) }
}), /evidence|count/);
assert.throws(() => reconcileDistributionReceiptV1({
  manifest: equalManifest,
  plan: equalPlan,
  receipt: { ...equalReceipt, logs: equalReceipt.logs.map((log, index) => index === 1 ? { ...log, logIndex: 0 } : log) }
}), /duplicate log/);

const rmtPlan = buildDistributionAuthorizationPlanV1(rmtAssetManifest, 0);
const rmtEntries = rmtAssetManifest.batches[0].entries;
const rmtLogs = [
  erc20TransferLog(rmt, sender, sink, BigInt(rmtPlan.exactRmtRetirementAtomic), 0),
  ...rmtEntries.map((entry, index) => erc20TransferLog(rmt, sender, entry.recipient, BigInt(entry.amountAtomic!), index + 1)),
  canonicalEventLog(rmtPlan, rmtEntries.length + 1)
];
assert.equal(reconcileDistributionReceiptV1({
  manifest: rmtAssetManifest,
  plan: rmtPlan,
  receipt: { chainId: 4_663, transactionHash: txHash, blockNumber: "40000001", status: "success", logs: rmtLogs }
}).exactRmtRetiredAtomic, "14");

assert.equal(pendingDistributionBatches(equalManifest, []).length, 2);
const firstSettlement = reconcileDistributionReceiptV1({ manifest: equalManifest, plan: equalPlan, receipt: equalReceipt });
assert.deepEqual(pendingDistributionBatches(equalManifest, [firstSettlement]).map((batch) => batch.batchIndex), [1]);
assert.throws(() => pendingDistributionBatches(equalManifest, [firstSettlement, firstSettlement]), /more than once/);
assert.throws(() => pendingDistributionBatches(equalManifest, [{ ...firstSettlement, batchId: HASH_A }]), /unknown batch/);
assert.equal(canonicalDistributionJson({ b: 2, a: 1 }), '{"a":1,"b":2}');

const decodedApproval = customPlan.approvals[0].kind === "erc20_exact"
  ? decodeFunctionData({ abi: erc20Abi, data: customPlan.approvals[0].calldata })
  : null;
assert.equal(decodedApproval?.functionName, "approve");
assert.equal(decodedApproval?.args[0], engine);
assert.equal(decodedApproval?.args[1], 6_250_000n);

console.log("RMT Distribution V1 manifest, CSV, batch, authorization, and settlement checks passed.");
