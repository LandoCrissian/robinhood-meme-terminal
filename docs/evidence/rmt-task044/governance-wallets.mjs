import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { verifiedRelease } from "../rmt-task041-closeout/verify-release.mjs";

export const proposals = [
  { role: "RMT-GOV-01", submittedAddress: "0xc447a378cfd8460febc2eef67501d7a5473b9001" },
  { role: "RMT-GOV-02", submittedAddress: "0xc3600f2df60929d2ab9ab294cff42eedcb984f51" },
  { role: "RMT-GOV-03", submittedAddress: "0x2bcc3fafce77ccc7fdbed46e0b5bb80ba3e76697" },
];
const endpoints = {
  official: "https://rpc.mainnet.chain.robinhood.com",
  pinax: "https://robinhood.rpc.pinax.network",
};
const names = Object.keys(endpoints);
const readMethods = ["eth_chainId", "eth_getBlockByNumber", "eth_getCode"];
const chainId = 4663;
const reservedAccountMaximum = 0xffffn;
const hash = /^0x[0-9a-f]{64}$/i;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;
const bytecode = /^0x(?:[0-9a-f]{2})*$/i;
const delegation = /^0xef0100([0-9a-f]{40})$/i;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function normalizeGovernanceWallets(wallets, getAddress) {
  assert.equal(wallets.length, 3, "Directory requires exactly three signer identities");
  const normalized = wallets.map(({ role, submittedAddress }) => {
    assert.match(submittedAddress, /^0x[0-9a-fA-F]{40}$/, role + " requires owner confirmation of the exact address");
    const address = getAddress(submittedAddress);
    assert.equal(address.toLowerCase(), submittedAddress.toLowerCase(), role + " address bytes changed");
    const unchecksummed = submittedAddress === submittedAddress.toLowerCase()
      || submittedAddress.slice(2) === submittedAddress.slice(2).toUpperCase();
    assert.ok(unchecksummed || address === submittedAddress, role + " requires owner confirmation of the EIP-55 checksum");
    return { role, submittedAddress, address, submittedEncoding: unchecksummed ? "unchecksummed" : "EIP-55",
      aboveReservedRange: BigInt(address) > reservedAccountMaximum };
  });
  assert.equal(new Set(normalized.map(({ address }) => address.toLowerCase())).size, 3, "Duplicate governance address");
  assert.equal(new Set(normalized.map(({ role }) => role)).size, 3, "Duplicate governance role");
  return normalized;
}

function readProvider(name) {
  let id = 0;
  return async (method, params) => {
    assert.ok(readMethods.includes(method), "RPC method outside read-only allowlist");
    const request = { jsonrpc: "2.0", id: ++id, method, params };
    let response;
    for (const pause of [500, 2_000, 4_000]) {
      await delay(pause);
      response = await fetch(endpoints[name], {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
        headers: { "content-type": "application/json" }, body: JSON.stringify(request),
      });
      if (response.status !== 429) break;
      await response.body?.cancel();
    }
    assert.ok(response.ok, name + " returned HTTP " + response.status);
    assert.ok(response.body, name + " response body unavailable");
    const reader = response.body.getReader();
    const parts = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128 * 1024) {
        await reader.cancel();
        throw new Error(name + " response exceeded size limit");
      }
      parts.push(value);
    }
    const envelope = JSON.parse(Buffer.concat(parts).toString("utf8"));
    assert.ok(envelope?.jsonrpc === "2.0" && envelope.id === request.id, name + " response envelope mismatch");
    assert.ok(!envelope.error && "result" in envelope, name + " did not return " + method);
    return envelope.result;
  };
}

function identifyBlock(block) {
  assert.ok(block && quantity.test(block.number) && hash.test(block.hash) && hash.test(block.stateRoot)
    && quantity.test(block.timestamp), "Missing or malformed block");
  const timestamp = BigInt(block.timestamp);
  assert.ok(timestamp > 0n && timestamp <= 8_640_000_000_000n, "Invalid block timestamp");
  return { number: BigInt(block.number).toString(), hash: block.hash.toLowerCase(), stateRoot: block.stateRoot.toLowerCase(),
    timestamp: new Date(Number(timestamp) * 1_000).toISOString() };
}

export async function observeGovernanceWallets({ read, wallets, blockNumber, expectedHash }) {
  const agreedChains = await Promise.all(names.map((name) => read[name]("eth_chainId", [])));
  assert.ok(agreedChains.every((value) => quantity.test(value) && BigInt(value) === BigInt(chainId)), "Unexpected provider chain");
  const height = blockNumber ?? (await Promise.all(names.map(async (name) =>
    BigInt(identifyBlock(await read[name]("eth_getBlockByNumber", ["latest", false])).number))))
    .reduce((a, b) => a < b ? a : b);
  const tag = "0x" + height.toString(16);
  const anchors = await Promise.all(names.map(async (name) => identifyBlock(await read[name]("eth_getBlockByNumber", [tag, false]))));
  assert.deepEqual(anchors[0], anchors[1], "Providers disagree on the observation anchor");
  const [anchor] = anchors;
  assert.equal(anchor.number, height.toString(), "Observation block number mismatch");
  if (expectedHash) assert.equal(anchor.hash, expectedHash.toLowerCase(), "Unexpected pinned block hash");

  const byProvider = await Promise.all(names.map(async (name, i) => {
    const codes = [];
    for (const { address } of wallets) {
      const code = await read[name]("eth_getCode", [address, tag]);
      assert.ok(typeof code === "string" && bytecode.test(code), name + " returned malformed code");
      codes.push(code.toLowerCase());
    }
    assert.deepEqual(identifyBlock(await read[name]("eth_getBlockByNumber", [tag, false])), anchors[i], name + " observation changed");
    return codes;
  }));
  assert.deepEqual(byProvider[0], byProvider[1], "Providers disagree on account code");
  const observed = wallets.map((wallet, i) => {
    const codes = Object.fromEntries(names.map((name, provider) => [name, byProvider[provider][i]]));
    const code = codes.official;
    const codeState = code === "0x" ? "EMPTY" : delegation.test(code) ? "EIP_7702_DELEGATION" : "CONTRACT_CODE";
    return { ...wallet, codes, codeState, policyEligible: wallet.aboveReservedRange && codeState === "EMPTY", keyControl: "UNVERIFIED" };
  });
  return { status: observed.every(({ policyEligible }) => policyEligible) ? "ELIGIBLE_AT_PINNED_BLOCK" : "INELIGIBLE_AT_PINNED_BLOCK",
    anchor, wallets: observed };
}

async function main() {
  const { values } = parseArgs({ options: {
    checkout: { type: "string" }, block: { type: "string" }, "block-hash": { type: "string" },
  } });
  assert.ok(values.checkout, "Provide --checkout to use the pinned viem dependency");
  assert.ok((values.block === undefined && values["block-hash"] === undefined)
    || (/^[1-9]\d*$/.test(values.block) && hash.test(values["block-hash"])), "Specify both --block and --block-hash for a pinned replay");
  const release = verifiedRelease();
  const sourcePath = "src/RMTLaunchCurveDirectoryV2.sol";
  const profile = JSON.parse(readFileSync(new URL("../rmt-task043/4663-rotation-profile.json", import.meta.url), "utf8"));
  const source = readFileSync(new URL("../../../packages/contracts/" + sourcePath, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const sourceSha256 = sha256(source);
  assert.equal(sourceSha256, Object.fromEntries(profile.sourceSha256)[sourcePath], "Directory source mismatch");
  const { getAddress } = webTools(resolve(values.checkout));
  const wallets = normalizeGovernanceWallets(proposals, getAddress);
  let evidence;
  try {
    evidence = await observeGovernanceWallets({
      read: Object.fromEntries(names.map((name) => [name, readProvider(name)])),
      wallets, blockNumber: values.block ? BigInt(values.block) : undefined, expectedHash: values["block-hash"],
    });
  } catch (error) {
    evidence = { status: "UNVERIFIED", reason: error.message,
      wallets: wallets.map((wallet) => ({ ...wallet, codeState: "UNVERIFIED", policyEligible: null, keyControl: "UNVERIFIED" })) };
  }
  console.log(JSON.stringify({
    schemaVersion: 1, candidateCommit: release.candidateCommit,
    releaseManifestSha256Lf: release.releaseManifestSha256Lf, releaseStatus: release.state, broadcastAuthorized: false,
    chainId, observedAt: new Date().toISOString(), endpoints, readMethods,
    directory: { sourcePath, sourceSha256, threshold: 2, signerCount: 3, eligibility: "Code-empty account with address above 0xffff" },
    ...evidence,
  }, null, 2));
  if (evidence.status !== "ELIGIBLE_AT_PINNED_BLOCK") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
