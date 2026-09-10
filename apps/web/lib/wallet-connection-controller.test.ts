import assert from "node:assert/strict";
import { test } from "node:test";
import { activateSelectedWallet, WalletConnectionController } from "./wallet-connection-controller";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const timers = new Map<number, () => void>();
  let now = 0;
  const controller = new WalletConnectionController({
    now: () => now,
    set: (fn, ms) => { timers.set(ms, fn); return ms; },
    clear: id => { timers.delete(id as number); }
  }, 8, 30);
  return { controller, timers, elapse: (ms: number) => { now += ms; }, advance: (ms: number) => timers.get(ms)?.() };
}
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const address = "0x1111111111111111111111111111111111111111";
function fixture(name: string, login = async () => {}) {
  const provider = { request: async () => [address] };
  return { name, address, provider, getEthereumProvider: async () => provider, loginOrLink: login };
}
function run(controller: WalletConnectionController, wallet: ReturnType<typeof fixture>, commits: string[], options: {
  login?: boolean; selected?: () => boolean; activate?: () => Promise<string>;
} = {}) {
  return controller.select(wallet.name, scope => activateSelectedWallet(scope, wallet, {
    stillSelected: options.selected ?? (() => true), needsLogin: () => options.login ?? false,
    activate: async () => options.activate ? options.activate() : wallet.name
  }), () => commits.push(wallet.name));
}

test("hung discovery reaches SLOW then FAILED; global uncorrelated notifications cannot complete it", () => {
  const h = harness();
  h.controller.begin();
  assert.equal(h.controller.getSnapshot().state, "CONNECTING");
  // There deliberately is no callback/event ingestion API, including same-provider retries.
  h.advance(8); assert.equal(h.controller.getSnapshot().state, "SLOW");
  h.advance(30); assert.equal(h.controller.getSnapshot().state, "FAILED");
  assert.equal(h.timers.size, 0);
});

test("integration: hung login is bounded and late MetaMask login cannot override latest Tabby intent", async () => {
  const h = harness(), login = deferred(), commits: string[] = [];
  let metaActivations = 0;
  const old = run(h.controller, fixture("MetaMask", () => login.promise), commits,
    { login: true, activate: async () => { metaActivations++; return "MetaMask"; } });
  await flush(); h.advance(8); assert.equal(h.controller.getSnapshot().state, "SLOW");
  await run(h.controller, fixture("Tabby"), commits);
  login.resolve(); await old; await flush();
  assert.deepEqual(commits, ["Tabby"]); assert.equal(metaActivations, 0);
  assert.equal(h.controller.getSnapshot().walletKey, "Tabby");
});

test("integration: expired activation remains locked until actual mutation settles, then latest selection wins", async () => {
  const h = harness(), mutation = deferred<string>(), commits: string[] = [], mutations: string[] = [];
  const old = run(h.controller, fixture("MetaMask"), commits, { activate: async () => {
    mutations.push("MetaMask-start"); const uid = await mutation.promise; mutations.push("MetaMask-end"); return uid;
  } });
  await flush();
  const next = run(h.controller, fixture("Tabby"), commits, { activate: async () => { mutations.push("Tabby"); return "Tabby"; } });
  await flush(); assert.deepEqual(mutations, ["MetaMask-start"]);
  mutation.resolve("MetaMask"); await Promise.all([old, next]);
  assert.deepEqual(mutations, ["MetaMask-start", "MetaMask-end", "Tabby"]);
  assert.deepEqual(commits, ["Tabby"]);
});

test("integration: hung mutation also bounds the queued retry without starting it", async () => {
  const h = harness(), mutation = deferred<string>(), commits: string[] = [];
  const old = run(h.controller, fixture("MetaMask"), commits, { activate: () => mutation.promise });
  await flush();
  let calls = 0;
  const next = run(h.controller, fixture("Tabby"), commits, { activate: async () => { calls++; return "Tabby"; } });
  await flush(); h.advance(30); await Promise.all([old, next]);
  mutation.resolve("MetaMask"); await flush();
  assert.equal(calls, 0); assert.deepEqual(commits, []); assert.equal(h.controller.getSnapshot().state, "FAILED");
});

test("integration: ambiguous binding and provider substitution fail closed", async () => {
  for (const mode of ["ambiguous", "provider", "account"] as const) {
    const h = harness(), commits: string[] = [], wallet = fixture("generic EIP6963");
    if (mode === "provider") wallet.getEthereumProvider = async () => ({ request: async () => [address] });
    if (mode === "account") wallet.provider.request = async () => [];
    await run(h.controller, wallet, commits, { selected: () => mode !== "ambiguous" });
    assert.equal(h.controller.getSnapshot().state, "FAILED", mode); assert.deepEqual(commits, []);
  }
});

test("integration: every provider/login/mutation await rejects an invalidated binding", async () => {
  for (const boundary of ["provider", "accounts", "login", "activation"] as const) {
    const h = harness(), gate = deferred(), commits: string[] = [], wallet = fixture("Tabby");
    let valid = true;
    if (boundary === "provider") wallet.getEthereumProvider = async () => { await gate.promise; return wallet.provider; };
    if (boundary === "accounts") wallet.provider.request = async () => { await gate.promise; return [address]; };
    if (boundary === "login") wallet.loginOrLink = () => gate.promise;
    const pending = run(h.controller, wallet, commits, {
      selected: () => valid, login: boundary === "login",
      activate: async () => { if (boundary === "activation") await gate.promise; return "Tabby"; }
    });
    await flush(); valid = false; gate.resolve(); await pending;
    assert.deepEqual(commits, [], boundary); assert.equal(h.controller.getSnapshot().state, "FAILED");
  }
});

test("cleanup cancels restore-style work, timers, subscriptions, late errors and permits remount", async () => {
  const h = harness(), gate = deferred(), commits: string[] = [];
  const unsubscribe = h.controller.subscribe(() => {});
  const restore = run(h.controller, fixture("remembered", () => gate.promise), commits, { login: true });
  await flush(); unsubscribe(); h.controller.dispose();
  assert.equal(h.timers.size, 0); await restore;
  gate.reject(new Error("late SDK rejection")); await flush();
  assert.deepEqual(commits, []); assert.equal(h.controller.getSnapshot().state, "IDLE");
  await run(h.controller, fixture("Tabby"), commits);
  assert.deepEqual(commits, ["Tabby"]); assert.equal(h.timers.size, 0);
});

test("same-provider retry cannot inherit an old attempt's success", async () => {
  const h = harness(), gate = deferred(), commits: string[] = [];
  const first = run(h.controller, fixture("MetaMask", () => gate.promise), commits, { login: true });
  await flush(); h.advance(30); await first;
  await run(h.controller, fixture("MetaMask"), commits);
  gate.resolve(); await flush(); assert.deepEqual(commits, ["MetaMask"]);
});

test("delayed browser timers cannot admit a result beyond the wall-clock deadline", async () => {
  const h = harness(), gate = deferred(), commits: string[] = [];
  const pending = run(h.controller, fixture("Tabby", () => gate.promise), commits, { login: true });
  await flush(); h.elapse(31); gate.resolve(); await pending;
  assert.equal(h.controller.getSnapshot().state, "FAILED");
  assert.deepEqual(commits, []); assert.equal(h.timers.size, 0);
});

test("integration: a refreshed SDK wallet with the same key must retain its selected provider", async () => {
  const h = harness(), wallet = fixture("Tabby"), commits: string[] = [];
  await h.controller.select(wallet.name, scope => activateSelectedWallet(scope, wallet, {
    stillSelected: () => true,
    currentProvider: async () => ({ request: async () => [address] }),
    needsLogin: () => false,
    activate: async () => { assert.fail("substituted provider must never activate"); }
  }), () => commits.push(wallet.name));
  assert.equal(h.controller.getSnapshot().state, "FAILED"); assert.deepEqual(commits, []);
});
