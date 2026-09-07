import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { mock } from "node:test";
import { createWalletClient, custom } from "viem";
import { createInjectedSignerSelection, type InjectedSignerProvider } from "../injected-wallet-signer";
import { walletGatewayKey } from "../wallet-gateway";
import { bindVNextExternalWallet } from "./wallet-handoff";
import { createVNextWalletReviewDispatcher } from "./wallet-review-dispatch";
import { findBlockingVNextWalletRequest, isVNextWalletProviderRequestActive, readVNextWalletRequestJournal, recordPreparedVNextWalletRequest } from "./execution-recovery";
import { prepareVNextWalletTransaction, vNextWalletRpcTransaction } from "./wallet-submission";
import type { VNextAuthorizationPlan } from "./authorization-plan";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";

const testedKinds = new Set<string>();
const uuid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const hash = `0x${"a".repeat(64)}` as const;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** Invoked by the real 0x adapter/verifier authorization fixture, not a fabricated plan. */
export async function assertInjectedSignerHandoff(plan: VNextAuthorizationPlan, evidence: VNextPreSignEvidence) {
  if (testedKinds.has(plan.kind)) return;
  testedKinds.add(plan.kind);
  assert.equal(plan.provider, "zero-x-swap");
  const wallet = plan.recipient;
  const candidate = { address: wallet, connectorType: "injected", walletClientType: "metamask", meta: { id: "io.metamask" }, type: "ethereum" as const };
  const walletKey = walletGatewayKey(candidate);
  const identity = { authenticated: true, userId: "authenticated-fixture-user", linkedAddress: wallet, activeWalletKey: walletKey, address: wallet, chainId: 4663 };
  const binding = bindVNextExternalWallet({ selectedWalletKey: walletKey, selectedWalletKind: "external", selectedWalletName: "MetaMask",
    connectedAddress: wallet, connectedChainId: 4663, connectorId: "io.metamask", connectorType: "injected",
    walletClientAddress: wallet, walletClientChainId: 4663, recipient: wallet });
  const requireWeb = createRequire(import.meta.url);
  // TEST ONLY: exercise the exact installed SDK class, without altering or using internal fields in production.
  const sdkDir = path.dirname(requireWeb.resolve("@privy-io/react-auth"));
  const { PrivyProxyProvider } = requireWeb(path.join(sdkDir, "index-BKa2zZmu.js"));
  const scenarios = ["immediate-4001", "late-4001", "late-hash", "context-change", "unknown", "lost-response", "pre-storage-failure", "post-storage-failure", "expired-before-dispatch", "wrong-envelope", "walletconnect"];
  for (const scenario of scenarios) {
    let now = plan.preparedAtMs;
    let raw = "";
    let failStorage = false;
    let released = 0;
    let sends = 0;
    let proxySends = 0;
    let resolve!: (value: unknown) => void;
    let reject!: (value: unknown) => void;
    const pending = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
    const events = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider: InjectedSignerProvider = {
      on(event, fn) { if (!events.has(event)) events.set(event, new Set()); events.get(event)!.add(fn); },
      removeListener(event, fn) { events.get(event)?.delete(fn); },
      request(args) {
        assert.equal(this, provider, "correct EIP-1193 method receiver is retained");
        if (args.method === "eth_accounts") return Promise.resolve([wallet]);
        if (args.method === "eth_chainId") return Promise.resolve("0x1237");
        assert.equal(args.method, "eth_sendTransaction");
        sends++;
        assert.deepEqual(args.params, [rpc], "exact authorized envelope, including gas price");
        return pending;
      }
    };
    const selection = createInjectedSignerSelection();
    selection.setIdentity(identity);
    selection.announce({ info: { uuid, name: "Selected injected wallet", rdns: "io.metamask" }, provider });
    assert.equal(selection.getSnapshot().selectedUuid, null, "an announcement never selects itself");
    await assert.rejects(() => selection.prepare(walletKey, wallet), /Choose an injected signer/);
    selection.select(uuid);
    const ticket = await selection.prepare(walletKey, wallet);
    const rpc = vNextWalletRpcTransaction(prepareVNextWalletTransaction({ plan, evidence, connectedAddress: wallet, connectedChainId: 4663, nowMs: now }));
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { if (failStorage) throw new Error("storage unavailable"); raw = value; } };
    const requestId = randomUUID();
    assert.ok(recordPreparedVNextWalletRequest({ requestId, wallet, plan, walletNonceBeforeRequest: 226n, requestBlockNumber: 100n,
      connectorId: "io.metamask", connectorType: "injected", walletClientType: "metamask" }, storage, now));
    // A real installed Privy proxy exists as the normal identity/client-facing path.
    const proxy = new PrivyProxyProvider({ ...provider, request(args: { method: string }) {
      if (args.method === "eth_sendTransaction") proxySends++;
      return pending;
    } });
    const walletClient = createWalletClient({ transport: custom(proxy, { retryCount: 0 }) });
    const dispatch = createVNextWalletReviewDispatcher();
    const input = { requestId, plan, evidence, binding, selectedWalletKey: walletKey, rpcTransaction: rpc,
      injected: ticket, selection, lease: { release: () => { released++; }, released: Promise.resolve() },
      walletClientRequest: (args: { method: "eth_sendTransaction"; params: [typeof rpc] }) => walletClient.request(args) };
    if (scenario === "pre-storage-failure") {
      failStorage = true;
      assert.throws(() => dispatch(input, storage, () => now), /durably mark/);
      assert.equal(sends, 0);
      continue;
    }
    if (scenario === "expired-before-dispatch") {
      now = plan.expiresAtMs + 1;
      assert.throws(() => dispatch(input, storage, () => now));
      assert.equal(sends, 0);
      continue;
    }
    if (scenario === "wrong-envelope") {
      assert.throws(() => dispatch({ ...input, rpcTransaction: { ...rpc, value: "0x0", gas: "0x1" } }, storage, () => now), /envelope changed/);
      assert.equal(sends, 0);
      continue;
    }
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      assert.equal(readVNextWalletRequestJournal(storage, now)[0]?.state, "PREPARED", scenario);
      assert.equal(findBlockingVNextWalletRequest(wallet, storage, now), null, "PREPARED is serialized by its held Web Lock before dispatch");
      const result = dispatch(scenario === "walletconnect" ? { ...input, binding: { ...binding, selectedConnectorType: "wallet_connect" } } : input, storage, () => now);
      assert.equal(sends, scenario === "walletconnect" ? 0 : 1);
      assert.equal(proxySends, scenario === "walletconnect" ? 1 : 0);
      assert.throws(() => dispatch(input, storage, () => now), /already active/);
      if (scenario !== "immediate-4001") { now += 120_001; mock.timers.tick(120_001); await flush(); }
      if (scenario === "walletconnect") {
        assert.equal((await result).state, "UNRESOLVED", "non-targeted proxy timeout is not relabeled rejection");
        assert.equal(readVNextWalletRequestJournal(storage, now)[0].errorDiagnostic?.errorCode, -1);
        reject({ code: 4001 }); await flush();
        assert.equal(findBlockingVNextWalletRequest(wallet, storage, now)?.state, "UNRESOLVED");
        continue;
      }
      assert.equal(readVNextWalletRequestJournal(storage, now)[0].state, "PROVIDER_PENDING", "local expiry/120 seconds never cancels a sent request");
      assert.equal(isVNextWalletProviderRequestActive(requestId), true);
      assert.equal(released, 0, "pending request owns the lease, not a React component");
      if (scenario === "lost-response") {
        // A new page dispatcher still sees the durable blocking journal after a hard reload.
        assert.throws(() => createVNextWalletReviewDispatcher()(input, storage, () => plan.preparedAtMs), /durable prepared/);
        assert.equal(findBlockingVNextWalletRequest(wallet, storage, now)?.state, "PROVIDER_PENDING");
        continue;
      }
      if (scenario === "context-change") {
        selection.setIdentity({ ...identity, authenticated: false, activeWalletKey: null });
        input.plan = { ...plan, planId: randomUUID() };
        resolve(hash);
      } else if (scenario === "late-hash" || scenario === "post-storage-failure") {
        failStorage = scenario === "post-storage-failure";
        resolve(hash);
      } else reject(scenario === "unknown" ? { code: -32603, name: "RpcError", message: "cancel denied rejected SECRET" } : { code: 4001 });
      const outcome = await result;
      assert.equal(outcome.state, ["late-hash", "context-change", "post-storage-failure"].includes(scenario) ? "HASH_RECEIVED" : scenario === "unknown" ? "UNRESOLVED" : "USER_REJECTED");
      if (scenario === "post-storage-failure") {
        assert.equal(outcome.txHash, hash);
        assert.equal(outcome.durable, false);
        assert.equal(released, 0);
      } else {
        const saved = readVNextWalletRequestJournal(storage, now)[0];
        assert.equal(saved.planId, plan.planId, "eventual result belongs to the original immutable plan");
        assert.equal(saved.state, outcome.state);
        assert.equal(released, 1);
        assert.ok(!raw.includes("SECRET"));
      }
      assert.throws(() => dispatch(input, storage, () => plan.preparedAtMs), /already active/);
      assert.equal(proxySends, 0);
      assert.equal(sends, 1);
    } finally { mock.timers.reset(); }
  }

  // Selection adversaries use the same production registry and identity inputs.
  for (const scenario of ["wrong-account", "wrong-chain", "two-wallets", "conflict", "events", "logout", "replacement", "unlinked"]) {
    let accounts = [wallet]; let chain = "0x1237";
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const provider: InjectedSignerProvider = { on: (event, fn) => { listeners.set(event, fn); }, removeListener: (event) => { listeners.delete(event); },
      request: async ({ method }) => { assert.notEqual(method, "eth_sendTransaction"); return method === "eth_accounts" ? accounts : chain; } };
    const selection = createInjectedSignerSelection(); selection.setIdentity(identity);
    selection.announce({ info: { uuid, name: "Wallet", rdns: "io.metamask" }, provider });
    if (scenario === "two-wallets") {
      selection.announce({ info: { uuid: randomUUID(), name: "Wallet", rdns: "io.metamask" }, provider: { ...provider } });
      await assert.rejects(() => selection.prepare(walletKey, wallet), /Choose/);
      assert.equal(selection.getSnapshot().choices.length, 2);
    }
    selection.select(uuid);
    const ticket = await selection.prepare(walletKey, wallet);
    if (scenario === "two-wallets") { selection.assertCurrent(ticket, walletKey, wallet); continue; }
    if (scenario === "wrong-account") accounts = ["0x1111111111111111111111111111111111111111"];
    if (scenario === "wrong-chain") chain = "0x1";
    if (scenario === "conflict") selection.announce({ info: { uuid, name: "Wallet", rdns: "io.metamask" }, provider: { ...provider } });
    if (scenario === "events") listeners.get("accountsChanged")?.([wallet]);
    if (scenario === "logout") selection.setIdentity({ ...identity, authenticated: false });
    if (scenario === "unlinked") selection.setIdentity({ ...identity, linkedAddress: undefined });
    if (scenario === "replacement") provider.request = async () => [];
    if (scenario === "wrong-account" || scenario === "wrong-chain") await assert.rejects(() => selection.prepare(walletKey, wallet));
    assert.throws(() => selection.assertCurrent(ticket, walletKey, wallet));
  }
  console.log(`Injected production signer-selection/dispatch integration passed (${plan.kind}): proxy sends 0, selected sends 1; installed Privy timeout retained for WalletConnect control.`);
}
