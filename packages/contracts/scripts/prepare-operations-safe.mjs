import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { deriveSafeProxy } from "../../../docs/evidence/rmt-task045/operations-safe-initializer.mjs";
import { assertCurrentMobileObservation, runMobileSenderProbe } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { pinnedSafeCreationRows, safeProxyRuntimeHash } from "./mobile-review-plan.mjs";
import { approvedFirstProject, approvedRmtTerms, privateOutputPath } from "./prepare-unsigned-4663.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const viem = require("viem");
const action = "createProxyWithNonce(address,bytes,uint256)";
const createAbi = viem.parseAbi(["function " + action + " returns (address)"]);
const setupAbi = viem.parseAbi([
  "function setup(address[],uint256,address,bytes,address,address,uint256,address)",
]);
const blocked = "BLOCKED_NO_BROADCAST";
const observationOptions = { allowPinnedDelegation: true, operationsOnly: true };
const maximumAgeMs = 120_000;
const maxGas = (1n << 64n) - 1n;
const maxUint256 = (1n << 256n) - 1n;

export const operationsFeeApprovalSource = "https://github.com/LandoCrissian/robinhood-meme-terminal/issues/649#issuecomment-6936656732";
export const approvedOperationsFeeCap = Object.freeze({
  gasLimit: "391739", maxFeePerGasWei: "40020000", maxPriorityFeePerGasWei: "0", maxNetworkFeeWei: "15677394780000",
});
export const operationsSigningDecision = "BLOCKED_RELEASE_GATES";
export const operationsOverCapSigningDecision = "BLOCKED_FEE_CEILING_AND_RELEASE_GATES";

class OperationsReviewStop extends Error {}

// Identity observed by the owner in #648 and bound by issue #649. The nonce
// below is solely a drift comparator, never a substitute for the live reads.
export const operationsSafeBaseline = Object.freeze({
  source: "https://github.com/LandoCrissian/robinhood-meme-terminal/pull/648",
  commit: "07df29d333b76d8e53742ba75d10ef42518f87ec",
  chainId: 4663,
  sender: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",
  nonce: "476",
  destination: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  predictedAddress: "0xAF9F10258b091719618c19D057F9cDAB72eFFd8b",
  inputHash: "0x64c42b60490759e71c4777faab3ac157f5c565b6b379629bdaaec7e5352c2250",
  valueWei: "0",
  safeVersion: "SafeL2 1.4.1",
  threshold: 2,
  owners: Object.freeze([
    "0xC447A378cFd8460Febc2eef67501D7a5473B9001",
    "0xC3600f2Df60929D2AB9ab294CFF42EEDCB984f51",
    "0x2Bcc3fAfCE77cCc7fdBED46E0B5bb80bA3E76697",
  ]),
  saltNonce: "0x8094029c8a767b073fdbe606186b138b416682f2584ca87d38b3eaaa7af16cc2",
  initializerHash: "0x151a0612bf013560eaf16129615ae6262a6889db13410623ddcb49f2a8506ac2",
});

export function recommendOperationsFeeCap({ nitroGas, rpcGas, l2BaseFee }) {
  for (const amount of [nitroGas, rpcGas, l2BaseFee]) {
    assert.match(amount, /^[1-9][0-9]{0,77}$/, "The fee cap requires positive exact observations");
  }
  const nitro = BigInt(nitroGas);
  const rpc = BigInt(rpcGas);
  const largerEstimate = nitro > rpc ? nitro : rpc;
  const gasLimit = (largerEstimate * 5n + 3n) / 4n;
  const maxFeePerGas = BigInt(l2BaseFee) * 2n;
  const maxNetworkFee = gasLimit * maxFeePerGas;
  assert.ok(gasLimit <= maxGas && maxNetworkFee <= maxUint256, "The proposed fee bounds exceed transaction limits");
  return {
    gasLimit: gasLimit.toString(), maxFeePerGasWei: maxFeePerGas.toString(),
    maxPriorityFeePerGasWei: "0", maxNetworkFeeWei: maxNetworkFee.toString(),
  };
}

function overApprovedCap(cap) {
  return BigInt(cap.gasLimit) > BigInt(approvedOperationsFeeCap.gasLimit) ||
    BigInt(cap.maxFeePerGasWei) > BigInt(approvedOperationsFeeCap.maxFeePerGasWei) ||
    BigInt(cap.maxNetworkFeeWei) > BigInt(approvedOperationsFeeCap.maxNetworkFeeWei);
}

function explainOverage(gas, recommendation) {
  const [nitroGas, rpcGas, baseFee] = [gas.gasUnits, gas.rpcEstimateGas, gas.l2BaseFeeWei].map(BigInt);
  const observedGas = nitroGas > rpcGas ? nitroGas : rpcGas;
  const actualFits = !overApprovedCap({ gasLimit: observedGas, maxFeePerGasWei: baseFee, maxNetworkFeeWei: observedGas * baseFee });
  const explanation = actualFits ? "The unbuffered estimate fits the approved fields, but the refreshed headroom does not." :
    "The unbuffered estimate exceeds at least one approved fee field.";
  return explanation + ` The fresh proposal is ${recommendation.gasLimit} gas at ${recommendation.maxFeePerGasWei} wei/gas` +
    ` (${recommendation.maxNetworkFeeWei} wei) versus the approved ${approvedOperationsFeeCap.gasLimit} gas at ` +
    `${approvedOperationsFeeCap.maxFeePerGasWei} wei/gas (${approvedOperationsFeeCap.maxNetworkFeeWei} wei).`;
}

function bindReviewedOperation(observation, sender) {
  const baseline = operationsSafeBaseline;
  const [pinned] = pinnedSafeCreationRows({ includePrivateCalldata: true });
  const { owners, threshold, saltNonce, initializerHash, singleton, create2Salt, safeProfile } = pinned.details;
  const { functionName, args } = viem.decodeFunctionData({ abi: createAbi, data: pinned.calldata });
  const [decodedSingleton, initializer, decodedSalt] = args;
  const setup = viem.decodeFunctionData({ abi: setupAbi, data: initializer });
  const output = deriveSafeProxy(viem, pinned.to, initializer, decodedSalt, observation.safes.initcodeHash);
  const [sample] = observation.safes.proposals;
  assert.equal(functionName, "createProxyWithNonce");
  if (sender.confirmedNonce !== baseline.nonce || sender.pendingNonce !== baseline.nonce) {
    throw new OperationsReviewStop("The confirmed or pending nonce has drifted from #648. Renew the transaction review and fee approval.");
  }
  assert.equal(observation.chainId, baseline.chainId, "The chain has drifted from #648");
  assert.equal(pinned.from, baseline.sender);
  assert.equal(pinned.to, baseline.destination);
  assert.equal(pinned.valueWei, baseline.valueWei);
  assert.equal(pinned.dataHash, baseline.inputHash);
  assert.equal(viem.keccak256(pinned.calldata), baseline.inputHash, "Operations calldata has drifted from #648");
  assert.equal(output.address, baseline.predictedAddress, "The expected proxy has drifted from #648");
  assert.equal(pinned.expectedAddress, output.address);
  assert.equal(sample.simulatedAddress, output.address);
  assert.equal(output.create2Salt, create2Salt);
  assert.equal(decodedSingleton, singleton);
  assert.equal(decodedSalt, BigInt(baseline.saltNonce));
  assert.equal(viem.keccak256(initializer), baseline.initializerHash);
  assert.deepEqual(setup.args, [baseline.owners, BigInt(baseline.threshold), viem.zeroAddress, "0x",
    pinned.details.fallbackHandler, viem.zeroAddress, 0n, viem.zeroAddress], "Decoded Operations initializer has drifted");
  assert.deepEqual({ owners, threshold, saltNonce, initializerHash, safeVersion: safeProfile }, {
    owners: baseline.owners, threshold: baseline.threshold, saltNonce: baseline.saltNonce,
    initializerHash: baseline.initializerHash, safeVersion: baseline.safeVersion,
  }, "Operations Safe setup has drifted from #648");
  return { pinned, sample };
}

export function prepareOperationsSafeReview(observation, nowMs = Date.now(), { reviewOnlyOverCap = false } = {}) {
  const sender = assertCurrentMobileObservation(observation, nowMs, observationOptions);
  const { pinned, sample } = bindReviewedOperation(observation, sender);
  const anchor = { ...sender.anchor, blockTimeUtc: new Date(sender.anchor.blockTimeUtc).toISOString() };
  const observedAt = new Date(observation.observedAt).toISOString();
  const deadline = Math.min(Date.parse(observation.expiresAt), Date.parse(anchor.blockTimeUtc) + maximumAgeMs);
  assert.ok(deadline > nowMs && deadline > Date.parse(observedAt), "The exact Operations quote has expired");
  const expiresAt = new Date(deadline).toISOString();
  const estimate = sample.gas;
  const gas = {
    gasUnits: estimate.nitroGasEstimate, rpcEstimateGas: estimate.rpcEstimateGas, l2BaseFeeWei: estimate.l2BaseFeeWei,
    l2GasUnits: estimate.l2GasUnits, l1PosterGasUnits: estimate.l1PosterGasUnits, estimatedFeeWei: estimate.estimatedTotalWei,
    estimatedL1FeeWei: estimate.l1PosterWei, estimatedL2FeeWei: estimate.l2ExecutionWei,
    provenance: "CURRENT_4663_READ_ONLY_NITRO_GAS_COMPONENTS",
  };
  const feeCap = approvedOperationsFeeCap;
  assert.equal(BigInt(feeCap.gasLimit) * BigInt(feeCap.maxFeePerGasWei), BigInt(feeCap.maxNetworkFeeWei));
  const freshRecommendation = recommendOperationsFeeCap({ nitroGas: gas.gasUnits, rpcGas: gas.rpcEstimateGas, l2BaseFee: gas.l2BaseFeeWei });
  const exceedsCap = overApprovedCap(freshRecommendation);
  const signingDecision = exceedsCap ? operationsOverCapSigningDecision : operationsSigningDecision;
  const feeCapStatus = exceedsCap ? "OVER_APPROVED_CEILING" : "WITHIN_APPROVED_CEILING";
  const overage = exceedsCap && explainOverage(gas, freshRecommendation);
  if (exceedsCap && !reviewOnlyOverCap) {
    throw new OperationsReviewStop(`${overage} Renew the fee approval before preparing an unsigned transaction.`);
  }
  assert.ok(BigInt(sender.balanceWei) >= BigInt(feeCap.maxNetworkFeeWei), "The observed payer balance is below the approved cap");
  const operation = {
    id: pinned.id, label: "Operations Safe creation", dependsOn: [], sender: pinned.from,
    nonce: sender.pendingNonce, destination: pinned.to, predictedAddress: pinned.expectedAddress,
    valueWei: pinned.valueWei, inputHash: pinned.dataHash, action, status: "UNSIGNED_OPERATIONS_APPROVAL_REQUIRED",
    gas, feeCap, freshRecommendation, feeCapStatus, feeApproval: operationsFeeApprovalSource, expectedRuntimeHash: safeProxyRuntimeHash,
    checks: [exceedsCap ? "The refreshed recommendation exceeds an approved fee field. Renew fee approval before preparing a transaction." :
      "The refreshed recommendation fits the approved fee fields. The release gates block signing approval.",
      "Refresh stale or changed evidence before considering any transaction.",
      "Reserve and the protocol wait for a separately verified receipt and release approval."],
    owners: pinned.details.owners, threshold: pinned.details.threshold, safeVersion: pinned.details.safeProfile,
    saltNonce: pinned.details.saltNonce, initializerHash: pinned.details.initializerHash,
  };
  const { address, runtimeHash, designator } = sender.delegation;
  const summary = {
    schemaVersion: 4, scope: "RMT_4663_OPERATIONS_SAFE_UNSIGNED_REVIEW", status: blocked, broadcastAuthorized: false,
    signingDecision, transactionApproval: null,
    chainId: observation.chainId, sender: pinned.from, observedAt, expiresAt, anchor,
    pendingNonce: sender.pendingNonce, confirmedNonce: sender.confirmedNonce, balanceWei: sender.balanceWei,
    delegation: { address, runtimeHash, designator }, operation, terms: approvedRmtTerms, firstProject: approvedFirstProject,
  };
  const protectedQuote = {
    source: operationsSafeBaseline, observation, signingDecision, transactionApproval: null,
    unsignedFields: exceedsCap ? null : { type: "0x2", chainId: viem.toHex(observation.chainId), from: pinned.from, to: pinned.to,
      nonce: viem.toHex(BigInt(sender.pendingNonce)), value: "0x0", data: pinned.calldata, gas: viem.toHex(BigInt(feeCap.gasLimit)),
      maxFeePerGas: viem.toHex(BigInt(feeCap.maxFeePerGasWei)), maxPriorityFeePerGas: "0x0" },
  };
  const planId = "0x" + createHash("sha256").update(JSON.stringify({ summary, protectedQuote })).digest("hex");
  const review = { ...summary, planId };
  return { review, privateQuote: { ...protectedQuote, status: blocked, broadcastAuthorized: false, review }, overage };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { "out-private": { type: "string" }, "out-review": { type: "string" },
    "review-only-over-cap": { type: "boolean" } } });
  let stage = "checking private output paths";
  try {
    const privatePath = privateOutputPath(values["out-private"]);
    const reviewPath = privateOutputPath(values["out-review"]);
    assert.notEqual(privatePath.toLowerCase(), reviewPath.toLowerCase(), "Use separate paths for the private quote and phone review");
    stage = "refreshing the Operations Safe read-only observations";
    const observation = await runMobileSenderProbe(observationOptions);
    stage = "validating exact #648 identity, freshness, vacancy and cost";
    const { review, privateQuote, overage } = prepareOperationsSafeReview(observation, Date.now(), {
      reviewOnlyOverCap: values["review-only-over-cap"] === true,
    });
    stage = "writing the blocked review files";
    writeFileSync(privatePath, JSON.stringify(privateQuote, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    writeFileSync(reviewPath, JSON.stringify(review, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Refreshed Operations review " + review.planId + ". " + blocked);
    if (overage) console.log(overage + " Review evidence only. No unsigned transaction was prepared.");
  } catch (error) {
    const reason = error instanceof OperationsReviewStop ? error.message : "Refresh failed while " + stage + ".";
    console.error(blocked + ": " + reason);
    process.exitCode = 1;
  }
}
