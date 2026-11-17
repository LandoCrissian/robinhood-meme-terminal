// Public deterministic synthetic assets and keys for local unit/browser tests only. Never imported by production CLIs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { buildPublicationAction, publicationActionTypes } from "./prepare-governance-publication.mjs";
import { verifyGovernanceAuthorization } from "./verify-governance-authorization.mjs";
import { governanceTransactionAbi, governanceEventConfiguration } from "./prepare-governance-transaction.mjs";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../../../scripts/production-readiness/mobile-sender.mjs";
const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, toHex, zeroHash } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
export async function makeGovernanceTransactionFixture() {
  const accounts = [1, 2, 3].map((n) => privateKeyToAccount("0x" + n.toString(16).padStart(64, "0")));
  const addresses = Array.from({ length: 8 }, (_, i) => "0x" + (0x10001 + i).toString(16).padStart(40, "0"));
  const code = "0x6000", baseTime = Math.floor(Date.now() / 1000), clock = { time: baseTime, phase: "schedule", nonce: 483n,
    pendingNonceDrift: false, badAuthority: false, badRuntime: false, badScheduleEvent: false, scheduleReorg: false, executeReceipt: false };
  const publication = buildPublicationAction({ action: "publish-factory", directory: addresses[0], target: addresses[7], runtimeHash: keccak256(code),
    nonce: "0", signerSetEpoch: "1", blockTimestamp: baseTime, owners: accounts.map((a) => a.address), testOnly: true }, { allowTestFixture: true });
  const abi = parseAbi(["function signerA() view returns(address)", "function signerB() view returns(address)", "function signerC() view returns(address)",
    "function nonce() view returns(uint64)", "function signerSetEpoch() view returns(uint64)", "function latestVersion() view returns(uint32)",
    "function suspended() view returns(bool)", "function pending() view returns(bytes32,uint48,uint48)", "function pendingRotation() view returns(bytes32,uint48,uint48)",
    "function publicationDelay() view returns(uint48)", "function executionWindow() view returns(uint48)",
    "function actionDigest((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)) view returns(bytes32)"]);
  const states = [["signerA", accounts[0].address], ["signerB", accounts[1].address], ["signerC", accounts[2].address], ["nonce", 0n], ["signerSetEpoch", 1n],
    ["latestVersion", 0], ["suspended", false], ["pending", [zeroHash, 0, 0]], ["pendingRotation", [zeroHash, 0, 0]], ["publicationDelay", 172800], ["executionWindow", 604800]];
  publication.directoryChecks = states.map(([functionName, result]) => ({ data: encodeFunctionData({ abi, functionName }), expected: encodeFunctionResult({ abi, functionName, result }) }));
  publication.directoryChecks.push({ data: encodeFunctionData({ abi, functionName: "actionDigest", args: [{ ...publication.typedData.message,
    nonce: 0n, signerSetEpoch: 1n, deadline: BigInt(publication.typedData.message.deadline) }] }), expected: publication.digest });
  publication.protocolSender = MOBILE_DEPLOYMENT_PAYER;
  publication.compilerInputSha256 = JSON.parse(readFileSync(new URL("../../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url))).inputSha256;
  publication.runtimePins = addresses.map((address) => ({ address, runtimeHash: keccak256(code), byteLength: 2,
    sha256: createHash("sha256").update(Buffer.from("6000", "hex")).digest("hex") }));
  publication.protocolReceipts = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"].map((id, i) => ({ id, address: addresses[i],
    hash: "0x" + (i + 1).toString(16).padStart(64, "0"), blockHash: "0x" + (i + 11).toString(16).padStart(64, "0"),
    blockNumber: String(100 + i), input: "0x6000", nonce: toHex(478 + i), value: "0x0" }));
  const responses = [];
  for (const account of accounts.slice(0, 2)) responses.push({ signer: account.address, signature: await account.signTypedData({ ...publication.typedData, types: publicationActionTypes }) });
  const authorization = { schemaVersion: 1, scope: "OWNER_COLLECTED_DIRECTORY_TYPED_SIGNATURES", digest: publication.digest,
    directory: publication.directory, typedData: publication.typedData, signatureResponses: responses };
  const verifiedAuthorization = await verifyGovernanceAuthorization(publication, authorization, { allowTestFixture: true });
  const scheduleHash = "0x" + "88".repeat(32), scheduleBlockHash = "0x" + "77".repeat(32), headHash = "0x" + "aa".repeat(32);
  const event = governanceEventConfiguration(publication), executeAfter = BigInt(baseTime) + 172800n, executeBy = BigInt(baseTime) + 777600n;
  const executionData = encodeFunctionData({ abi: governanceTransactionAbi, functionName: "execute", args: [{ ...publication.typedData.message, nonce: 0n, signerSetEpoch: 1n,
    deadline: BigInt(publication.typedData.message.deadline) }] });
  const scheduleTransaction = { hash: scheduleHash, from: MOBILE_DEPLOYMENT_PAYER, to: publication.directory, type: "0x2", chainId: "0x1237", nonce: toHex(483), value: "0x0",
    input: verifiedAuthorization.scheduleCalldata, accessList: [], blockHash: scheduleBlockHash, blockNumber: "0x80", transactionIndex: "0x0", gas: toHex(250000),
    maxFeePerGas: toHex(40000000), maxPriorityFeePerGas: "0x0" };
  const runtimeEvidence = JSON.parse(gunzipSync(readFileSync(new URL("../../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz", import.meta.url))));
  const pendingData = encodeFunctionData({ abi, functionName: "pending" });
  const calls = [], simulations = [];
  const block = (number = "0x100", hash = headHash, time = clock.time) => ({ number, hash, timestamp: toHex(time), gasLimit: toHex(30000000) });
  const rawReader = async (method, params = []) => {
    calls.push({ method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") {
      if (params[0] === "0x80") return block("0x80", clock.scheduleReorg ? headHash : scheduleBlockHash, baseTime);
      const proof = publication.protocolReceipts.find((p) => toHex(BigInt(p.blockNumber)) === params[0]);
      return proof ? block(params[0], proof.blockHash, baseTime - 10) : block();
    }
    if (method === "eth_getTransactionCount") return toHex(clock.nonce + (params[1] === "pending" && clock.pendingNonceDrift ? 1n : 0n));
    if (method === "eth_getBalance") return toHex(10n ** 18n);
    if (method === "eth_getCode") {
      if (params[0].toLowerCase() === MOBILE_DEPLOYMENT_PAYER.toLowerCase()) return MOBILE_DELEGATE_POLICY.designator;
      if (params[0].toLowerCase() === MOBILE_DELEGATE_POLICY.address.toLowerCase()) return runtimeEvidence.delegateCode;
      if (accounts.some((a) => a.address.toLowerCase() === params[0].toLowerCase())) return "0x";
      return clock.badRuntime ? "0x6001" : code;
    }
    if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") {
      if (params[0] === scheduleHash) {
        if (method === "eth_getTransactionByHash") return scheduleTransaction;
        return { type: "0x2", from: MOBILE_DEPLOYMENT_PAYER, to: publication.directory, transactionHash: scheduleHash, status: "0x1", contractAddress: null,
          blockHash: scheduleBlockHash, blockNumber: "0x80", transactionIndex: "0x0", gasUsed: toHex(100000), effectiveGasPrice: toHex(20000000), logs: [{ address: publication.directory,
            topics: event.scheduleEventTopics, data: encodeAbiParameters([{ type: "uint48" }, { type: "uint48" }], [executeAfter, executeBy + (clock.badScheduleEvent ? 1n : 0n)]),
            transactionHash: scheduleHash, blockHash: scheduleBlockHash, blockNumber: "0x80", transactionIndex: "0x0", logIndex: "0x0", removed: false }] };
      }
      const proof = publication.protocolReceipts.find((p) => p.hash === params[0]);
      if (!proof) throw new Error("Unknown fixture transaction");
      if (method === "eth_getTransactionByHash") return { hash: proof.hash, from: MOBILE_DEPLOYMENT_PAYER, to: null, type: "0x2", chainId: "0x1237", value: "0x0", nonce: proof.nonce,
        input: proof.input, accessList: [], blockHash: proof.blockHash, blockNumber: toHex(BigInt(proof.blockNumber)) };
      return { transactionHash: proof.hash, from: MOBILE_DEPLOYMENT_PAYER, to: null, status: "0x1", contractAddress: proof.address, blockHash: proof.blockHash,
        blockNumber: toHex(BigInt(proof.blockNumber)), logs: [] };
    }
    if (method === "eth_gasPrice") return toHex(20000000);
    if (method === "eth_call") {
      const request = params[0];
      if (request.to.toLowerCase() === "0x00000000000000000000000000000000000000c8") return "0x" + [200000n, 0n, 20000000n, 0n].map((n) => n.toString(16).padStart(64, "0")).join("");
      if (request.data === verifiedAuthorization.scheduleCalldata || request.data === executionData) { simulations.push(request); return "0x"; }
      if (clock.badAuthority) return zeroHash;
      if (request.data === pendingData && clock.phase === "execute") return encodeFunctionResult({ abi, functionName: "pending", result: [publication.digest, executeAfter, executeBy] });
      const known = publication.directoryChecks.find((c) => c.data === request.data); if (known) return known.expected;
      throw new Error("Unknown fixture governance getter");
    }
    throw new Error("Forbidden or unexpected fixture RPC method " + method);
  };
  const readers = Object.fromEntries(["official", "pocket"].map((name) => [name, async (method, params = []) => ({ status: "observed", value: await rawReader(method, params) })]));
  const costReaders = Object.fromEntries(["official", "pocket"].map((name) => [name, async (method, params) => {
    calls.push({ method, params }); if (method === "eth_estimateGas") return toHex(150000); if (method === "eth_maxPriorityFeePerGas") return "0x0";
    throw new Error("Unexpected cost method");
  }]));
  return { accounts, addresses, code, baseTime, clock, publication, authorization, verifiedAuthorization, scheduleHash, scheduleBlockHash, headHash,
    scheduleTransaction, readers, rawReader, costReaders, calls, simulations, executionData, executeAfter, executeBy, event,
    now: () => clock.time * 1000 };
}
