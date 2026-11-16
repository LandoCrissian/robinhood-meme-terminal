import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { encodeSafeSetup } from "../../docs/evidence/rmt-task045/operations-safe-initializer.mjs";
import { assertCurrentMobileObservation, deriveFutureCreateDestinations, MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER,
  observeMobileSender } from "./mobile-sender.mjs";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "./rpc.mjs";

const evidence = new URL("../../docs/evidence/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, evidence), "utf8"));
const archived = load("mobile-signing/sender-observation-4663.json");
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const viem = require("viem");
const timestamp = Date.parse(archived.observedAt);
const byte32 = (number) => viem.numberToHex(number, { size: 32 });
const block = { number: "0x1234", hash: byte32(5), timestamp: viem.numberToHex(Math.floor(timestamp / 1000)) };

function reader({ chainId = "0x1237", header = block, code = "0x", balance = "0x2a", confirmed = "0x5",
  pending = () => "0x5", destinationCode = "0x", destinationNonce = "0x0", pendingCode = () => code,
  delegateHash = () => MOBILE_DELEGATE_POLICY.runtimeHash, fail } = {}) {
  let pendingChecks = 0;
  let pendingCodeChecks = 0;
  let delegateChecks = 0;
  return async (method, params, summarize) => {
    if (fail === method) return { status: "unavailable" };
    const isSender = params[0] === MOBILE_DEPLOYMENT_PAYER;
    if (method === "eth_getCode" && params[0] === MOBILE_DELEGATE_POLICY.address) {
      const hash = delegateHash(++delegateChecks, params[1]);
      return hash ? { status: "observed", value: hash } : { status: "unavailable" };
    }
    const responses = {
      eth_chainId: () => chainId,
      eth_getBlockByNumber: () => header,
      eth_getCode: () => isSender ? (params[1] === "pending" ? pendingCode(++pendingCodeChecks) : code) : destinationCode,
      eth_getBalance: () => balance,
      eth_getTransactionCount: () => isSender ? (params[1] === "pending" ? pending(++pendingChecks) : confirmed) : destinationNonce,
    };
    return { status: "observed", value: summarize(responses[method]()) };
  };
}

const observe = (official, pocket = official, options = {}) =>
  observeMobileSender({ readers: { official: reader(official), pocket: reader(pocket) }, now: () => timestamp, ...options });

test("read-only sender observation requires agreeing code, nonce and canonical L2 anchor", async () => {
  const codeEmpty = await observe({});
  assert.equal(codeEmpty.status, "OBSERVED");
  assert.equal(codeEmpty.accountType, "CODE_EMPTY");
  assert.equal(codeEmpty.balanceWei, "42");
  assert.equal(codeEmpty.nonceSynchronized, true);
  assert.deepEqual(codeEmpty.createDestinations.map(({ deploymentNonce }) => deploymentNonce), ["7", "8", "9", "10", "11"]);
  assert.ok(codeEmpty.createDestinations.every(({ status, code, accountNonce }) => status === "VACANT" && code === "0x" && accountNonce === "0"));
  assert.deepEqual(codeEmpty.createDestinations.map(({ address, deploymentNonce }) => ({ address, deploymentNonce })),
    deriveFutureCreateDestinations("5"));
  assert.equal((await observe({ balance: "0x0" })).balanceWei, "0");
  assert.equal((await observe({}, { chainId: "0x7a69" })).status, "CONFLICT");
  assert.equal((await observe({}, { header: { ...block, hash: byte32(6) } })).status, "CONFLICT");
  assert.equal((await observe({}, { fail: "eth_getBalance" })).status, "UNVERIFIED");
  assert.equal((await observe({}, {}, { now: () => timestamp + 180_000 })).status, "UNVERIFIED");
});

test("the explicit delegated path requires the exact designator and verified delegate at anchored and pending state", async () => {
  const code = MOBILE_DELEGATE_POLICY.designator;
  const delegated = { allowPinnedDelegation: true };
  const accepted = await observe({ code }, undefined, delegated);
  assert.equal(accepted.accountType, "EIP_7702_DELEGATION");
  assert.deepEqual(accepted.delegation, { ...MOBILE_DELEGATE_POLICY, status: "PINNED_RUNTIME" });
  assert.deepEqual(accepted.createDestinations.map(({ deploymentNonce }) => deploymentNonce), ["7", "8", "9", "10", "11"]);
  for (const options of [
    { code: "0x" }, // Code-empty is a distinct legacy policy and is not accepted as revocation fallback.
    { code: "0xef0100" + "12".repeat(20) },
    { code, delegateHash: (_, tag) => tag === "pending" ? MOBILE_DELEGATE_POLICY.runtimeHash : byte32(8) },
    { code, pendingCode: (count) => count === 3 ? "0x" : code },
    { code, delegateHash: (count) => count === 4 ? byte32(12) : MOBILE_DELEGATE_POLICY.runtimeHash },
    { code, delegateHash: (count) => count === 4 ? null : MOBILE_DELEGATE_POLICY.runtimeHash },
  ]) {
    const denied = await observe(options, undefined, delegated);
    assert.equal(denied.delegation, null);
    assert.deepEqual(denied.createDestinations, []);
  }
  const disagreement = await observe({ code }, { code, pendingCode: () => "0x" }, delegated);
  assert.equal(disagreement.delegation, null);
  assert.deepEqual(disagreement.createDestinations, []);
  const pendingNonce = await observe({ code, pending: () => "0x6" }, undefined, delegated);
  assert.equal(pendingNonce.nonceSynchronized, false);
  assert.deepEqual(pendingNonce.createDestinations, []);
});

test("changed pending nonce, occupied destinations and contract-like accounts never yield usable sender binding", async () => {
  const synchronized = await observe({ pending: () => "0x6" });
  assert.equal(synchronized.status, "OBSERVED");
  assert.equal(synchronized.nonceSynchronized, false);
  assert.deepEqual(synchronized.createDestinations, []);
  assert.equal((await observe({}, { pending: () => "0x6" })).status, "CONFLICT");
  assert.equal((await observe({ pending: (count) => count > 2 ? "0x6" : "0x5" })).status, "CONFLICT");
  assert.equal((await observe({ destinationNonce: "0x1" })).createDestinations[0].status, "OCCUPIED");
  assert.equal((await observe({ destinationCode: "0x34" }, {})).createDestinations[0].status, "CONFLICT");
  assert.equal((await observe({ code: "0x6000" })).accountType, "CONTRACT_CODE");

  const delegated = await observe({ code: archived.sender.providers[0].code });
  assert.equal(delegated.accountType, "EIP_7702_DELEGATION");
  assert.deepEqual(delegated.createDestinations, []);
  assert.throws(() => assertCurrentMobileObservation(archived, timestamp), /code-empty account/);
});

test("admitting a synthetic proof recomputes account, vacancy, Safe runtime and quote arithmetic", () => {
  // The historical public observation represents a delegated payer. Alter a copy only for validator tests.
  const fixture = structuredClone(archived);
  fixture.sender.accountType = "CODE_EMPTY";
  for (const provider of fixture.sender.providers) provider.code = "0x";
  fixture.sender.createDestinations = deriveFutureCreateDestinations(fixture.sender.pendingNonce).map((proposal) => ({
    ...proposal, status: "VACANT", code: "0x", accountNonce: "0",
    providers: fixture.sender.providers.map(({ name }) => ({ name, code: "0x", nonce: "0" })),
  }));
  assert.equal(assertCurrentMobileObservation(fixture, timestamp).status, "OBSERVED");
  assert.throws(() => assertCurrentMobileObservation(fixture, timestamp + 120_001), /Stale/);
  let altered = structuredClone(fixture);
  altered.sender.createDestinations[0].providers[1].nonce = "1";
  assert.throws(() => assertCurrentMobileObservation(altered, timestamp), /occupancy/);
  altered = structuredClone(fixture);
  altered.safes.runtimePins[0].witnesses[0].observedHash = byte32(12);
  assert.throws(() => assertCurrentMobileObservation(altered, timestamp), /codehash/);
  altered = structuredClone(fixture);
  altered.safes.proposals[0].gas.estimatedTotalWei = "0";
  assert.throws(() => assertCurrentMobileObservation(altered, timestamp), /arithmetic/);
});

test("delegated evidence separately fails on stale or altered sender, code, nonce, vacancy, and estimates", () => {
  const report = load("mobile-signing/sender-delegation-4663.json");
  const observed = Date.parse(report.observedAt);
  const check = (proof, now = observed) => assertCurrentMobileObservation(proof, now, { allowPinnedDelegation: true });
  const accepted = check(report);
  assert.equal(accepted.delegation.runtimeHash, MOBILE_DELEGATE_POLICY.runtimeHash);
  assert.deepEqual(accepted.createDestinations.map(({ deploymentNonce }) => deploymentNonce), ["478", "479", "480", "481", "482"]);
  assert.throws(() => check(report, observed + 120_001), /Stale/);
  assert.throws(() => assertCurrentMobileObservation(report, observed), /code-empty account/);
  for (const [mutate, reason] of [
    [(p) => { p.chainId = 31337; }, /Unrecognized/],
    [(p) => { p.proposedSender = viem.zeroAddress; }, /Expected values/],
    [(p) => { p.sender.providers[0].delegate.pending[1].designator = "0x"; }, /pinned delegation/],
    [(p) => { p.sender.providers[0].delegate.pending[1].runtimeHash = byte32(15); }, /pinned delegation/],
    [(p) => { p.sender.providers[0].delegate.anchoredRuntimeHash = byte32(15); }, /pinned delegation/],
    [(p) => { p.sender.providers[0].pendingAfter = "477"; }, /pinned delegation/],
    [(p) => { p.sender.createDestinations[0].providers[0].code = "0x60"; }, /occupancy/],
    [(p) => { p.safes.proposals[0].gas = null; }, /exact Safe estimate/],
  ]) {
    const mutated = structuredClone(report);
    mutate(mutated);
    assert.throws(() => check(mutated), reason);
  }
});

test("the personal payer estimate admits only the exact reviewed Safe transactions", async () => {
  const { operations: { factory, owners, setup, singleton } } = load("rmt-task045/operations-safe-policy.json");
  const { saltNonce } = load("rmt-task046/treasury-safe-initializers.json").proposals[0];
  const signature = "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce)";
  const args = [singleton, encodeSafeSetup(viem, owners, setup), BigInt(saltNonce)];
  const data = viem.encodeFunctionData({ abi: viem.parseAbi([signature]), functionName: "createProxyWithNonce", args });
  const transaction = { from: MOBILE_DEPLOYMENT_PAYER, to: factory, data, value: "0x0" };
  let calls = 0;
  const fetcher = async (_url, { body }) => {
    const { id, method } = JSON.parse(body);
    assert.equal(method, "eth_estimateGas");
    calls += 1;
    return Response.json({ jsonrpc: "2.0", id, result: "0x1234" });
  };
  const endpoint = { name: "official", url: ROBINHOOD_SOURCES.official };
  const mobile = makeReadOnlyRpc(endpoint, { mobileSafePayer: true, fetcher });
  const original = makeReadOnlyRpc(endpoint, { fetcher });
  assert.equal((await mobile("eth_estimateGas", [transaction, "0x1234"])).value, "0x1234");
  assert.equal((await original("eth_estimateGas", [{ ...transaction, from: owners[0] }])).value, "0x1234");
  await assert.rejects(original("eth_estimateGas", [transaction]), /reviewed Safe preparation/);
  await assert.rejects(mobile("eth_estimateGas", [{ ...transaction, from: owners[0] }]), /reviewed Safe preparation/);
  await assert.rejects(mobile("eth_estimateGas", [{ ...transaction, value: "0x1" }]), /reviewed Safe preparation/);
  await assert.rejects(mobile("eth_estimateGas", [{ ...transaction, nonce: "0x5" }]), /reviewed Safe preparation/);
  await assert.rejects(mobile("eth_estimateGas", [{ ...transaction, data: data.slice(0, -2) + "ff" }]), /initializer, singleton or salt/);
  await assert.rejects(mobile("eth_sendRawTransaction", ["0x01"]), /allowlist/);
  await assert.rejects(mobile("eth_signTransaction", [transaction]), /allowlist/);
  assert.equal(calls, 2);
});
