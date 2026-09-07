import assert from "node:assert/strict";
import {
  createVNextWalletRequestErrorDiagnostic,
  normalizeVNextWalletRequestErrorDiagnostic
} from "./wallet-request-diagnostics";
import {
  findBlockingVNextWalletRequest, readVNextWalletRequestJournal,
  recordVNextWalletRequestError, reconcileExpiredVNextWalletRequest,
  transitionVNextWalletRequest, VNEXT_EXECUTION_STORAGE_KEY,
  type VNextWalletRequestRecord
} from "./execution-recovery";
import { isVNextUserRejectedRequest } from "./wallet-request-error";

async function main() {
  const now = 1_788_766_217_237;
  const request: VNextWalletRequestRecord = {
    schemaVersion: 1, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    planId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    payloadHash: `0x${"1".repeat(64)}`, chainId: 4_663,
    wallet: "0x1111111111111111111111111111111111111111",
    provider: "zero-x-swap", planKind: "swap",
    target: "0x0000000000001fF3684f28c67538d4D072C22734",
    value: "500000000000000", calldataHash: `0x${"2".repeat(64)}`,
    inputAsset: "0x0000000000000000000000000000000000000000",
    outputAsset: "0x2222222222222222222222222222222222222222",
    inputAmountAtomic: "500000000000000", protectedOutputAtomic: "1227476",
    finalOnchainDeadline: "1788766452", planExpiresAtMs: now + 6_436,
    requestedAtMs: now, walletNonceBeforeRequest: "226",
    requestBlockNumber: "56656790", requestBlockHash: `0x${"3".repeat(64)}`,
    connectorId: "io.metamask", connectorType: "injected", walletClientType: "metamask",
    promptRequestedAtMs: now + 15, providerPendingAtMs: now + 21,
    state: "UNRESOLVED", updatedAtMs: now + 120_033
  };
  let raw = JSON.stringify({ schemaVersion: 2, executions: [], walletRequests: [request] });
  let writes = 0;
  const storage = {
    getItem: (key: string) => key === VNEXT_EXECUTION_STORAGE_KEY ? raw : null,
    setItem: (_key: string, value: string) => { writes += 1; raw = value; }
  };
  const secretMarker = "SENSITIVE_DATA_MUST_NOT_BE_RETAINED";
  const timeout = { name: "UnknownRpcError", code: -1, message: secretMarker,
    stack: secretMarker, provider: { session: secretMarker },
    cause: { name: "Error", message: secretMarker } };
  const diagnostic = recordVNextWalletRequestError(request.requestId, timeout, storage, now + 120_033);
  assert.equal(diagnostic?.elapsedMs, 120_012);
  assert.equal(diagnostic?.errorCode, -1);
  assert.equal(diagnostic?.errorName, "UnknownRpcError");
  assert.equal(diagnostic?.causeName, "Error");
  assert.equal(diagnostic?.connectorId, "io.metamask");
  assert.equal(writes, 1);
  assert.ok(!raw.includes(secretMarker));
  const persisted = readVNextWalletRequestJournal(storage, now + 120_034)[0];
  assert.deepEqual(persisted.errorDiagnostic, diagnostic);
  const { errorDiagnostic: _diagnostic, ...unchanged } = persisted;
  assert.deepEqual(unchanged, request, "diagnostics cannot change authority, state, nonce, timestamps or hashes");
  assert.equal(persisted.txHash, undefined);
  assert.equal(findBlockingVNextWalletRequest(request.wallet, storage, now + 120_034)?.state, "UNRESOLVED");
  assert.equal(recordVNextWalletRequestError("unknown", timeout, storage, now + 120_034), null);
  assert.equal(writes, 1, "unknown request diagnostics cannot manufacture journal records");

  assert.equal(isVNextUserRejectedRequest(timeout), false);
  assert.equal(isVNextUserRejectedRequest({ code: 4001 }), true);
  assert.equal(isVNextUserRejectedRequest({ cause: { name: "UserRejectedRequestError" } }), true);
  for (const error of [{ code: -32603 }, { code: -32000 }, new Error("rejected canceled denied"), new Error("transport disconnect")]) {
    assert.equal(isVNextUserRejectedRequest(error), false);
  }

  let rejectRaw!: (reason: unknown) => void;
  let rejectTimeout!: (reason: unknown) => void;
  const providerPromise = new Promise<never>((_resolve, reject) => { rejectRaw = reject; });
  const timeoutPromise = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const wrapped = Promise.race([providerPromise, timeoutPromise]);
  rejectTimeout(timeout);
  await assert.rejects(wrapped, (error) => error === timeout);
  rejectRaw({ code: 4001 });
  await Promise.resolve();
  assert.equal(findBlockingVNextWalletRequest(request.wallet, storage, now + 120_035)?.state, "UNRESOLVED",
    "late underlying rejection does not retroactively settle a timed-out wrapper or clear history");

  // Stable nonce observations, even from two sources and 15 seconds apart,
  // do not establish absence of a withheld signed transaction. No new recovery bypass.
  for (const [offset, latestNonce, pendingNonce] of [[300_000, 226n, 226n], [315_000, 226n, 226n], [330_000, 227n, 227n]] as const) {
    const result = reconcileExpiredVNextWalletRequest({ request: persisted, latestNonce, pendingNonce, nowMs: now + offset }, storage);
    assert.equal(result.state, "UNRESOLVED");
  }

  const hostile = new Proxy({}, { get() { throw new Error(secretMarker); } });
  assert.equal(createVNextWalletRequestErrorDiagnostic({ error: hostile, elapsedMs: 1 }).errorCode, null);
  const bounded = createVNextWalletRequestErrorDiagnostic({
    error: { code: "4001", name: secretMarker, cause: { code: Infinity, name: secretMarker } },
    elapsedMs: Infinity, connectorId: secretMarker.repeat(20), connectorType: "bad token value"
  });
  assert.equal(bounded.errorCode, null);
  assert.equal(bounded.errorName, null);
  assert.equal(bounded.connectorId, null);
  assert.equal(bounded.connectorType, null);
  assert.equal(bounded.elapsedMs, 0);
  assert.deepEqual(normalizeVNextWalletRequestErrorDiagnostic({ ...diagnostic, message: secretMarker, stack: secretMarker }), diagnostic);
  raw = JSON.stringify({ schemaVersion: 2, executions: [], walletRequests: [{ ...request, errorDiagnostic: { schemaVersion: 99, message: secretMarker } }] });
  assert.equal(findBlockingVNextWalletRequest(request.wallet, storage, now + 120_035)?.requestId, request.requestId,
    "invalid optional diagnostics must never erase a blocking request");
  assert.equal(readVNextWalletRequestJournal(storage, now + 120_035)[0].errorDiagnostic, undefined);
  const failedStorage = { getItem: storage.getItem, setItem() { throw new Error("storage unavailable"); } };
  assert.equal(recordVNextWalletRequestError(request.requestId, timeout, failedStorage, now + 120_035), null);
  assert.equal(findBlockingVNextWalletRequest(request.wallet, storage, now + 120_035)?.state, "UNRESOLVED");
  recordVNextWalletRequestError(request.requestId, { code: 4001, name: "UserRejectedRequestError" }, storage, now + 120_036);
  assert.equal(transitionVNextWalletRequest(request.requestId, "USER_REJECTED", storage, now + 120_037)?.state, "USER_REJECTED");
  assert.equal(readVNextWalletRequestJournal(storage, now + 120_038)[0].errorDiagnostic?.errorCode, 4001);
  assert.equal(transitionVNextWalletRequest(request.requestId, "PROMPT_REQUESTED", storage, now + 120_039), null);
  assert.equal(readVNextWalletRequestJournal(storage, now + 120_039).length, 1);
  assert.equal(readVNextWalletRequestJournal(storage, now + 120_039)[0].txHash, undefined);
  console.log("Sanitized wallet error persistence, timeout/late-rejection, and unchanged fail-closed journal checks passed.");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
