import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildOwnerTransactionReview, ownerSafeConfiguration } from "./export-rmt-owner-safe.mjs";
import { pinnedSafeCreationRows } from "../../packages/contracts/scripts/mobile-review-plan.mjs";
import { MOBILE_DEPLOYMENT_PAYER } from "../production-readiness/mobile-sender.mjs";
import { approvedRmtTerms, privateOutputPath } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, getContractAddress, keccak256, parseAbi,
  stringToHex, zeroAddress, zeroHash } = require("viem");
const read = (path) => JSON.parse(readFileSync(new URL("../../docs/evidence/" + path, import.meta.url)));
const profile = read("fixed-supply-security/4663-profile.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeRows = pinnedSafeCreationRows({ includePrivateCalldata: true });
const owners = safeRows[0].details.owners;
const reserveHash = "0x3daa6a602b7b2f556c03e9ddf5c142b96111b4bbfd38345c8e1769d7b0611091";

export function ownerProtocolConfiguration(endpoint, packet, runtimeEvidence, directoryRuntime, { allowTestFixture = false } = {}) {
  assert.ok(!packet.testOnly || allowTestFixture, "Test-only inputs cannot prepare an owner signing artifact");
  const url = new URL(endpoint);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === "/protocol-deployment.html", "Use the exact isolated protocol deployment HTTPS path");
  const { plan } = packet;
  assert.equal(plan?.scope, "UNSIGNED_4663_PROTOCOL_CONTINUATION_AFTER_BOTH_SAFE_RECEIPTS");
  assert.equal(plan.chainId, 4663);
  assert.equal(plan.sender, MOBILE_DEPLOYMENT_PAYER);
  assert.equal(plan.broadcastAuthorized, false);
  assert.equal(plan.signingAuthorized, false);
  assert.equal(plan.tokenCreation, null, "Infrastructure must not issue a token");
  assert.equal(plan.compiler.inputSha256, profile.inputSha256);
  assert.deepEqual(plan.terms, approvedRmtTerms);
  const { planSha256, ...hashedPlan } = plan;
  assert.equal(sha256(JSON.stringify(hashedPlan)), planSha256, "Unsigned packet binding differs");
  assert.equal(plan.safeReceipts.length, 2);
  assert.equal(plan.safeCurrent.length, 2);
  assert.equal(plan.safeReceipts[1].hash, reserveHash, "Wrong Reserve creation receipt");
  const operation = plan.constructors[0];
  assert.equal(operation.id, "directory");
  assert.equal(operation.contract, "RMTLaunchCurveDirectoryV2");
  assert.equal(operation.nonce, plan.confirmedNonce);
  assert.equal(operation.nonce, plan.pendingNonce);
  assert.equal(operation.address.toLowerCase(), getContractAddress({ from: plan.sender, nonce: BigInt(operation.nonce) }).toLowerCase());
  assert.match(operation.initcode, /^0x(?:[0-9a-f]{2})+$/i);
  assert.equal(keccak256(operation.initcode), operation.initcodeHash);
  const args = encodeAbiParameters(owners.map(() => ({ type: "address" })), owners);
  assert.equal(operation.constructorData, args, "Directory governance constructor differs");
  assert.ok(operation.initcode.endsWith(args.slice(2)));
  const creation = operation.initcode.slice(0, -(args.length - 2));
  assert.equal(sha256(Buffer.from(creation.slice(2), "hex")), profile.templates.RMTLaunchCurveDirectoryV2.creationSha256,
    "Directory creation bytecode differs from frozen compiler output");
  assert.equal(directoryRuntime.contract, operation.contract);
  assert.equal(directoryRuntime.address.toLowerCase(), operation.address.toLowerCase());
  assert.equal(keccak256(directoryRuntime.runtimeCode), operation.runtimeHash, "Materialized runtime differs");
  assert.equal((directoryRuntime.runtimeCode.length - 2) / 2, operation.runtimeBytes);
  const base = ownerSafeConfiguration(new URL("/reserve-deployment.html", url).href, runtimeEvidence, {
    role: "RMT-RESERVE", operationsVerification: plan.safeReceipts[0],
  });
  const prerequisites = plan.safeReceipts.map((proof, index) => {
    assert.equal(proof.status, "L2_CREATION_VERIFIED");
    assert.equal(proof.chainId, 4663);
    assert.equal(proof.role, index === 0 ? "RMT-OPERATIONS" : "RMT-RESERVE");
    assert.equal(proof.safe.toLowerCase(), safeRows[index].expectedAddress.toLowerCase());
    assert.equal(proof.broadcastAuthorized, false);
    const current = plan.safeCurrent[index];
    assert.equal(current.role, proof.role);
    assert.equal(current.safe.toLowerCase(), proof.safe.toLowerCase());
    assert.equal(current.state.runtimeHash, "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c");
    assert.deepEqual(current.state.owners, owners);
    assert.equal(current.state.threshold, "2");
    assert.equal(current.state.nonce, "0");
    assert.deepEqual(current.state.modules, []);
    const event = index === 0 ? base.operationsVerification.event : base.creationEvent;
    return { ...proof, proxy: base.proxy, postState: base.postState, transaction: {
      from: plan.sender, to: safeRows[index].to, input: safeRows[index].calldata, value: "0x0",
    }, event };
  });
  const abi = parseAbi([
    "function signerA() view returns(address)", "function signerB() view returns(address)", "function signerC() view returns(address)",
    "function signerSetEpoch() view returns(uint64)", "function rotationNonce() view returns(uint64)", "function nonce() view returns(uint64)",
    "function latestVersion() view returns(uint32)", "function suspended() view returns(bool)",
    "function pending() view returns(bytes32,uint48,uint48)", "function pendingRotation() view returns(bytes32,uint48,uint48)",
    "function publicationDelay() view returns(uint48)", "function executionWindow() view returns(uint48)", "function MAX_CURVE_VERSION() view returns(uint32)",
    "function ACTION_TYPEHASH() view returns(bytes32)",
    "function eip712Domain() view returns(bytes1,string,string,uint256,address,bytes32,uint256[])",
  ]);
  const state = (functionName, result) => ({ data: encodeFunctionData({ abi, functionName }),
    expected: encodeFunctionResult({ abi, functionName, result }) });
  const gasAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
  return { ...base, endpoint: url.href, mode: "CREATE", role: "PROTOCOL-DIRECTORY", task: "OWNER_CONTROLLED_PROTOCOL_DIRECTORY",
    operationsVerification: null, prerequisites, earlierFeeCeilingWei: null,
    operation: { id: "directory", label: "Deploy RMTLaunchCurveDirectoryV2", to: null, data: operation.initcode,
      dataHash: operation.initcodeHash, expectedAddress: operation.address, nonce: "0x" + BigInt(operation.nonce).toString(16), owners },
    nitroData: encodeFunctionData({ abi: gasAbi, functionName: "gasEstimateComponents", args: [zeroAddress, true, operation.initcode] }),
    createdContract: { address: operation.address, sha256: sha256(Buffer.from(directoryRuntime.runtimeCode.slice(2), "hex")), byteLength: operation.runtimeBytes },
    postState: [state("signerA", owners[0]), state("signerB", owners[1]), state("signerC", owners[2]),
      state("signerSetEpoch", 1n), state("rotationNonce", 0n), state("nonce", 0n), state("latestVersion", 0), state("suspended", false),
      state("pending", [zeroHash, 0n, 0n]), state("pendingRotation", [zeroHash, 0n, 0n]),
      state("publicationDelay", 172800n), state("executionWindow", 604800n), state("MAX_CURVE_VERSION", 32),
      state("ACTION_TYPEHASH", keccak256(stringToHex("Action(uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)"))),
      state("eip712Domain", ["0x0f", "RMT Launch Curve Directory", "2", 4663n, operation.address, zeroHash, []])],
    planSha256, compilerInputSha256: profile.inputSha256, runtimeKeccak256: operation.runtimeHash,
  };
}

export function buildOwnerProtocolReview(endpoint, packet, runtimes, directoryRuntime, options) {
  const config = ownerProtocolConfiguration(endpoint, packet, runtimes, directoryRuntime, options);
  const result = buildOwnerTransactionReview(config);
  return { ...result, manifest: { ...result.manifest, nonce: config.operation.nonce, mode: "CREATE",
    runtimeKeccak256: config.runtimeKeccak256, compilerInputSha256: config.compilerInputSha256, planSha256: config.planSha256 } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { url: { type: "string" }, packet: { type: "string" }, runtimes: { type: "string" },
    "directory-runtime": { type: "string" }, output: { type: "string" }, "key-file": { type: "string" } } });
  const output = privateOutputPath(values.output), keyFile = privateOutputPath(values["key-file"]);
  assert.notEqual(output.toLowerCase(), keyFile.toLowerCase());
  const result = buildOwnerProtocolReview(values.url, JSON.parse(readFileSync(values.packet)), JSON.parse(readFileSync(values.runtimes)),
    JSON.parse(readFileSync(values["directory-runtime"])));
  writeFileSync(output, result.html, { flag: "wx", mode: 0o600 });
  writeFileSync(keyFile, result.accessCode + "\n", { flag: "wx", mode: 0o600 });
  console.log("Prepared only the exact Directory CREATE. Live costs and owner MetaMask confirmation remain required.");
}
