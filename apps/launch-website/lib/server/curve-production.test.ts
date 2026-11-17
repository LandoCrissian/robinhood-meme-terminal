import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { encodeFunctionData, type Hex } from "viem";
import { configuredCurveProductionRelease, curveProductionDeployment, curveProductionPins, curveProductionProfile,
  normalizeProductionCreationFields, parseCurveProductionRelease, validateCurveProductionObservation,
  type CurveProductionRelease, type ProductionObservation } from "./curve-production";
import { handleProductionCreation } from "./production-creation";
import { assertProductionWallet, isProductionCreationRequest, productionCalldataMatches, productionCreationAbi,
  productionCreationChain, productionCreationFactory, productionCreationJournalKey, readProductionCreationJournal,
  submitProductionCreation, type ProductionCreationRequest, type ProductionWallet } from "../production-creation";
import { isTestCreationRequest } from "../test-creation";
import { config as discoveryLimit } from "../../netlify/edge-functions/launch-discovery-limit";
import { config as creationLimit } from "../../netlify/edge-functions/launch-creation-limit";

const hash = (character: string) => `0x${character.repeat(64)}` as Hex;
const reference = "1".repeat(64);
const owner = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const release: CurveProductionRelease = { profile: curveProductionProfile, chainId: 4663, origin: "https://www.rmtlaunch.fun",
  compilerInputSha256: curveProductionDeployment.compilerInputSha256, factoryRuntimeHash: curveProductionPins.factory[1],
  ownerCreationApprovalSha256: reference, fullSourceVerificationSha256: reference, operationalAcceptanceSha256: reference,
  l1FinalityPolicyAcceptanceSha256: reference, indexingRecoveryAcceptanceSha256: reference,
  publication: { transactionHash: hash("a"), blockNumber: "116835200", blockHash: hash("b") } };
const raw = JSON.stringify(release);
const digest = createHash("sha256").update(raw).digest("hex");
const env = { RMT_CURVE_PRODUCTION_PREPARATION: curveProductionProfile, RMT_CURVE_PRODUCTION_RELEASE: raw,
  RMT_CURVE_PRODUCTION_RELEASE_SHA256: digest };
const headers = () => new Headers({ host: "www.rmtlaunch.fun", "x-forwarded-proto": "https", origin: "https://www.rmtlaunch.fun" });

test("a distinct 4663 preparation profile fails closed without exact release acceptance and origin", () => {
  assert.deepEqual(parseCurveProductionRelease(raw, digest), release);
  assert.equal(parseCurveProductionRelease(raw + " ", digest), null);
  assert.equal(parseCurveProductionRelease(undefined, digest), null);
  for (const key of ["ownerCreationApprovalSha256", "fullSourceVerificationSha256", "operationalAcceptanceSha256",
    "l1FinalityPolicyAcceptanceSha256", "indexingRecoveryAcceptanceSha256", "compilerInputSha256"]) {
    const modified = JSON.stringify({ ...release, [key]: "0".repeat(64) });
    assert.equal(parseCurveProductionRelease(modified, createHash("sha256").update(modified).digest("hex")), null);
  }
  assert.equal(configuredCurveProductionRelease(headers(), env)?.chainId, 4663);
  for (const changed of [{ host: "preview.netlify.app" }, { "x-forwarded-host": "attacker.invalid" },
    { "x-forwarded-proto": "http" }, { origin: "https://attacker.invalid" }, { forwarded: "host=www.rmtlaunch.fun" }]) {
    const h = headers(); Object.entries(changed).forEach(([key, value]) => h.set(key, value));
    assert.equal(configuredCurveProductionRelease(h, env), null);
  }
  assert.equal(configuredCurveProductionRelease(headers(), { ...env, RMT_CURVE_FIXTURE: "rmt-curve-fixed-supply-security-v2" }), null);
});

const now = 1_794_935_000n;
const observation = (): ProductionObservation => ({ chainId: 4663, blockNumber: 116835230n, blockHash: hash("c"), timestamp: now,
  deploymentBlockHash: curveProductionDeployment.blockHash, deploymentCanonical: true, publicationBlockHash: release.publication.blockHash, publicationCanonical: true,
  runtimes: Object.values(curveProductionPins).map(([, runtime]) => runtime),
  bindings: [curveProductionPins.directory[0], curveProductionPins.registry[0], curveProductionPins.engine[0], curveProductionPins.successor[0],
    curveProductionPins.successor[1], curveProductionDeployment.operating, curveProductionDeployment.reserve, curveProductionPins.factory[0],
    curveProductionPins.guard[0], curveProductionPins.poolManager[0], curveProductionPins.positionManager[0], curveProductionPins.permit2[0],
    curveProductionPins.engine[0], curveProductionPins.poolManager[0], curveProductionPins.poolManager[0], curveProductionPins.permit2[0]],
  suspended: false, latestVersion: 1, publishedFactory: curveProductionPins.factory[0], publishedRuntimeHash: curveProductionPins.factory[1],
  engineVersion: 1, feeWei: curveProductionDeployment.creationFeeWei, supplyWei: 10n ** 27n, engineChain: 4663n, poolFee: 3000, tickSpacing: 60 });

test("readiness rejects unpublished, suspended, stale, reorged, foreign or changed immutable/runtime observations", () => {
  validateCurveProductionObservation(release, observation(), now);
  for (const change of [{ chainId: 31337 }, { blockNumber: 116835210n }, { timestamp: now - 91n }, { timestamp: now + 16n },
    { publicationCanonical: false }, { deploymentCanonical: false }, { deploymentBlockHash: hash("0") }, { publicationBlockHash: hash("0") },
    { latestVersion: 0 }, { suspended: true }, { publishedRuntimeHash: hash("0") }, { feeWei: 1n }, { supplyWei: 1n },
    { engineVersion: 2 }, { engineChain: 31337n }, { poolFee: 10000 }, { tickSpacing: 1 }, { bindings: [] }, { runtimes: [] }]) {
    assert.throws(() => validateCurveProductionObservation(release, { ...observation(), ...change }, now));
  }
  for (let i = 0; i < observation().runtimes.length; i++) {
    const o = observation(); o.runtimes[i] = hash("0"); assert.throws(() => validateCurveProductionObservation(release, o, now));
  }
  for (let i = 0; i < observation().bindings.length; i++) {
    const o = observation(); o.bindings[i] = hash("0"); assert.throws(() => validateCurveProductionObservation(release, o, now));
  }
});

const fields = { name: "Owner Test", symbol: "OWNER", projectURI: "https://example.invalid/project", treasury: "", treasuryShareBps: 0 };
const request = (): ProductionCreationRequest => ({ from: owner, to: productionCreationFactory, chainId: productionCreationChain,
  intentId: hash("d"), deadline: "1794935300", value: "0x16bcc41e90000", nonce: "0x1e3", blockNumber: "0x6f6d4c0", blockHash: hash("e"),
  data: encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: [fields.name, fields.symbol, fields.projectURI,
    "0x0000000000000000000000000000000000000000", 0, hash("d"), 1794935300n] }) });

test("production calls preserve fixed-supply ABI, project-share denominator, fields and exact fee without weakening 31337 requests", () => {
  assert.ok(normalizeProductionCreationFields(fields));
  assert.ok(normalizeProductionCreationFields({ ...fields, treasury: "0x2222222222222222222222222222222222222222", treasuryShareBps: 9000 }));
  assert.equal(normalizeProductionCreationFields({ ...fields, treasuryShareBps: 10000 }), null);
  assert.equal(normalizeProductionCreationFields({ ...fields, supply: "2000000000" }), null);
  assert.ok(isProductionCreationRequest(request()));
  assert.ok(productionCalldataMatches(request(), fields));
  assert.equal(productionCalldataMatches(request(), { ...fields, name: "Different" }), false);
  assert.equal(isTestCreationRequest(request()), false);
  for (const change of [{ chainId: "0x7a69" }, { value: "0x1" }, { to: curveProductionPins.registry[0] },
    { data: request().data + "00" }, { nonce: "0x01" }, { intentId: hash("a") }]) assert.equal(isProductionCreationRequest({ ...request(), ...change }), false);
});

function harness(result: unknown | Error = hash("f")) {
  const entries = new Map<string, string>();
  const calls: string[] = [];
  const state = { account: owner, chain: productionCreationChain, nonce: "0x1e3", blockHash: hash("e") };
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const provider = { async request(input: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    calls.push(input.method);
    if (input.method === "eth_accounts") return [state.account];
    if (input.method === "eth_chainId") return state.chain;
    if (input.method === "eth_getTransactionCount") return state.nonce;
    if (input.method === "eth_getBlockByNumber") return { hash: state.blockHash };
    if (input.method === "eth_sendTransaction") {
      assert.ok(readProductionCreationJournal(storage), "Intent is durable before the sole send");
      assert.deepEqual(input.params, [{ from: owner, to: productionCreationFactory, data: request().data,
        value: request().value, chainId: productionCreationChain, nonce: "0x1e3" }]);
      if (result instanceof Error) throw result;
      return result;
    }
    throw new Error("Unexpected wallet method");
  } };
  const wallet: ProductionWallet = { account: owner, provider, request: provider.request };
  return { calls, state, storage, wallet, entries };
}

test("explicit wallet submission persists identity/hash and refuses duplicate submission after refresh", async () => {
  const h = harness(); const submitted = await submitProductionCreation(h.wallet, request(), h.storage, () => undefined);
  assert.equal(submitted.transactionHash, hash("f"));
  assert.deepEqual(readProductionCreationJournal(h.storage), submitted);
  await assert.rejects(submitProductionCreation(h.wallet, request(), h.storage, () => undefined));
  assert.equal(h.calls.filter((call) => call === "eth_sendTransaction").length, 1);
});

test("missing hash and interrupted provider retain the original intent; rejection alone permits a new review", async () => {
  for (const outcome of [undefined, new Error("transport interrupted")]) {
    const h = harness(outcome ?? null);
    if (outcome instanceof Error) await assert.rejects(submitProductionCreation(h.wallet, request(), h.storage, () => undefined));
    else await submitProductionCreation(h.wallet, request(), h.storage, () => undefined);
    assert.equal(readProductionCreationJournal(h.storage)?.transactionHash, undefined);
    await assert.rejects(submitProductionCreation(h.wallet, request(), h.storage, () => undefined));
    assert.equal(h.calls.filter((call) => call === "eth_sendTransaction").length, 1);
  }
  const h = harness(Object.assign(new Error("Rejected"), { code: 4001 }));
  await assert.rejects(submitProductionCreation(h.wallet, request(), h.storage, () => undefined));
  assert.equal(h.storage.getItem(productionCreationJournalKey), null);
});

test("changed account, chain, nonce, reviewed block or provider cannot send", async () => {
  for (const changes of [{ account: "0x2222222222222222222222222222222222222222" }, { chain: "0x7a69" },
    { nonce: "0x1e4" }, { blockHash: hash("a") }]) {
    const h = harness(); Object.assign(h.state, changes);
    await assert.rejects(submitProductionCreation(h.wallet, request(), h.storage, () => undefined));
    assert.equal(h.calls.includes("eth_sendTransaction"), false);
    assert.equal(h.storage.getItem(productionCreationJournalKey), null);
  }
  const h = harness(); h.wallet.provider.request = async () => null;
  await assert.rejects(assertProductionWallet(h.wallet, request()));
});

test("editing the draft during final asynchronous wallet reads invalidates the review before persistence or send", async () => {
  const h = harness();
  await assert.rejects(submitProductionCreation(h.wallet, request(), h.storage, () => { throw new Error("Reviewed draft changed"); }));
  assert.equal(h.calls.includes("eth_sendTransaction"), false);
  assert.equal(h.storage.getItem(productionCreationJournalKey), null);
});

test("the public POST route remains server-blocked with missing release inputs", async () => {
  const before = process.env.RMT_CURVE_PRODUCTION_PREPARATION;
  try {
    delete process.env.RMT_CURVE_PRODUCTION_PREPARATION;
    const response = await handleProductionCreation(new Request("https://www.rmtlaunch.fun/api/launchpad/production-creation", {
      method: "POST", headers: headers(), body: JSON.stringify({ action: "prepare", fields, account: owner, intentId: hash("d") }),
    }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { status: "unavailable" });
  } finally {
    if (before === undefined) delete process.env.RMT_CURVE_PRODUCTION_PREPARATION; else process.env.RMT_CURVE_PRODUCTION_PREPARATION = before;
  }
});

test("the accepted first-owner preparation route rejects a different account before any provider read", async () => {
  const overrides = { ...env, RMT_CURVE_PRODUCTION_EXECUTION: "owner-creation-approved", RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    const h = headers(); h.set("content-type", "application/json");
    const response = await handleProductionCreation(new Request("https://www.rmtlaunch.fun/api/launchpad/production-creation", {
      method: "POST", headers: h, body: JSON.stringify({ action: "prepare", fields, account: "0x2222222222222222222222222222222222222222", intentId: hash("d") }),
    }));
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { status: "invalid" });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("Netlify distributed limit configurations cover new-engine reads and the separately bounded preparation endpoint", () => {
  assert.match("/api/launchpad/new-engine", new RegExp(discoveryLimit.pattern));
  assert.match("/api/launchpad/new-engine/" + "0x" + "2".repeat(40), new RegExp(discoveryLimit.pattern));
  assert.equal(creationLimit.path, "/api/launchpad/production-creation");
  assert.deepEqual(creationLimit.rateLimit, { windowSize: 60, windowLimit: 12, aggregateBy: ["ip", "domain"] });
});
