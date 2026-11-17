import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { ROBINHOOD_SOURCES } from "../../../scripts/production-readiness/rpc.mjs";
import { privateOutputPath } from "./prepare-unsigned-4663.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeFunctionData, decodeFunctionResult, getContractAddress, isAddressEqual,
  keccak256, parseAbi, toHex, formatEther, zeroAddress } = require("viem");
const load = (name) => JSON.parse(readFileSync(new URL("../../../docs/evidence/" + name, import.meta.url)));
const profile = load("fixed-supply-security/4663-profile.json");
const owners = load("rmt-task045/operations-safe-policy.json").operations.owners;
const bytes = /^0x(?:[0-9a-f]{2})*$/i;
const hash = /^0x[0-9a-f]{64}$/i;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;
const nitroAddress = "0x00000000000000000000000000000000000000c8";
const nitroAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
const methods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_getCode", "eth_getBalance",
  "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas"]);

/** Pin the first constructor, including its entire creation bytecode and all three approved signer arguments. */
export function directoryReviewCandidate(packet) {
  const plan = packet?.plan;
  assert.equal(plan?.chainId, 4663);
  assert.equal(plan.scope, "UNSIGNED_4663_PROTOCOL_CONTINUATION_AFTER_BOTH_SAFE_RECEIPTS");
  assert.equal(plan.broadcastAuthorized, false);
  assert.equal(plan.signingAuthorized, false);
  assert.equal(plan.compiler.inputSha256, profile.inputSha256);
  assert.ok(isAddressEqual(plan.sender, MOBILE_DEPLOYMENT_PAYER));
  assert.equal(plan.tokenCreation, null);
  const candidate = plan.constructors?.[0];
  assert.equal(candidate?.id, "directory");
  assert.equal(candidate.contract, "RMTLaunchCurveDirectoryV2");
  assert.match(candidate.nonce, /^(0|[1-9][0-9]{0,19})$/);
  assert.ok(BigInt(candidate.nonce) < (1n << 64n) - 1n);
  assert.ok(isAddressEqual(candidate.address, getContractAddress({ from: MOBILE_DEPLOYMENT_PAYER, nonce: BigInt(candidate.nonce) })));
  assert.ok(bytes.test(candidate.initcode) && hash.test(candidate.initcodeHash) && hash.test(candidate.runtimeHash));
  const template = profile.templates.RMTLaunchCurveDirectoryV2;
  const creation = candidate.initcode.slice(2, 2 + template.creationBytes * 2);
  assert.equal(createHash("sha256").update(Buffer.from(creation, "hex")).digest("hex"), template.creationSha256,
    "Directory creation bytecode differs from the frozen compiler output");
  const args = encodeAbiParameters(owners.map(() => ({ type: "address" })), owners);
  assert.equal("0x" + candidate.initcode.slice(2 + creation.length), args,
    "Directory constructor signer arguments differ from the approved configuration");
  assert.equal(keccak256(candidate.initcode), candidate.initcodeHash);
  const request = { type: "0x2", chainId: "0x1237", from: MOBILE_DEPLOYMENT_PAYER,
    nonce: toHex(BigInt(candidate.nonce)), value: "0x0", data: candidate.initcode };
  assert.deepEqual(candidate.unsigned, request, "Only the exact zero-value top-level CREATE envelope is supported");
  return { ...candidate, request };
}

function makeReader(name, fetcher) {
  assert.ok(name === "official" || name === "pocket");
  let nextId = 0;
  return async (method, params = []) => {
    assert.ok(methods.has(method), "Method is outside the constructor read-only boundary");
    const id = ++nextId;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    assert.ok(body.length <= 128_000, "Constructor RPC request is too large");
    const response = await fetcher(ROBINHOOD_SOURCES[name], { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json" }, body });
    assert.equal(response.status, 200, "Constructor RPC HTTP read failed");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert.ok(size <= 256_000, "Constructor RPC response is too large");
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.ok(result.jsonrpc === "2.0" && result.id === id && !result.error && Object.hasOwn(result, "result"),
      "Constructor RPC read returned unavailable or malformed evidence");
    assert.notEqual(result.result, null);
    return result.result;
  };
}

/** Read-only, transaction-specific verification. No signature or send method is admitted. */
export async function probeDirectoryConstructor(packet, { readers, fetcher = fetch, now = Date.now } = {}) {
  const candidate = directoryReviewCandidate(packet);
  const names = ["official", "pocket"];
  readers ??= Object.fromEntries(names.map((name) => [name, makeReader(name, fetcher)]));
  const heads = await Promise.all(names.map((name) => readers[name]("eth_getBlockByNumber", ["latest", false])));
  assert.ok(heads.every((block) => quantity.test(block?.number) && hash.test(block?.hash) && quantity.test(block?.timestamp)));
  const height = heads.map((block) => BigInt(block.number)).reduce((a, b) => a < b ? a : b);
  const tag = toHex(height);
  const witnesses = await Promise.all(names.map(async (provider) => {
    const read = readers[provider];
    const [chain, block, confirmedNonce, pendingNonce, code, pendingCode, accountNonce, pendingAccountNonce,
      senderCode, pendingSenderCode, delegateCode, pendingDelegateCode, balance, runtimeCode, gasEstimate, gasPrice, tip] = await Promise.all([
      read("eth_chainId"), read("eth_getBlockByNumber", [tag, false]),
      read("eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, tag]), read("eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, "pending"]),
      read("eth_getCode", [candidate.address, tag]), read("eth_getCode", [candidate.address, "pending"]),
      read("eth_getTransactionCount", [candidate.address, tag]), read("eth_getTransactionCount", [candidate.address, "pending"]),
      read("eth_getCode", [MOBILE_DEPLOYMENT_PAYER, tag]), read("eth_getCode", [MOBILE_DEPLOYMENT_PAYER, "pending"]),
      read("eth_getCode", [MOBILE_DELEGATE_POLICY.address, tag]), read("eth_getCode", [MOBILE_DELEGATE_POLICY.address, "pending"]),
      read("eth_getBalance", [MOBILE_DEPLOYMENT_PAYER, tag]), read("eth_call", [candidate.request, tag]),
      read("eth_estimateGas", [candidate.request, tag]), read("eth_gasPrice"), read("eth_maxPriorityFeePerGas"),
    ]);
    assert.equal(chain, "0x1237");
    assert.ok(block?.number === tag && hash.test(block.hash) && quantity.test(block.timestamp) && quantity.test(block.gasLimit));
    assert.ok(Math.abs(now() - Number(BigInt(block.timestamp)) * 1_000) <= 180_000, "Constructor block observation is stale");
    assert.equal(confirmedNonce, candidate.request.nonce); assert.equal(pendingNonce, confirmedNonce);
    assert.equal(code, "0x"); assert.equal(pendingCode, "0x"); assert.equal(accountNonce, "0x0"); assert.equal(pendingAccountNonce, "0x0");
    assert.equal(senderCode.toLowerCase(), MOBILE_DELEGATE_POLICY.designator); assert.equal(pendingSenderCode, senderCode);
    assert.equal(keccak256(delegateCode), MOBILE_DELEGATE_POLICY.runtimeHash); assert.equal(pendingDelegateCode, delegateCode);
    assert.ok(bytes.test(runtimeCode) && runtimeCode.length > 2);
    assert.equal(keccak256(runtimeCode), candidate.runtimeHash, "CREATE simulation runtime differs from materialized compiler output");
    assert.ok([balance, gasEstimate, gasPrice, tip].every((value) => quantity.test(value)));
    assert.ok(BigInt(gasEstimate) > 0n && BigInt(gasPrice) > 0n);
    return { provider, block, confirmedNonce, pendingNonce, vacancy: "VACANT", delegation: "PINNED_RUNTIME",
      runtimeCode, simulationRuntimeHash: candidate.runtimeHash, balanceWei: BigInt(balance).toString(),
      gasEstimate: BigInt(gasEstimate).toString(), gasPriceWei: BigInt(gasPrice).toString(), priorityFeeWei: BigInt(tip).toString() };
  }));
  assert.equal(witnesses[0].block.hash, witnesses[1].block.hash, "Constructor providers disagree on canonical block");
  assert.equal(witnesses[0].runtimeCode, witnesses[1].runtimeCode);
  const nitroData = encodeFunctionData({ abi: nitroAbi, functionName: "gasEstimateComponents", args: [zeroAddress, true, candidate.initcode] });
  const raw = await readers.official("eth_call", [{ from: MOBILE_DEPLOYMENT_PAYER, to: nitroAddress, value: "0x0", data: nitroData }, tag]);
  const [total, l1, baseFee, l1BaseFee] = decodeFunctionResult({ abi: nitroAbi, functionName: "gasEstimateComponents", data: raw });
  assert.ok(total > 0n && l1 >= 0n && l1 <= total && baseFee > 0n && l1BaseFee >= 0n);
  const estimate = witnesses.reduce((best, row) => BigInt(row.gasEstimate) > best ? BigInt(row.gasEstimate) : best, total);
  const gas = (estimate * 5n + 3n) / 4n;
  const tip = witnesses.reduce((best, row) => BigInt(row.priorityFeeWei) > best ? BigInt(row.priorityFeeWei) : best, 0n);
  const maxFee = witnesses.reduce((best, row) => BigInt(row.gasPriceWei) > best ? BigInt(row.gasPriceWei) : best, baseFee * 2n + tip);
  assert.ok(tip <= maxFee && witnesses.every((row) => gas <= BigInt(row.block.gasLimit) && gas * maxFee <= BigInt(row.balanceWei)),
    "Estimated fee bounds exceed network limits or current balance");
  for (const name of names) {
    const [block, pending] = await Promise.all([readers[name]("eth_getBlockByNumber", [tag, false]),
      readers[name]("eth_getTransactionCount", [MOBILE_DEPLOYMENT_PAYER, "pending"])]);
    assert.equal(block?.hash, witnesses[0].block.hash, "Constructor anchor changed during the probe");
    assert.equal(pending, candidate.request.nonce, "Constructor nonce changed during the probe");
  }
  return { review: { schemaVersion: 1, scope: "EXACT_DIRECTORY_CREATE_READ_ONLY_SIMULATION", chainId: 4663,
    observedAt: new Date(now()).toISOString(), status: "CORROBORATED_RUNTIME_SIMULATION", broadcastAuthorized: false,
    contract: candidate.contract, expectedAddress: candidate.address, nonce: candidate.nonce,
    initcodeHash: candidate.initcodeHash, runtimeHash: candidate.runtimeHash,
    anchor: { number: height.toString(), hash: witnesses[0].block.hash,
      blockTimeUtc: new Date(Number(BigInt(witnesses[0].block.timestamp)) * 1_000).toISOString() },
    witnesses: witnesses.map(({ runtimeCode, balanceWei, ...row }) => row),
    nitro: { gasEstimate: total.toString(), l1PosterGas: l1.toString(), baseFeeWei: baseFee.toString(), l1BaseFeeEstimateWei: l1BaseFee.toString() },
    cost: { estimatedWei: (total * baseFee).toString(), estimatedEth: formatEther(total * baseFee),
      proposedGasLimit: gas.toString(), proposedMaxFeePerGasWei: maxFee.toString(), proposedPriorityFeeWei: tip.toString(),
      proposedMaximumWei: (gas * maxFee).toString(), proposedMaximumEth: formatEther(gas * maxFee),
      authority: "INDICATIVE_ONLY; OWNER_MUST_REVIEW_FRESH_WALLET_COSTS" }, finality: "L1_UNVERIFIED" },
    runtime: { chainId: 4663, contract: candidate.contract, address: candidate.address,
      runtimeHash: candidate.runtimeHash, runtimeCode: witnesses[0].runtimeCode,
      provenance: "Both exact CREATE simulations match the independently compiled materialized runtime hash" } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { packet: { type: "string" }, output: { type: "string" }, "runtime-output": { type: "string" } } });
  const output = privateOutputPath(values.output), runtimeOutput = privateOutputPath(values["runtime-output"]);
  assert.notEqual(output.toLowerCase(), runtimeOutput.toLowerCase());
  const result = await probeDirectoryConstructor(JSON.parse(readFileSync(values.packet)));
  writeFileSync(output, JSON.stringify(result.review, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(runtimeOutput, JSON.stringify(result.runtime, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("Verified the exact unsigned Directory CREATE on two providers. No signing or broadcast. Indicative maximum " + result.review.cost.proposedMaximumEth + " ETH; fresh wallet approval required.");
}
