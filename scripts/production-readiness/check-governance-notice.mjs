import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES } from "./rpc.mjs";
import { observeCanonicalGovernanceSchedule } from "../../packages/contracts/scripts/prepare-governance-transaction.mjs";
import { publicationActionTypes, publicationDomainTypes, publicationDigest } from "../../packages/contracts/scripts/prepare-governance-publication.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, zeroAddress, zeroHash } = require("viem");
const evidence = (name) => JSON.parse(readFileSync(new URL("../../docs/evidence/" + name, import.meta.url)));
const scheduled = evidence("mobile-signing/factory-publication-scheduled.json");
const deployed = evidence("mobile-signing/protocol-mainnet.json");
const owners = evidence("rmt-task045/operations-safe-policy.json").operations.owners;
const names = ["official", "pocket"];
const methods = new Set(["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getCode", "eth_call"]);
const abi = parseAbi([
  "function signerA() view returns(address)", "function signerB() view returns(address)", "function signerC() view returns(address)",
  "function signerSetEpoch() view returns(uint64)", "function nonce() view returns(uint64)", "function latestVersion() view returns(uint32)",
  "function suspended() view returns(bool)", "function pending() view returns(bytes32,uint48,uint48)",
  "function pendingRotation() view returns(bytes32,uint48,uint48)", "function publicationDelay() view returns(uint48)",
  "function executionWindow() view returns(uint48)", "function factories(uint32) view returns(address,bytes32)",
  "function migrationTemplates(uint32) view returns(address,bytes32)",
  "function actionDigest((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)) view returns(bytes32)",
]);
const fields = ["signerA", "signerB", "signerC", "signerSetEpoch", "nonce", "latestVersion", "suspended", "pending", "pendingRotation", "publicationDelay", "executionWindow"];
const normalize = (value) => Array.isArray(value) ? value.map(normalize) : typeof value === "bigint" || typeof value === "number" ? String(value) : value;
const iso = (seconds) => new Date(Number(seconds) * 1000).toISOString();
const message = { ...scheduled.action, nonce: BigInt(scheduled.action.nonce), signerSetEpoch: BigInt(scheduled.action.signerSetEpoch), deadline: BigInt(scheduled.action.deadline) };
const publication = {
  scope: "UNSIGNED_DIRECTORY_PUBLICATION_AUTHORIZATION", chainId: 4663, action: "publish-factory", directory: scheduled.directory,
  broadcastAuthorized: false, requiredSignatures: 2, owners, digest: scheduled.digest,
  typedData: { domain: { name: "RMT Launch Curve Directory", version: "2", chainId: 4663, verifyingContract: scheduled.directory },
    types: { EIP712Domain: publicationDomainTypes, ...publicationActionTypes }, primaryType: "Action", message: scheduled.action },
};
const allowedViewData = new Set([
  ...fields.map((functionName) => encodeFunctionData({ abi, functionName })),
  encodeFunctionData({ abi, functionName: "factories", args: [1] }),
  encodeFunctionData({ abi, functionName: "migrationTemplates", args: [3] }),
  encodeFunctionData({ abi, functionName: "actionDigest", args: [message] }),
].map((data) => data.toLowerCase()));
class MissingEvidence extends Error {}
async function value(reader, method, params = []) {
  const result = await reader(method, params);
  if (result?.status !== "observed" || result.value === undefined || result.value === null) throw new MissingEvidence("Required notice observation unavailable: " + method);
  return result.value;
}

/** This probe is narrower than the shared read-only RPC: no gas simulation or trace. */
export function noticeReadOnly(reader) {
  return async (method, params = []) => {
    assert.ok(methods.has(method), "Method outside notice read-only scope");
    if (method === "eth_call") {
      const [call, at] = params;
      assert.ok(params.length === 2 && call?.to?.toLowerCase() === scheduled.directory.toLowerCase()
        && Object.keys(call).every((key) => key === "to" || key === "data")
        && allowedViewData.has(call.data?.toLowerCase()) && (at === "pending" || /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(at)),
      "Call outside fixed governance view getters");
    }
    return reader(method, params);
  };
}
function header(block) {
  assert.match(block?.hash ?? "", /^0x[0-9a-f]{64}$/i);
  assert.notEqual(block.hash, zeroHash);
  for (const key of ["number", "timestamp"]) assert.match(block[key] ?? "", /^0x(?:0|[1-9a-f][0-9a-f]*)$/i);
  return { number: BigInt(block.number).toString(), hash: block.hash.toLowerCase(), timestamp: BigInt(block.timestamp).toString() };
}

export function assertCurrentNotice(state, block, schedule, now = Date.now()) {
  assert.ok(Number(block.timestamp) * 1000 >= now - 180_000 && Number(block.timestamp) * 1000 <= now + 10_000, "Current notice observation is stale or future dated");
  assert.deepEqual([state.signerA, state.signerB, state.signerC].map((x) => x.toLowerCase()), owners.map((x) => x.toLowerCase()), "Governance signers changed");
  assert.equal(state.signerSetEpoch, scheduled.signerSetEpoch, "Governance epoch changed");
  assert.equal(state.nonce, scheduled.actionNonce, "Governance action nonce advanced");
  assert.equal(state.latestVersion, "0", "Factory publication already advanced");
  assert.equal(state.suspended, false, "Discovery is suspended");
  assert.deepEqual(state.pending, [scheduled.digest, schedule.executeAfter, schedule.executeBy], "Pending notice differs from the canonical schedule");
  assert.deepEqual(state.pendingRotation, [zeroHash, "0", "0"], "Signer rotation is pending");
  assert.equal(state.publicationDelay, "172800"); assert.equal(state.executionWindow, "604800");
  assert.deepEqual(state.factoryMapping, [zeroAddress, zeroHash], "Factory publication has already changed");
  assert.deepEqual(state.v3Mapping, [zeroAddress, zeroHash], "V3 template publication changed");
  assert.equal(state.actionDigest, scheduled.digest, "Current Directory digest differs");
  assert.equal(iso(schedule.scheduleBlockTime), scheduled.noticeStartsUtc);
  assert.equal(BigInt(schedule.executeAfter) - BigInt(schedule.scheduleBlockTime), 172800n);
  assert.equal(iso(schedule.executeAfter), scheduled.noticeCompletesUtc);
  assert.equal(iso(schedule.executeBy), scheduled.executeBeforeUtc);
  assert.equal(schedule.executeBy, scheduled.action.deadline);
  const at = BigInt(block.timestamp), eta = BigInt(schedule.executeAfter), expires = BigInt(schedule.executeBy);
  return { status: at > expires ? "SCHEDULE_EXPIRED_REQUIRES_AUTHORIZED_RECOVERY" : at < eta ? "SCHEDULE_VERIFIED_NOTICE_PENDING" : "SCHEDULE_VERIFIED_SEPARATE_OWNER_APPROVAL_REQUIRED",
    timeEligible: at >= eta && at <= expires, secondsUntilEligible: at < eta ? String(eta - at) : "0", signingAuthorized: false, broadcastAuthorized: false };
}

export async function checkGovernanceNotice({ readers = Object.fromEntries(names.map((name) => [name, makeReadOnlyRpc({ name, url: ROBINHOOD_SOURCES[name] })])), now = Date.now } = {}) {
  const base = { schemaVersion: 1, scope: "READ_ONLY_FACTORY_GOVERNANCE_NOTICE_ACCEPTANCE", chainId: 4663,
    transactionHash: scheduled.transactionHash, directory: scheduled.directory, factory: scheduled.action.factory,
    digest: scheduled.digest, signerSetEpoch: scheduled.signerSetEpoch, actionNonce: scheduled.actionNonce,
    sourcePlanSha256: deployed.planSha256, compilerInputSha256: deployed.compiler.inputSha256,
    signingAuthorized: false, broadcastAuthorized: false, productionActivationAuthorized: false, finality: "L1_UNVERIFIED" };
  try {
    assert.equal(deployed.chainId, 4663);
    assert.equal(deployed.constructors[0].address.toLowerCase(), scheduled.directory.toLowerCase());
    assert.deepEqual(deployed.constructors.map(({ id }) => id), ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"]);
    assert.equal(deployed.bootstrapChildren[2].address.toLowerCase(), scheduled.action.factory.toLowerCase());
    assert.equal(deployed.bootstrapChildren[2].runtimeHash, scheduled.action.runtimeHash);
    assert.equal(publicationDigest(publication.typedData), scheduled.digest);
    const watched = Object.fromEntries(names.map((name) => [name, noticeReadOnly(async (...args) => ({ status: "observed", value: await value(readers[name], ...args) }))]));
    // Reuse exact calldata/event and existing-signature verification. No signature is requested or simulated.
    const canonical = await observeCanonicalGovernanceSchedule(publication, scheduled.transactionHash, watched);
    assert.equal(BigInt(canonical.blockNumber).toString(), scheduled.receiptBlock); assert.equal(canonical.blockHash, scheduled.blockHash);
    const heads = await Promise.all(names.map((name) => value(watched[name], "eth_getBlockByNumber", ["latest", false])));
    const height = heads.map((head) => BigInt(head.number)).reduce((a, b) => a < b ? a : b), tag = toHex(height);
    const pins = [...deployed.constructors, ...deployed.bootstrapChildren]; assert.equal(pins.length, 8);
    const views = await Promise.all(names.map(async (name) => {
      const read = watched[name], block = header(await value(read, "eth_getBlockByNumber", [tag, false]));
      assert.equal(block.number, height.toString()); assert.equal(await value(read, "eth_chainId"), "0x1237");
      const call = async (functionName, args = [], at = tag) => normalize(decodeFunctionResult({ abi, functionName,
        data: await value(read, "eth_call", [{ to: scheduled.directory, data: encodeFunctionData({ abi, functionName, args }) }, at]) }));
      const state = {};
      for (const field of fields) { state[field] = await call(field); assert.deepEqual(await call(field, [], "pending"), state[field], "Pending governance state changed"); }
      state.factoryMapping = await call("factories", [1]); state.v3Mapping = await call("migrationTemplates", [3]); state.actionDigest = await call("actionDigest", [message]);
      for (const [field, args] of [["factories", [1]], ["migrationTemplates", [3]], ["actionDigest", [message]]]) {
        assert.deepEqual(await call(field, args, "pending"), field === "factories" ? state.factoryMapping : field === "migrationTemplates" ? state.v3Mapping : state.actionDigest);
      }
      const runtimePins = [];
      for (const pin of pins) {
        const code = await value(read, "eth_getCode", [pin.address, tag]);
        assert.equal(keccak256(code), pin.runtimeHash, "Deployed dependency runtime differs");
        assert.equal((code.length - 2) / 2, pin.runtimeBytes);
        assert.equal(await value(read, "eth_getCode", [pin.address, "pending"]), code);
        runtimePins.push({ id: pin.id ?? pin.contract, contract: pin.contract, address: pin.address, runtimeHash: pin.runtimeHash, bytes: pin.runtimeBytes });
      }
      for (const owner of owners) for (const at of [tag, "pending"]) assert.equal(await value(read, "eth_getCode", [owner, at]), "0x", "Governance owner is no longer an admitted EOA");
      return { provider: name, block, state, runtimePins };
    }));
    assert.deepEqual(views[0].block, views[1].block, "Providers disagree on current canonical block");
    assert.deepEqual(views[0].state, views[1].state, "Providers disagree on current governance state");
    const disposition = assertCurrentNotice(views[0].state, views[0].block, canonical, now());
    for (const name of names) for (const [at, expected] of [[tag, views[0].block.hash], [canonical.blockNumber, canonical.blockHash]]) {
      assert.equal((await value(watched[name], "eth_getBlockByNumber", [at, false])).hash, expected, "Governance observation reorganized during verification");
    }
    return { ...base, ...disposition, observedAt: new Date(now()).toISOString(), receipt: { blockNumber: scheduled.receiptBlock, blockHash: canonical.blockHash,
      timestamp: iso(canonical.scheduleBlockTime), existingAuthorization: "Two original on-chain signatures cryptographically verified by the reused canonical schedule verifier; no raw signatures or calldata exported" },
      notice: { startsAt: iso(canonical.scheduleBlockTime), eligibleAt: iso(canonical.executeAfter), expiresAt: iso(canonical.executeBy), seconds: 172800,
        eligibleDenver: scheduled.noticeCompletesDenver, expiresDenver: scheduled.executeBeforeDenver }, current: views,
      methodsUsed: [...methods], nextStage: "Separate owner-controlled execution after real notice and fresh transaction-specific checks; no token issuance or V3 admission prepared" };
  } catch (error) {
    return { ...base, status: error instanceof MissingEvidence ? "PENDING_EVIDENCE_UNAVAILABLE" : "EVIDENCE_INVALID",
      observedAt: new Date(now()).toISOString(), reason: error instanceof Error ? error.message : "Unverified governance evidence" };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { output: { type: "string" } } });
  assert.ok(values.output, "An explicit fresh JSON output path is required");
  const report = await checkGovernanceNotice();
  writeFileSync(resolve(values.output), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(report.status + "; read-only governance observation, no signing or broadcast");
  if (report.status === "EVIDENCE_INVALID" || report.status === "PENDING_EVIDENCE_UNAVAILABLE") process.exitCode = 1;
}
