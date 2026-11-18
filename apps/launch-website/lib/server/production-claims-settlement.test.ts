import assert from "node:assert/strict";
import test from "node:test";
import { claimExecutionReviewHash, isClaimExecutionReview, type ClaimExecutionReview } from "../claim-profiles";
import { claimFinality, type ClaimActivityIdentity, type ClaimIndexedEvidence } from "../production-claims";
import { prepareClaimExecutionReview } from "./claim-profiles";
import { boundedClaimVerificationRpc, verifyProductionClaimSettlement, type ClaimSettlementInput } from "./production-claims-settlement";
import { ea, eh, earningsTestFixture } from "./earnings-test-fixture";
import type { EarningsClaimOperation } from "../earnings-claims";
import type { EarningsRpc } from "./earnings-contracts";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, parseAbi, type Address, type Hex } from "viem";
import { fixture as profileFixture, owners } from "./claim-profile-test-fixture";
import { claimDelegatePin, claimSafePins } from "./claim-profiles";

async function fixture(operation: EarningsClaimOperation = "curve-claim") {
  const f = earningsTestFixture({ graduated: operation.startsWith("lp-") });
  const original = f.context.rpc;
  let review: ClaimExecutionReview;
  const knobs = { secondOffline: false, secondWrongEvent: false, secondNoTrace: false, reorgDuringTrace: false, traceRead: false,
    feeMismatch: false, originalUnknown: false };
  const rpc = new Proxy(original, { get(target, property) {
    if (property === "getTransaction") return async () => {
      if (knobs.originalUnknown) throw Error("provider lookup unavailable");
      return { ...await original.getTransaction({ hash: f.txHash }), gas: BigInt(review.outer!.gas!),
        maxFeePerGas: BigInt(review.outer!.maxFeePerGas!) + (knobs.feeMismatch ? 1n : 0n),
        maxPriorityFeePerGas: BigInt(review.outer!.maxPriorityFeePerGas!) };
    };
    if (property === "getTransactionReceipt") return async (arg: { hash: `0x${string}` }) => ({ ...await original.getTransactionReceipt(arg), gasUsed: 28000n });
    if (property === "request") return async (...args: unknown[]) => { const value = await Reflect.apply(original.request, original, args); knobs.traceRead = true; return value; };
    if (property === "getBlock") return async (arg: { blockNumber?: bigint }) => {
      const block = await original.getBlock(arg);
      return knobs.reorgDuringTrace && knobs.traceRead && arg.blockNumber === 11n ? { ...block, hash: eh(9911) } : block;
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } }) as EarningsRpc;
  f.context.rpc = rpc;
  const prepared = await prepareClaimExecutionReview({ context: f.context, registration: f.registration, account: f.creator, beneficiary: f.creator, kind: "eoa", operation });
  assert.equal(isClaimExecutionReview(prepared), true, JSON.stringify(prepared));
  review = prepared as ClaimExecutionReview; assert.equal(review.status, "review-only");
  f.state.request = review.inner;
  const second = new Proxy(rpc, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      if (knobs.secondOffline) throw Error("second provider offline");
      if (property === "request" && knobs.secondNoTrace) throw Error("trace unavailable");
      const result = await Reflect.apply(value, target, args);
      if (property === "getTransactionReceipt" && knobs.secondWrongEvent && (args[0] as { hash?: unknown })?.hash === f.txHash) {
        const receipt = result as Awaited<ReturnType<EarningsRpc["getTransactionReceipt"]>>;
        return { ...receipt, logs: receipt.logs.map(log => ({ ...log, data: "0x" + "0".repeat(63) + "1" })) };
      }
      return result;
    };
  } }) as EarningsRpc;
  const contexts: ClaimSettlementInput["contexts"] = [{ id: "synthetic-a", context: f.context }, { id: "synthetic-b", context: { ...f.context, rpc: second } }];
  const mine = () => {
    f.state.head = 12n; f.state.mined = true; f.state.pendingNonce = 1; f.state.afterClaim = operation !== "lp-collect";
    f.state.afterCollection = operation === "lp-collect";
    f.state.receiptNative = operation === "lp-claim-token" ? 0n : operation === "lp-collect" ? 4n : operation.startsWith("lp-") ? 70n : 75n;
    f.state.receiptToken = operation === "curve-claim" || operation === "lp-claim-native" ? 0n : operation === "lp-collect" ? 7n : 150n;
    const checkpoint = { blockNumber: "12", blockHash: eh(12), timestamp: new Date(Number(f.block(12n).timestamp) * 1000).toISOString() };
    for (const source of contexts) source.context.checkpoint = checkpoint;
  };
  const input: ClaimSettlementInput = { contexts, registration: f.registration, review, transactionHash: f.txHash };
  return { f, input, review, knobs, mine };
}
const indexed = async (activity: ClaimActivityIdentity, checkpoint: ClaimIndexedEvidence["checkpoint"]): Promise<ClaimIndexedEvidence> => ({ schemaVersion: 1, status: "canonical", activity, checkpoint });

test("canonical production-shaped recovery preserves original identities, amounts and index separation", async () => {
  const f = await fixture(); f.mine();
  const result = await verifyProductionClaimSettlement(f.input);
  assert.equal(result.stage, "indexing-pending", result.reason);
  assert.equal(result.intentHash, f.review.intentHash); assert.equal(result.reviewHash, f.review.reviewHash);
  assert.equal(result.outerReceiptStatus, "success"); assert.equal(result.innerExecution, "success");
  assert.deepEqual(result.amounts, { nativeWei: "75", tokenWei: "0" });
  assert.equal(result.activity?.actor, f.review.actor); assert.equal(result.activity?.gasPayer, f.review.gasPayer);
  assert.equal(result.activity?.ledger.toLowerCase(), f.f.ledger.toLowerCase());
  assert.equal(result.providers.status, "agree"); assert.equal(result.finality.l1Finality, "not-applicable");
  const durable = await verifyProductionClaimSettlement({ ...f.input, indexed });
  assert.equal(durable.stage, "canonical-l2"); assert.equal(durable.indexed, true);
  const localPolicy = await verifyProductionClaimSettlement({ ...f.input, indexed,
    finalityPolicy: { kind: "synthetic-local-v1", chainId: 31337, checkpointBlockHash: eh(11) } });
  assert.equal(localPolicy.stage, "settled"); assert.equal(localPolicy.scope, "synthetic-local");
  assert.equal(localPolicy.finality.policy, "synthetic-local-v1"); assert.equal(localPolicy.finality.productionPolicySupported, false);
});

test("production cannot become settled through caller flags, report hashes, posted batches or local policy", () => {
  const at = { blockNumber: "10", blockHash: eh(10), timestamp: "2026-11-18T00:00:00Z" };
  for (const policy of [undefined, { kind: "synthetic-local-v1", chainId: 31337, checkpointBlockHash: eh(10) },
    { kind: "ethereum-l1", accepted: true, finalized: true, reportHash: eh(10) }]) {
    assert.equal(claimFinality(4663, at, policy as never).status, "unverified");
  }
  assert.equal(claimFinality(31337, at, { kind: "synthetic-local-v1", chainId: 31337, checkpointBlockHash: eh(999) }).status, "unverified");
});

test("missing native traces retain receipt-observed and never invent settlement or fee zeros", async () => {
  const f = await fixture(); f.mine(); f.f.state.traceAvailable = false;
  const r = await verifyProductionClaimSettlement({ ...f.input, indexed });
  assert.equal(r.stage, "receipt-observed", r.reason); assert.equal(r.receiptObserved, true);
  assert.equal(r.innerExecution, "unproven"); assert.equal(r.amounts, undefined); assert.equal(r.activity, undefined);
});

test("asset-specific LP receipts preserve token identity, full pool/custody and exact independent transfers", async () => {
  for (const operation of ["lp-claim-native", "lp-claim-token", "lp-collect"] as const) {
    const f = await fixture(operation); f.mine(); if (operation === "lp-claim-token") f.f.state.traceAvailable = false;
    const r = await verifyProductionClaimSettlement({ ...f.input, indexed });
    assert.equal(r.stage, "canonical-l2", operation + ": " + r.reason);
    assert.equal(r.activity?.token?.toLowerCase(), f.f.token.toLowerCase()); assert.equal(r.activity?.pool?.positionTokenId, "1");
    assert.equal(r.activity?.pool?.principalLiquidityWei, "1000"); assert.equal(r.activity?.pool?.poolKey.fee, 3000);
    assert.equal(r.activity?.pool?.custodian, f.f.context.graduation.address);
    assert.equal(r.amounts?.nativeWei, operation === "lp-claim-token" ? "0" : operation === "lp-collect" ? "4" : "70");
    assert.equal(r.amounts?.tokenWei, operation === "lp-claim-native" ? "0" : operation === "lp-collect" ? "7" : "150");
  }
});

test("missing hash recovery finds the original outer payer nonce without requesting another signature", async () => {
  const f = await fixture(); f.mine();
  const r = await verifyProductionClaimSettlement({ ...f.input, transactionHash: undefined });
  assert.equal(r.stage, "indexing-pending", r.reason); assert.equal(r.transactionHash, f.f.txHash);
  const pending = await fixture();
  const p = await verifyProductionClaimSettlement({ ...pending.input, transactionHash: undefined });
  assert.equal(p.stage, "submitted", p.reason); assert.equal(p.transactionHash, undefined);
});

test("reorgs, wrong gas, malformed receipts and provider failures never produce canonical earnings", async () => {
  for (const mode of ["reorgReview", "reorgReceipt", "feeMismatch", "secondOffline", "secondWrongEvent", "reorgDuringTrace"] as const) {
    const f = await fixture(); f.mine();
    if (mode === "reorgReview" || mode === "reorgReceipt") f.f.state[mode] = true; else f.knobs[mode] = true;
    const r = await verifyProductionClaimSettlement({ ...f.input, indexed });
    assert.equal(r.stage, "unavailable", mode + ": " + r.reason); assert.equal(r.activity, undefined);
  }
});

test("a forged indexed row, wrong checkpoint or advanced cursor is not durable fee evidence", async () => {
  for (const mutate of [
    (a: ClaimActivityIdentity) => ({ ...a, beneficiary: ea(99999) }),
    (a: ClaimActivityIdentity) => ({ ...a, token: ea(99999) }),
    (a: ClaimActivityIdentity) => ({ ...a, nativeWei: "9999" }),
    (a: ClaimActivityIdentity) => ({ ...a, logIndex: a.logIndex + 1 }),
  ]) {
    const f = await fixture(); f.mine();
    const r = await verifyProductionClaimSettlement({ ...f.input, indexed: async (activity, checkpoint) => ({ schemaVersion: 1, status: "canonical", activity: mutate(activity), checkpoint }) });
    assert.equal(r.stage, "indexing-pending"); assert.equal(r.indexed, false);
  }
  const f = await fixture(); f.mine();
  const wrong = await verifyProductionClaimSettlement({ ...f.input, indexed: async (activity, checkpoint) => ({ schemaVersion: 1, status: "canonical", activity, checkpoint: { ...checkpoint, blockHash: eh(9999) } }) });
  assert.equal(wrong.stage, "indexing-pending");
});

test("outer-chain revert is distinct from success and preserves entitlement without claiming fees", async () => {
  const f = await fixture(); f.mine(); f.f.state.revertReceipt = true;
  const r = await verifyProductionClaimSettlement(f.input);
  assert.equal(r.stage, "reverted", r.reason); assert.equal(r.outerReceiptStatus, "reverted");
  assert.equal(r.innerExecution, "reverted"); assert.equal(r.activity, undefined); assert.equal(r.amounts, undefined);
});

test("verification cannot broaden providers, activate writes or exceed bounded RPC dispatch", async () => {
  const f = await fixture(); f.mine();
  const duplicate = await verifyProductionClaimSettlement({ ...f.input, contexts: [f.input.contexts[0], f.input.contexts[0]] });
  assert.equal(duplicate.stage, "unavailable"); assert.equal(duplicate.reason, "invalid-review-or-independent-provider-bindings");
  const altered = structuredClone(f.review); altered.outer!.to = ea(99999); altered.reviewHash = claimExecutionReviewHash(altered);
  assert.equal((await verifyProductionClaimSettlement({ ...f.input, review: altered })).stage, "unavailable");
  const bounded = boundedClaimVerificationRpc(f.f.context.rpc, () => 1, 1);
  await bounded.getChainId(); assert.throws(() => bounded.getChainId(), /budget/);
  const writes = boundedClaimVerificationRpc(f.f.context.rpc);
  assert.throws(() => writes.request({ method: "eth_sendRawTransaction", params: [] } as never), /read-only/);
});

async function walletFixture(kind: "metamask-7702" | "safe-1.4.1", operation: EarningsClaimOperation = "curve-claim") {
  const f = profileFixture(kind, operation.startsWith("lp-")); f.input.operation = operation;
  const rpc = f.context.rpc;
  let review: ClaimExecutionReview;
  const state = { failure: false, outerReverted: false, revokeAtReceipt: false, replaceAfterReceipt: false, duplicateInner: false, wrongExecutionHash: false };
  const safeAbi = parseAbi(["event ExecutionSuccess(bytes32 txHash,uint256 payment)", "event ExecutionFailure(bytes32 txHash,uint256 payment)",
    "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)"]);
  const wrapped = new Proxy(rpc, { get(target, property) {
    if (property === "getTransaction") return async () => ({ ...await rpc.getTransaction({ hash: f.txHash }),
      from: review.outer!.from, to: review.outer!.to, input: review.outer!.data, nonce: Number(BigInt(review.outer!.nonce)),
      gas: BigInt(review.outer!.gas!), maxFeePerGas: BigInt(review.outer!.maxFeePerGas!), maxPriorityFeePerGas: BigInt(review.outer!.maxPriorityFeePerGas!) });
    if (property === "getTransactionReceipt") return async (arg: { hash: HashLike }) => {
      const receipt = await rpc.getTransactionReceipt(arg);
      if (arg.hash !== f.txHash) return receipt;
      const logs = state.failure || state.outerReverted ? [] : receipt.logs;
      return { ...receipt, status: state.outerReverted ? "reverted" : "success", from: review.outer!.from, to: review.outer!.to, gasUsed: 28000n,
        logs: kind !== "safe-1.4.1" || state.outerReverted ? logs : [...logs, { address: review.actor,
          topics: encodeEventTopics({ abi: safeAbi, eventName: state.failure ? "ExecutionFailure" : "ExecutionSuccess" }),
          data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [state.wrongExecutionHash ? eh(99999) : review.wallet.safe!.transactionHash, 0n]),
          blockNumber: 11n, blockHash: eh(11), transactionHash: f.txHash, transactionIndex: 0, logIndex: 4, removed: false }] };
    };
    if (property === "readContract") return async (arg: { address: Address; functionName: string; blockNumber?: bigint }) => {
      if (kind === "safe-1.4.1" && arg.address.toLowerCase() === f.creator.toLowerCase() && arg.functionName === "nonce") {
        return arg.blockNumber && arg.blockNumber >= 11n && !state.outerReverted ? 1n : 0n;
      }
      return rpc.readContract(arg as never);
    };
    if (property === "getCode") return async (arg: { address: Address; blockNumber?: bigint }) => {
      if (kind === "metamask-7702" && arg.address.toLowerCase() === f.creator.toLowerCase()
          && ((state.revokeAtReceipt && arg.blockNumber === 11n) || (state.replaceAfterReceipt && arg.blockNumber && arg.blockNumber >= 12n))) return "0x";
      return rpc.getCode(arg as never);
    };
    if (property === "call") return async () => ({ data: kind === "safe-1.4.1" ? encodeFunctionResult({ abi: safeAbi, functionName: "execTransaction", result: true }) : "0x" });
    if (property === "request") return async () => {
      if (!f.baseState.traceAvailable) throw Error("trace unavailable");
      const r = review.inner, payment = { type: "CALL", from: r.ledger, to: r.beneficiary, input: "0x", value: "0x" + f.baseState.receiptNative.toString(16) };
      const inner = { type: "CALL", from: review.actor, to: r.to, input: r.data, value: "0x0", calls: f.baseState.receiptNative > 0n ? [payment] : [] };
      return { type: "CALL", from: review.outer!.from, to: review.outer!.to, input: review.outer!.data, value: "0x0",
        calls: kind === "safe-1.4.1" ? [{ type: "DELEGATECALL", from: review.actor, to: claimSafePins.singleton, input: review.outer!.data, value: "0x0",
          calls: state.duplicateInner ? [inner, { ...inner, calls: [] }] : [inner] }] : inner.calls };
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } }) as EarningsRpc;
  f.context.rpc = wrapped; f.input.context = f.context;
  let prepared = await prepareClaimExecutionReview(f.input);
  assert.equal(isClaimExecutionReview(prepared), true, JSON.stringify(prepared));
  if (kind === "safe-1.4.1") {
    const proposal = prepared as ClaimExecutionReview;
    const signatures = await Promise.all(owners.slice(0, 2).map(async owner => ({ address: owner.address, signature: await owner.sign({ hash: proposal.wallet.safe!.transactionHash }) })));
    f.input.safeSignatures = ("0x" + signatures.sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map(v => v.signature.slice(2)).join("")) as Hex;
    prepared = await prepareClaimExecutionReview(f.input);
  }
  assert.equal(isClaimExecutionReview(prepared), true, JSON.stringify(prepared)); review = prepared as ClaimExecutionReview;
  assert.equal(review.status, "review-only", JSON.stringify(review));
  f.baseState.request = review.inner; f.baseState.head = 12n; f.baseState.mined = true; f.baseState.afterClaim = true;
  f.baseState.receiptNative = operation === "lp-claim-token" ? 0n : operation.startsWith("lp-") ? 70n : 75n;
  f.baseState.receiptToken = operation === "lp-claim-token" ? 150n : 0n; f.state.receiptNonce = 1;
  const checkpoint = { blockNumber: "12", blockHash: eh(12), timestamp: new Date(Number(f.block(12n).timestamp) * 1000).toISOString() };
  f.context.checkpoint = checkpoint;
  const input: ClaimSettlementInput = { contexts: [{ id: "synthetic-a", context: f.context }, { id: "synthetic-b", context: { ...f.context } }],
    review, registration: f.registration, transactionHash: f.txHash, indexed };
  return { f, review, input, state };
}
type HashLike = `0x${string}`;

test("delegation revoked before a receipt invalidates the profile; later changes do not erase historical settlement", async () => {
  const f = await walletFixture("metamask-7702");
  assert.equal(f.review.wallet.delegation?.designator, claimDelegatePin.designator);
  assert.equal((await verifyProductionClaimSettlement(f.input)).stage, "canonical-l2");
  f.state.replaceAfterReceipt = true;
  assert.equal((await verifyProductionClaimSettlement(f.input)).stage, "canonical-l2");
  f.state.revokeAtReceipt = true;
  assert.equal((await verifyProductionClaimSettlement(f.input)).stage, "unavailable");
});

test("Safe beneficiary settlement binds genuine two-owner outer execution and preserves distinct gas payer", async () => {
  for (const operation of ["curve-claim", "lp-claim-token"] as const) {
    const f = await walletFixture("safe-1.4.1", operation);
    const r = await verifyProductionClaimSettlement(f.input);
    assert.equal(r.stage, "canonical-l2", r.reason); assert.equal(r.activity?.actor, f.f.creator);
    assert.equal(r.activity?.beneficiary, f.f.creator); assert.equal(r.activity?.gasPayer, f.review.gasPayer);
    assert.notEqual(r.activity?.gasPayer, r.activity?.actor);
    f.state.duplicateInner = true;
    assert.equal((await verifyProductionClaimSettlement(f.input)).stage, "receipt-observed", "A duplicated/reentrant inner call cannot be settled");
  }
});

test("Safe ExecutionFailure is logical failure despite outer success, with no fee success or amount fabricated", async () => {
  const f = await walletFixture("safe-1.4.1"); f.state.failure = true; f.f.baseState.afterClaim = false;
  const r = await verifyProductionClaimSettlement(f.input);
  assert.equal(r.stage, "reverted", r.reason); assert.equal(r.outerReceiptStatus, "success"); assert.equal(r.innerExecution, "reverted");
  assert.equal(r.reason, "safe-inner-call-reverted"); assert.equal(r.activity, undefined); assert.equal(r.amounts, undefined);
  f.state.wrongExecutionHash = true;
  assert.equal((await verifyProductionClaimSettlement(f.input)).stage, "unavailable");
});

test("a reverted Safe outer transaction leaves its Safe nonce unchanged without implying an inner claim", async () => {
  const f = await walletFixture("safe-1.4.1"); f.state.outerReverted = true; f.f.baseState.afterClaim = false;
  const r = await verifyProductionClaimSettlement(f.input);
  assert.equal(r.stage, "reverted", r.reason); assert.equal(r.outerReceiptStatus, "reverted"); assert.equal(r.innerExecution, "reverted");
});
