import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, hashTypedData, keccak256, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { claimExecutionIdentity, claimExecutionReviewHash, claimProfileDigest, isClaimExecutionReview, type ClaimExecutionReview } from "../claim-profiles";
import { claimContextIsAllowed, claimDelegatePin, claimSafePins, claimSafeTypedData, prepareClaimExecutionReview,
  prepareCorroboratedClaimExecutionReview, revalidateClaimExecutionReview, verifyClaimExecutionProfileAt, type ClaimPreparationInput } from "./claim-profiles";
import { ea, eh, earningsTestFixture, fixtureCode } from "./earnings-test-fixture";
import { productionEarningsContext, type EarningsRpc } from "./earnings-contracts";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";
import { fixture, owners, delegateArchive, productionArchive } from "./claim-profile-test-fixture";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nitroAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
async function ready(f = fixture()) {
  const r = await prepareClaimExecutionReview(f.input);
  assert.ok(isClaimExecutionReview(r), JSON.stringify(r)); return { f, r: r as ClaimExecutionReview };
}
async function signatures(r: ClaimExecutionReview, keys = owners.slice(0, 2)) {
  assert.ok(r.wallet.safe);
  const signed = await Promise.all(keys.map(async owner => ({ address: owner.address, signature: await owner.sign({ hash: r.wallet.safe!.transactionHash }) })));
  return ("0x" + signed.sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map(v => v.signature.slice(2)).join("")) as Hex;
}
function changed(r: ClaimExecutionReview, mutate: (r: ClaimExecutionReview) => void) {
  const c = structuredClone(r); mutate(c); c.intentHash = claimExecutionIdentity(c); c.reviewHash = claimExecutionReviewHash(c); return c;
}

test("all six EOA operations preserve exact assets, targets, recipients and separate fees", async () => {
  for (const operation of ["curve-claim", "lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token", "creation-fees"] as const) {
    const f = fixture(); f.input.operation = operation; const { r } = await ready(f);
    assert.equal(r.status, "review-only"); assert.equal(r.executionEnabled, false); assert.equal(r.kind, "eoa");
    assert.equal(r.outer?.from, f.creator); assert.equal(r.outer?.data, r.inner.data); assert.equal(r.fees.status, "synthetic-local");
    assert.equal(r.authorizations.ownerApprovalsRequired, 0); assert.equal(r.authorizations.walletTransactionConfirmations, 1);
    if (operation === "creation-fees") { assert.ok(same(r.beneficiary, f.operations)); assert.ok(same(r.inner.to, f.context.factory)); }
    else if (operation === "lp-collect") assert.notEqual(r.beneficiary, f.creator);
    else assert.equal(r.beneficiary, f.creator);
    if (operation === "lp-claim-token") assert.equal(r.inner.expectedNativeWei, "0");
    if (["curve-claim", "lp-claim-native", "creation-fees"].includes(operation)) assert.equal(r.inner.expectedTokenWei, "0");
  }
});
test("viem empty-code undefined is admitted, but null and failed reads are unavailable", async () => {
  const f = fixture(); await ready(f);
  f.state.malformedCode = true; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
  f.state.malformedCode = false; f.state.throwCode = true; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
});
test("MetaMask profile binds actual archived delegate runtime and rejects replacement/revocation", async () => {
  assert.equal(keccak256(delegateArchive.delegate.code), claimDelegatePin.runtimeHash);
  const f = fixture("metamask-7702"), { r } = await ready(f);
  assert.equal(r.wallet.delegation?.designator, claimDelegatePin.designator); assert.equal(r.outer?.type, "0x2");
  f.state.badDelegate = true; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
  f.state.badDelegate = false; f.state.pendingDelegateChanged = true; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
  f.state.pendingDelegateChanged = false; f.input.kind = "eoa"; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
});
test("Safe proposal retains beneficiary custody and separates three nonce meanings", async () => {
  const f = fixture("safe-1.4.1"), { r } = await ready(f);
  assert.equal(r.status, "awaiting-safe-approvals"); assert.equal(r.outer, null); assert.equal(r.actor, f.creator);
  assert.equal(r.beneficiary, f.creator); assert.ok(same(r.gasPayer, f.input.account)); assert.notEqual(r.gasPayer, r.actor);
  assert.equal(r.wallet.safe?.evmNonce, "1"); assert.equal(r.wallet.safe?.nonce, "0"); assert.equal(r.inner.nonce, "0x0");
  assert.equal(r.gasPayerEvidence.nonce, "0"); assert.equal(r.wallet.safe?.expiryEnforcement, "safe-nonce-only");
  assert.equal(r.authorizations.ownerApprovalsRequired, 2); assert.match(r.notices.join(" "), /Off-chain review expiry is not revocation/);
});
test("two genuine sorted Safe owner signatures produce only the exact inner CALL outer execution", async () => {
  const f = fixture("safe-1.4.1"), { r: proposal } = await ready(f);
  f.input.safeSignatures = await signatures(proposal); const { r } = await ready(f);
  assert.equal(r.status, "review-only"); assert.equal(r.wallet.safe?.approvalsCollected, 2); assert.equal(r.outer?.to, f.creator);
  const decoded = decodeFunctionData({ abi: parseAbi(["function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)"]), data: r.outer!.data });
  assert.deepEqual(decoded.args.slice(0, 9), [r.inner.to, 0n, r.inner.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress]);
  assert.equal(decoded.args[9], f.input.safeSignatures); assert.equal(r.outer?.value, "0x0");
  f.state.safeSimulationFailure = true;
  const failed = await prepareClaimExecutionReview(f.input);
  assert.ok(isClaimExecutionReview(failed)); assert.equal(failed.status, "fee-unavailable");
});
test("insufficient, duplicate, outsider, cross-domain and stale Safe approvals are rejected", async () => {
  const f = fixture("safe-1.4.1"), { r } = await ready(f), correct = await signatures(r);
  const outsider = privateKeyToAccount(("0x" + "9".repeat(64)) as Hex);
  for (const sig of [("0x" + correct.slice(2, 132)) as Hex, ("0x" + correct.slice(2, 132).repeat(2)) as Hex,
    await signatures(r, [owners[0], outsider]), ("0x" + "00".repeat(130)) as Hex]) {
    f.input.safeSignatures = sig; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
  }
  f.input.safeSignatures = correct; f.state.safeNonce = 1n;
  assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
});
test("Safe handler, modules, threshold, owner types, runtime and count are strictly pinned", async () => {
  for (const key of ["guard", "modules", "badHandler", "badSingleton", "badOwner", "badProxy"] as const) {
    const f = fixture("safe-1.4.1"); f.state[key] = true; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable", key);
  }
  for (const value of [0n, 1n, 4n, 100n]) { const f = fixture("safe-1.4.1"); f.state.ownerCount = value; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable"); }
  const f = fixture("safe-1.4.1"); f.state.threshold = 1n; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
});
test("review refresh preserves reviewed identity while rejecting nonce, time, policy and code changes", async () => {
  const f = fixture(), { r } = await ready(f);
  assert.equal((await revalidateClaimExecutionReview(f.context, f.registration, r) as ClaimExecutionReview).reviewHash, r.reviewHash);
  f.state.payerNonce = 1; assert.equal((await revalidateClaimExecutionReview(f.context, f.registration, r)).status, "unavailable");
  f.state.payerNonce = 0; f.state.price = 100n; assert.equal((await revalidateClaimExecutionReview(f.context, f.registration, r)).status, "unavailable");
  f.state.price = 2n; f.state.gas = 100000n; assert.equal((await revalidateClaimExecutionReview(f.context, f.registration, r)).status, "unavailable");
  f.state.gas = 30000n; f.state.badDelegate = true; f.state.kind = "metamask-7702"; assert.equal((await revalidateClaimExecutionReview(f.context, f.registration, r)).status, "unavailable");
});
test("fee growth and a newer checkpoint preserve the original consent, but expiry, policy drift and reorg do not", async () => {
  const f = fixture(), { r } = await ready(f);
  f.baseState.head = 11n; f.baseState.extraCurveFee = 50n;
  f.context.checkpoint = { blockNumber: "11", blockHash: eh(11), timestamp: new Date(Number(f.block(11n).timestamp) * 1000).toISOString() };
  const refreshed = await revalidateClaimExecutionReview(f.context, f.registration, r);
  assert.ok(isClaimExecutionReview(refreshed), JSON.stringify(refreshed)); assert.equal(refreshed.reviewHash, r.reviewHash);
  assert.equal(refreshed.inner.expectedNativeWei, r.inner.expectedNativeWei); assert.equal(refreshed.inner.reviewBlockNumber, "0xa");
  f.baseState.reorgReview = true; assert.equal((await revalidateClaimExecutionReview(f.context, f.registration, r)).status, "unavailable");
  f.baseState.reorgReview = false; f.baseState.wrongPolicy = true; assert.equal((await revalidateClaimExecutionReview(f.context, f.registration, r)).status, "unavailable");
  f.baseState.wrongPolicy = false; f.baseState.head = 200n;
  f.context.checkpoint = { blockNumber: "200", blockHash: eh(200), timestamp: new Date(Number(f.block(200n).timestamp) * 1000).toISOString() };
  assert.equal((await revalidateClaimExecutionReview(f.context, f.registration, r)).status, "unavailable");
});
test("rehashing an unknown outer property or alternate Safe CALL never authorizes it", async () => {
  const { r } = await ready();
  for (const key of ["authorizationList", "accessList", "calls", "gasPrice"]) {
    const altered = changed(r, v => Object.assign(v.outer!, { [key]: [] })); assert.equal(isClaimExecutionReview(altered), false);
  }
  assert.equal(isClaimExecutionReview(changed(r, v => { v.outer!.nonce = "0x00"; })), false);
  assert.equal(isClaimExecutionReview(changed(r, v => {
    if (v.fees.status === "unavailable") throw Error("Ready fees required");
    v.fees.gasLimit = "30000001"; v.fees.proposedMaximumWei = (30000001n * BigInt(v.fees.maxFeePerGasWei)).toString(); v.outer!.gas = "0x1c9c381";
  })), false);
  const f = fixture("safe-1.4.1"), { r: proposal } = await ready(f); f.input.safeSignatures = await signatures(proposal);
  const { r: safe } = await ready(f);
  assert.equal(isClaimExecutionReview(changed(safe, v => { v.outer!.data = (v.outer!.data + "00") as Hex; })), false);
  assert.equal(isClaimExecutionReview(changed(safe, v => { v.wallet.safe!.transaction.operation = 1 as 0; })), false);
});
test("historical identity verification never confuses a mined nonce with the old review's pending nonce", async () => {
  const f = fixture(), { r } = await ready(f); f.state.receiptNonce = 1; f.state.payerNonce = 1;
  // At historical block10 the originalnonce remains0; pending has advanced.
  const originalCount = f.context.rpc.getTransactionCount;
  f.context.rpc.getTransactionCount = (async args => args.blockNumber === 10n ? 0 : originalCount(args)) as typeof originalCount;
  assert.equal(await verifyClaimExecutionProfileAt(f.context, r, 10n, "review"), true);
  assert.equal(await verifyClaimExecutionProfileAt(f.context, r, 11n, "receipt"), true);
});
test("Safe reverted outer transaction preserves Safe nonce while successful execution consumes it", async () => {
  const f = fixture("safe-1.4.1"), { r: proposal } = await ready(f); f.input.safeSignatures = await signatures(proposal);
  const { r } = await ready(f); f.state.receiptNonce = 1;
  assert.equal(await verifyClaimExecutionProfileAt(f.context, r, 11n, "reverted-receipt"), true);
  assert.equal(await verifyClaimExecutionProfileAt(f.context, r, 11n, "receipt"), false);
  f.state.safeNonce = 1n;
  assert.equal(await verifyClaimExecutionProfileAt(f.context, r, 11n, "receipt"), true);
});
test("historical profile verification cryptographically rejects rehashed forged Safe signatures", async () => {
  const f = fixture("safe-1.4.1"), { r: proposal } = await ready(f); f.input.safeSignatures = await signatures(proposal);
  const { r } = await ready(f); f.state.receiptNonce = 1; f.state.safeNonce = 1n;
  assert.equal(await verifyClaimExecutionProfileAt(f.context, r, 11n, "receipt"), true);
  const forged = changed(r, copy => {
    copy.wallet.safe!.signatures = ("0x" + "00".repeat(130)) as Hex;
    const abi = parseAbi(["function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)"]);
    copy.outer!.data = encodeFunctionData({ abi, functionName: "execTransaction", args: [copy.inner.to, 0n, copy.inner.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, copy.wallet.safe!.signatures] });
  });
  assert.equal(isClaimExecutionReview(forged), true, "Shape/digest validation is not signature authorization");
  assert.equal(await verifyClaimExecutionProfileAt(f.context, forged, 11n, "receipt"), false);
});
test("canonical digest is independent of property insertion order and uses deterministic ordering", () => {
  assert.equal(claimProfileDigest({ z: 1, a: { k: 2, Z: 3 } }), claimProfileDigest({ a: { Z: 3, k: 2 }, z: 1 }));
});

function production() {
  const local = fixture(); const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const point = { blockNumber: (curveProductionDeployment.blockNumber + 8n).toString(), blockHash: eh(850), timestamp: new Date(Number(timestamp) * 1000).toISOString() };
  const state = { badNitro: false, unavailableNitro: false, l1: 10000n, l1Base: 10n, calls: 0 };
  const old = local.context.rpc;
  const rpc = { ...old,
    getChainId: async () => 4663,
    getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? BigInt(point.blockNumber), hash: blockNumber === curveProductionDeployment.blockNumber ? curveProductionDeployment.blockHash : point.blockHash, timestamp, transactions: [] }),
    getCode: async (arg: { address: Address }) => { state.calls++; const entry = Object.values(productionArchive.runtimes).find((r: any) => same(r.address, arg.address)) as any;
      return entry ? entry.code : old.getCode(arg as never); },
    estimateMaxPriorityFeePerGas: async () => 1n,
    readContract: async (arg: { functionName: string }) => {
      switch (arg.functionName) {
        case "projectRegistry": return curveProductionPins.registry[0]; case "graduationEngine": return curveProductionPins.engine[0];
        case "factory": return curveProductionPins.factory[0]; case "poolManager": return curveProductionPins.poolManager[0];
        case "positionManager": return curveProductionPins.positionManager[0]; case "initializationGuard": return curveProductionPins.guard[0];
        case "operatingRecipient": return curveProductionDeployment.operating;
      }
      return old.readContract(arg as never);
    },
    call: async (arg: { to: Address }) => {
      if (BigInt(arg.to) === 200n) { if (state.unavailableNitro) throw Error("unsupported"); return { data: state.badNitro ? "0x1234" : encodeFunctionResult({ abi: nitroAbi, functionName: "gasEstimateComponents", result: [50000n, state.l1, 2n, state.l1Base] }) }; }
      return { data: "0x" };
    },
  } as unknown as EarningsRpc;
  const context = productionEarningsContext(rpc, point);
  const input: ClaimPreparationInput = { context, account: local.creator, beneficiary: local.creator, kind: "eoa", operation: "creation-fees" };
  return { input, state };
}
test("pinned unsigned4663 preparation requires transaction-specific positive L1 fee evidence", async () => {
  const p = production(), r = await prepareClaimExecutionReview(p.input);
  assert.ok(isClaimExecutionReview(r), JSON.stringify(r)); assert.equal(r.status, "review-only"); assert.equal(r.fees.status, "verified-nitro");
  assert.equal(r.scope, "production-unsigned"); assert.equal(r.executionEnabled, false);
  if (r.fees.status === "verified-nitro") { assert.equal(r.fees.estimatedL1Wei, "20000"); assert.equal(r.fees.estimatedL2Wei, "80000"); assert.equal(r.fees.estimatedTotalWei, "100000"); }
  p.state.unavailableNitro = true; const absent = await prepareClaimExecutionReview(p.input); assert.ok(isClaimExecutionReview(absent)); assert.equal(absent.status, "fee-unavailable");
  p.state.unavailableNitro = false; p.state.badNitro = true; assert.equal((await prepareClaimExecutionReview(p.input)).status, "fee-unavailable");
  p.state.badNitro = false; p.state.l1 = 0n; assert.equal((await prepareClaimExecutionReview(p.input)).status, "fee-unavailable");
});
test("production preparation rejects altered deployment pins before RPC and never admits arbitrary networks", async () => {
  const p = production(); p.input.context.factoryRuntimeHash = eh(999);
  assert.equal(claimContextIsAllowed(p.input.context), false); assert.equal((await prepareClaimExecutionReview(p.input)).status, "unavailable"); assert.equal(p.state.calls, 0);
  const f = fixture(); (f.input.context as { chainId: number }).chainId = 1; assert.equal((await prepareClaimExecutionReview(f.input)).status, "unavailable");
});
test("two-provider preparation refuses missing, conflicting or duplicated observations", async () => {
  const f = fixture(); const peer = { ...f.input, context: { ...f.context, rpc: { ...f.context.rpc } as EarningsRpc } };
  const agreed = await prepareCorroboratedClaimExecutionReview([f.input, peer]);
  assert.equal(agreed.status, "corroborated-unsigned-review");
  assert.equal((await prepareCorroboratedClaimExecutionReview([f.input, f.input])).status, "unavailable");
  peer.context.rpc.getTransactionCount = (async () => 1) as typeof peer.context.rpc.getTransactionCount;
  assert.equal((await prepareCorroboratedClaimExecutionReview([f.input, peer])).status, "unavailable");
  peer.context.rpc.getCode = async () => { throw Error("Provider offline"); };
  assert.equal((await prepareCorroboratedClaimExecutionReview([f.input, peer])).status, "unavailable");
});
