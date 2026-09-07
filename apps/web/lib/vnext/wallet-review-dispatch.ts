import { keccak256 } from "viem";
import { injectedSignerSelection, type InjectedSignerTicket } from "../injected-wallet-signer";
import type { VNextAuthorizationPlan } from "./authorization-plan";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import { prepareVNextWalletTransaction, vNextWalletRpcTransaction, type VNextWalletRpcTransaction } from "./wallet-submission";
import { emitVNextWalletHandoffDiagnostic, invokeVNextExternalWalletRequest, type VNextWalletHandoffBinding } from "./wallet-handoff";
import { isVNextUserRejectedRequest } from "./wallet-request-error";
import { clearVNextWalletProviderRequestActive, findBlockingVNextWalletRequest, findUnresolvedVNextExecution,
  markVNextWalletProviderRequestActive, promoteVNextWalletRequestToSubmitted, readVNextWalletRequestJournal,
  recordVNextWalletRequestError, transitionVNextWalletRequest, type VNextExecutionStorage } from "./execution-recovery";
import type { VNextWalletRequestLease } from "./wallet-request-lock";

export type VNextWalletDispatchResult = { state: "USER_REJECTED" | "HASH_RECEIVED" | "UNRESOLVED"; durable: boolean; txHash?: `0x${string}` };
// Page lifetime, independent of React. Reload loses promises but never clears the durable journal.
export function createVNextWalletReviewDispatcher() {
const invocations = new Map<string, { wallet: string; blocking: boolean; result?: Promise<VNextWalletDispatchResult> }>();
return function dispatchVNextWalletReview(input: {
  requestId: string;
  plan: VNextAuthorizationPlan;
  evidence: VNextPreSignEvidence;
  binding: VNextWalletHandoffBinding;
  selectedWalletKey: string;
  rpcTransaction: VNextWalletRpcTransaction;
  lease: VNextWalletRequestLease;
  injected?: InjectedSignerTicket;
  selection?: typeof injectedSignerSelection;
  walletClientRequest: (args: { method: "eth_sendTransaction"; params: [VNextWalletRpcTransaction] }) => Promise<unknown>;
}, storage?: VNextExecutionStorage, clock = Date.now): Promise<VNextWalletDispatchResult> {
  const { requestId, lease } = input;
  const plan = structuredClone(input.plan);
  const binding = { ...input.binding };
  const wallet = binding.wallet.toLowerCase();
  if (invocations.has(requestId) || [...invocations.values()].some((entry) => entry.wallet === wallet && entry.blocking)) {
    throw new Error("A wallet request is already active.");
  }
  const now = clock();
  const rpcTransaction = vNextWalletRpcTransaction(prepareVNextWalletTransaction({ plan, evidence: input.evidence,
    connectedAddress: binding.wallet, connectedChainId: binding.chainId, nowMs: now }));
  if (JSON.stringify(rpcTransaction) !== JSON.stringify(input.rpcTransaction)) throw new Error("The prepared transaction envelope changed.");
  const record = readVNextWalletRequestJournal(storage, now).find((item) => item.requestId === requestId);
  const blocking = findBlockingVNextWalletRequest(binding.wallet, storage, now);
  if (!record || record.state !== "PREPARED" || record.planId !== plan.planId || record.payloadHash !== plan.payloadHash.toLowerCase()
    || record.wallet.toLowerCase() !== wallet || record.calldataHash !== keccak256(rpcTransaction.data)
    || (blocking && blocking.requestId !== requestId) || findUnresolvedVNextExecution(binding.wallet, storage, now)) {
    throw new Error("The exact durable prepared wallet request is unavailable or blocked.");
  }
  const useInjected = plan.provider === "zero-x-swap" && binding.selectedConnectorType === "injected";
  if (useInjected) {
    if (!input.injected) throw new Error("Explicit injected signer selection is required.");
    (input.selection ?? injectedSignerSelection).assertCurrent(input.injected, input.selectedWalletKey, plan.recipient);
  }
  if (!transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", storage, now)) throw new Error("RMT could not durably mark the wallet request before provider invocation.");
  const invocation: { wallet: string; blocking: boolean; result?: Promise<VNextWalletDispatchResult> } = { wallet, blocking: true };
  invocations.set(requestId, invocation);
  markVNextWalletProviderRequestActive(requestId);
  const diagnostic = (event: string, lifecycleState: "PROMPT_REQUESTED" | "USER_REJECTED" | "unresolved" | "hash_received") => {
    emitVNextWalletHandoffDiagnostic({ event, lifecycleState, requestId, connectorId: binding.connectorId,
      connectorType: binding.connectorType, walletClientType: binding.walletClientType,
      selectedWalletName: binding.walletName, chainId: binding.chainId });
  };
  diagnostic("provider_request_invoked", "PROMPT_REQUESTED");
  let pending: Promise<unknown>;
  try {
    pending = invokeVNextExternalWalletRequest(() => useInjected
      ? input.injected!.request.call(input.injected!.provider, { method: "eth_sendTransaction", params: [rpcTransaction] })
      : input.walletClientRequest({ method: "eth_sendTransaction", params: [rpcTransaction] }));
  } catch (error) { pending = Promise.reject(error); }
  // No timeout race, expiry race, retry or fallback. Keep the actual result and original plan.
  invocation.result = pending.then((hash): VNextWalletDispatchResult => {
    if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash) || /^0x0{64}$/i.test(hash)) throw new Error("Invalid provider transaction hash.");
    const txHash = hash as `0x${string}`;
    let durable = false;
    try { durable = Boolean(promoteVNextWalletRequestToSubmitted({ requestId, wallet: binding.wallet, plan, txHash }, storage, clock())); }
    catch { /* Preserve a received hash even if storage access itself throws. Never resend. */ }
    diagnostic("provider_returned_hash", "hash_received");
    return { state: "HASH_RECEIVED", txHash, durable };
  }).catch((error: unknown): VNextWalletDispatchResult => {
    const rejected = isVNextUserRejectedRequest(error);
    let durable = false;
    try {
      durable = Boolean(transitionVNextWalletRequest(requestId, rejected ? "USER_REJECTED" : "UNRESOLVED", storage, clock()));
      recordVNextWalletRequestError(requestId, error, storage, clock());
    } catch { /* Storage failure retains the in-memory duplicate guard. */ }
    diagnostic(rejected ? "provider_rejected_4001" : "provider_error_unresolved", rejected ? "USER_REJECTED" : "unresolved");
    return { state: rejected && durable ? "USER_REJECTED" : "UNRESOLVED", durable };
  }).then((result) => {
    clearVNextWalletProviderRequestActive(requestId);
    // A failed durable write must not release the page's duplicate guard.
    if (result.durable) { invocation.blocking = false; lease.release(); }
    return result;
  });
  try { transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", storage, now); }
  catch { /* The provider already received the request; keep waiting, never fallback. */ }
  return invocation.result;
}
}
export const dispatchVNextWalletReview = createVNextWalletReviewDispatcher();
