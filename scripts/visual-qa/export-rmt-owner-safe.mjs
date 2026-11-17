import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { pinnedSafeCreationRows, safeProxyRuntimeHash } from "../../packages/contracts/scripts/mobile-review-plan.mjs";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../production-readiness/mobile-sender.mjs";
import { privateOutputPath } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
import { ownerSafePage } from "./rmt-owner-safe-page.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { keccak256, encodeFunctionData, encodeFunctionResult, encodeAbiParameters, encodeEventTopics,
  parseAbi, padHex, stringToHex, zeroHash } = require("viem");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = (name) => JSON.parse(readFileSync(new URL("../../docs/evidence/" + name, import.meta.url)));
const registry = load("rmt-task044/safe-infrastructure-4663.json").registry.contracts["1.4.1"];
const operation = pinnedSafeCreationRows({ includePrivateCalldata: true })[0];
const expectedPins = [registry.safe_l2, registry.safe_proxy_factory, registry.compatibility_fallback_handler]
  .map(({ address, registryRuntimeKeccak256 }) => ({ address, hash: registryRuntimeKeccak256 }));

export function ownerSafeConfiguration(endpoint, evidence) {
  const url = new URL(endpoint);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === "/owner-deployment.html", "Use the exact isolated owner deployment HTTPS path");
  assert.equal(evidence.chainId, 4663, "Wrong runtime evidence chain");
  const entries = evidence.pins ?? evidence.contracts ?? [];
  const checked = (address, expectedHash, supplied) => {
    const code = supplied ?? entries.find((row) => row.address.toLowerCase() === address.toLowerCase())?.code;
    assert.match(code, /^0x(?:[0-9a-f]{2})+$/i, "Missing runtime bytes");
    assert.equal(keccak256(code), expectedHash, "Runtime differs from its reviewed pin");
    return { address, sha256: sha256(Buffer.from(code.slice(2), "hex")), byteLength: (code.length - 2) / 2 };
  };
  const runtimePins = expectedPins.map(({ address, hash }) => checked(address, hash));
  const delegate = checked(MOBILE_DELEGATE_POLICY.address, MOBILE_DELEGATE_POLICY.runtimeHash,
    evidence.delegateCode ?? entries.find(({ role }) => role === "delegate")?.code);
  const proxy = checked(operation.expectedAddress, safeProxyRuntimeHash,
    evidence.proxyRuntimeCode ?? entries.find(({ role }) => role === "proxy")?.code);
  const abi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns (uint64,uint64,uint256,uint256)"]);
  const safeAbi = parseAbi([
    "function masterCopy() view returns (address)", "function VERSION() view returns (string)",
    "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)",
    "function nonce() view returns (uint256)",
    "function getModulesPaginated(address,uint256) view returns (address[],address)",
    "function getStorageAt(uint256,uint256) view returns (bytes)",
    "event ProxyCreation(address indexed proxy,address singleton)",
  ]);
  const state = (functionName, result, args = []) => ({
    data: encodeFunctionData({ abi: safeAbi, functionName, args }),
    expected: encodeFunctionResult({ abi: safeAbi, functionName, result }),
  });
  const sentinel = "0x0000000000000000000000000000000000000001";
  const slot = (name) => BigInt(keccak256(stringToHex(name)));
  return {
    schemaVersion: 1, endpoint: url.href, chainId: "0x1237", sender: MOBILE_DEPLOYMENT_PAYER,
    task: "OWNER_CONTROLLED_OPERATIONS_SAFE_1", runtimePins,
    delegate: { ...delegate, designator: MOBILE_DELEGATE_POLICY.designator }, proxy,
    operation: { id: operation.id, to: operation.to, data: operation.calldata, dataHash: operation.dataHash,
      expectedAddress: operation.expectedAddress, ...operation.details },
    nitroData: encodeFunctionData({ abi, functionName: "gasEstimateComponents",
      args: [operation.to, false, operation.calldata] }),
    creationEvent: { topic: encodeEventTopics({ abi: safeAbi, eventName: "ProxyCreation" })[0],
      proxyTopic: padHex(operation.expectedAddress, { size: 32 }),
      data: encodeAbiParameters([{ type: "address" }], [operation.details.singleton]) },
    postState: [state("masterCopy", operation.details.singleton), state("VERSION", "1.4.1"),
      state("getOwners", operation.details.owners), state("getThreshold", 2n), state("nonce", 0n),
      state("getModulesPaginated", [[], sentinel], [sentinel, 1n]),
      state("getStorageAt", padHex(operation.details.fallbackHandler, { size: 32 }), [slot("fallback_manager.handler.address"), 1n]),
      state("getStorageAt", zeroHash, [slot("guard_manager.guard.address"), 1n])],
    earlierFeeCeilingWei: "15677394780000",
    reserve: { status: "LOCKED_UNTIL_OPERATIONS_CANONICAL_VERIFICATION", address: pinnedSafeCreationRows()[1].expectedAddress },
  };
}

export function buildOwnerSafeReview(endpoint, evidence) {
  const configuration = ownerSafeConfiguration(endpoint, evidence);
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const binding = "RMT owner Operations Safe 1\n" + endpoint;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding));
  const payload = Buffer.concat([cipher.update(JSON.stringify(configuration), "utf8"), cipher.final(), cipher.getAuthTag()]);
  const script = "(" + ownerSafePage.toString().replace(/\r\n?/g, "\n") + ")(" + JSON.stringify({
    endpoint, binding, iv: iv.toString("base64"), payload: payload.toString("base64"),
  }) + ");";
  const style = "html{color-scheme:dark}body{margin:0;background:#0a0e0b;color:#eef4ee;font:1rem/1.45 system-ui,sans-serif}main{max-width:39rem;margin:1rem auto;padding:0 1rem}h1{font-size:1.65rem;line-height:1.15}button,input{font:inherit;box-sizing:border-box;max-width:100%;padding:.7rem;border-radius:.45rem}button{background:#2bdf4b;color:#071009;border:0;font-weight:700;min-height:44px}button:disabled{opacity:.5}input[type=password],input[type=text]{width:100%;margin:.4rem 0}section{border:1px solid #3a473e;border-radius:.6rem;padding:.75rem;margin:.8rem 0}dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:.35rem .7rem;font-size:.9rem}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}label{display:block;margin:.6rem 0}details{margin:.6rem 0}summary{cursor:pointer;min-height:44px}#status{color:#ffd689}input[type=checkbox]{min-width:24px;min-height:24px;vertical-align:middle}";
  const b64sha = (value) => createHash("sha256").update(value).digest("base64");
  const csp = "default-src 'none';script-src 'sha256-" + b64sha(script) + "';style-src 'sha256-" + b64sha(style) + "';base-uri 'none';form-action 'none'";
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><title>RMT Operations Safe</title><style>' + style + '</style></head><body><main><h1>RMT Operations Safe</h1><p>Robinhood Chain 4663 MAINNET · Network fees use real ETH</p><section id="access"><label for="access-code">Owner access code</label><input id="access-code" type="password" maxlength="43" autocomplete="off" autocapitalize="off" spellcheck="false"><button id="unlock">Unlock</button></section><p id="status" role="status" aria-live="polite">Unlock the owner transaction review.</p><section id="controls" hidden><p>Operations SafeL2 1.4.1 · existing three owners · 2 of 3 approvals.</p><button id="connect">Connect MetaMask</button> <button id="refresh">Review live costs</button><button id="logout">Lock</button><div id="facts"></div><label id="approval-label" hidden><input id="approve" type="checkbox"> I approve the displayed maximum network cost for this exact Operations Safe transaction.</label><button id="send" disabled>Open transaction in MetaMask</button><p>MetaMask displays the final transaction and network cost. Confirm it personally to sign and broadcast.</p><details><summary>Recover the original transaction</summary><p>Recovery reads the existing request and receipt. It never submits another transaction.</p><input id="recovery-hash" type="text" maxlength="66" placeholder="0x transaction hash"><button id="recover">Check transaction</button></details><p>Reserve stays locked until Operations has a verified canonical receipt.</p></section></main><script>' + script + '</script></body></html>';
  return { html, accessCode: key.toString("base64url"), manifest: {
    scope: configuration.task, endpoint, chainId: 4663, sender: configuration.sender,
    calldataHash: configuration.operation.dataHash, expectedAddress: configuration.operation.expectedAddress,
    liveFeesRequired: true, automaticSubmission: false,
  } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { url: { type: "string" }, runtimes: { type: "string" }, output: { type: "string" }, "key-file": { type: "string" } } });
  const output = privateOutputPath(values.output);
  const keyFile = privateOutputPath(values["key-file"]);
  assert.notEqual(output.toLowerCase(), keyFile.toLowerCase(), "Keep the access code separate");
  const result = buildOwnerSafeReview(values.url, JSON.parse(readFileSync(values.runtimes)));
  writeFileSync(output, result.html, { flag: "wx", mode: 0o600 });
  writeFileSync(keyFile, result.accessCode + "\n", { flag: "wx", mode: 0o600 });
  console.log("Prepared the exact owner Operations Safe page. Live wallet costs and owner confirmation remain required.");
}
