import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { publicationDigest, publicationActionTypes, publicationDomainTypes, prepareGovernancePublication } from "../../packages/contracts/scripts/prepare-governance-publication.mjs";
import { privateOutputPath } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
import { MOBILE_DEPLOYMENT_PAYER } from "../production-readiness/mobile-sender.mjs";
import { governanceReviewPage } from "./rmt-governance-review-page.mjs";
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, encodeFunctionResult, parseAbi, zeroHash } = require("viem");
const policy = JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task045/operations-safe-policy.json", import.meta.url))).operations;
const profile = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url)));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export function governanceReviewConfiguration(endpoint, publication, { allowTestFixture = false } = {}) {
  assert.ok(!publication.testOnly || allowTestFixture, "Test-only governance packets cannot prepare an owner signature artifact");
  const url = new URL(endpoint);
  const name = publication.action === "publish-factory" ? "factory" : "v3-template";
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === "/governance-" + name + ".html", "Use the exact isolated governance HTTPS path");
  assert.equal(publication.scope, "UNSIGNED_DIRECTORY_PUBLICATION_AUTHORIZATION");
  assert.equal(publication.chainId, 4663); assert.equal(publication.requiredSignatures, 2); assert.equal(publication.broadcastAuthorized, false);
  assert.ok(publication.action === "publish-factory" || publication.action === "publish-v3-template");
  assert.equal(publication.compilerInputSha256, profile.inputSha256);
  assert.equal(publication.protocolSender, MOBILE_DEPLOYMENT_PAYER);
  assert.equal(publication.typedData.domain.name, "RMT Launch Curve Directory"); assert.equal(publication.typedData.domain.version, "2");
  assert.equal(publication.typedData.domain.chainId, 4663); assert.equal(publication.typedData.domain.verifyingContract, publication.directory);
  assert.equal(publication.typedData.primaryType, "Action");
  assert.deepEqual(publication.typedData.types, { EIP712Domain: publicationDomainTypes, ...publicationActionTypes });
  assert.equal(publicationDigest(publication.typedData), publication.digest);
  assert.equal(publication.typedData.message.kind, name === "factory" ? 0 : 4); assert.equal(publication.typedData.message.version, name === "factory" ? 1 : 3);
  if (!publication.testOnly) assert.deepEqual(publication.owners, policy.owners);
  assert.equal(publication.owners.length, 3); assert.equal(new Set(publication.owners.map((a) => a.toLowerCase())).size, 3);
  assert.deepEqual(publication.protocolReceipts.map((p) => p.id), ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"],
    "Every protocol deployment must be canonically verified before signature collection");
  assert.ok(publication.runtimePins.length === 8 && publication.runtimePins.every((p) => /^[a-f0-9]{64}$/.test(p.sha256) && p.byteLength > 0));
  assert.ok(publication.runtimePins.some((p) => p.address.toLowerCase() === publication.directory.toLowerCase()));
  assert.ok(publication.runtimePins.some((p) => p.address.toLowerCase() === publication.typedData.message.factory.toLowerCase() && p.runtimeHash === publication.typedData.message.runtimeHash));
  const abi = parseAbi(["function signerA() view returns(address)", "function signerB() view returns(address)", "function signerC() view returns(address)",
    "function nonce() view returns(uint64)", "function signerSetEpoch() view returns(uint64)", "function latestVersion() view returns(uint32)",
    "function suspended() view returns(bool)", "function pending() view returns(bytes32,uint48,uint48)", "function pendingRotation() view returns(bytes32,uint48,uint48)",
    "function publicationDelay() view returns(uint48)", "function executionWindow() view returns(uint48)",
    "function actionDigest((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)) view returns(bytes32)"]);
  const expected = [["signerA", publication.owners[0]], ["signerB", publication.owners[1]], ["signerC", publication.owners[2]],
    ["nonce", BigInt(publication.typedData.message.nonce)], ["signerSetEpoch", BigInt(publication.typedData.message.signerSetEpoch)],
    ["latestVersion", name === "factory" ? 0 : 1], ["suspended", false], ["pending", [zeroHash, 0, 0]], ["pendingRotation", [zeroHash, 0, 0]],
    ["publicationDelay", 172800], ["executionWindow", 604800]];
  const checks = expected.map(([functionName, result]) => ({ data: encodeFunctionData({ abi, functionName }), expected: encodeFunctionResult({ abi, functionName, result }) }));
  checks.push({ data: encodeFunctionData({ abi, functionName: "actionDigest", args: [{ ...publication.typedData.message,
    nonce: BigInt(publication.typedData.message.nonce), signerSetEpoch: BigInt(publication.typedData.message.signerSetEpoch), deadline: BigInt(publication.typedData.message.deadline) }] }), expected: publication.digest });
  for (const check of checks) assert.ok(publication.directoryChecks.some((c) => c.data === check.data && c.expected === check.expected), "Exact current Directory state/digest check missing");
  return { ...publication, endpoint: url.href, directoryChecks: checks };
}
export function buildGovernanceReview(endpoint, publication, options) {
  const config = governanceReviewConfiguration(endpoint, publication, options), key = randomBytes(32), iv = randomBytes(12);
  const binding = "RMT governance typed action\n" + endpoint;
  const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(binding));
  const payload = Buffer.concat([cipher.update(JSON.stringify(config)), cipher.final(), cipher.getAuthTag()]);
  const script = "(" + governanceReviewPage.toString().replace(/\r\n?/g, "\n") + ")(" + JSON.stringify({ endpoint, binding, iv: iv.toString("base64"), payload: payload.toString("base64") }) + ");";
  const style = "[hidden]{display:none!important}html{color-scheme:dark}body{margin:0;background:#0a0e0b;color:#eef4ee;font:1rem/1.45 system-ui,sans-serif}main{max-width:39rem;margin:1rem auto;padding:0 1rem}h1{font-size:1.65rem;overflow-wrap:anywhere}section{border:1px solid #3a473e;border-radius:.6rem;padding:.8rem;margin:.8rem 0}button,input{font:inherit;max-width:100%;box-sizing:border-box;padding:.7rem;border-radius:.45rem}button{background:#2bdf4b;color:#071009;border:0;font-weight:700;min-height:44px}button:disabled{opacity:.5}input[type=password]{width:100%;margin:.4rem 0}dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:.4rem;font-size:.9rem}dd{margin:0;overflow-wrap:anywhere}p{overflow-wrap:anywhere}#status{color:#ffd689}label{display:block;margin:.8rem 0}input[type=checkbox]{min-width:24px;min-height:24px;vertical-align:middle}";
  const b64 = (s) => createHash("sha256").update(s).digest("base64"), csp = "default-src 'none';script-src 'sha256-" + b64(script) + "';style-src 'sha256-" + b64(style) + "';base-uri 'none';form-action 'none'";
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><title>RMT governance authorization</title><style>' + style + '</style></head><body><main><h1>RMT governance authorization</h1><p>Robinhood Chain 4663. Two existing governance owners must approve the same exact EIP-712 action. These signatures authorize a later schedule transaction. This page requests no transaction, gas payment or token approval.</p><section id="access"><label for="access-code">Owner access code</label><input id="access-code" type="password" maxlength="43" autocomplete="off" autocapitalize="off" spellcheck="false"><button id="unlock">Unlock</button></section><p id="status" role="status" aria-live="polite">Unlock the exact publication action.</p><section id="controls" hidden><button id="connect">Connect Rabby governance account</button> <button id="review">Review exact action</button> <button id="logout">Lock</button><div id="facts"></div><label id="approval-label" hidden><input id="approve" type="checkbox"> I authorize this exact publication action with the displayed target, nonce, signer epoch and deadline.</label><button id="sign" disabled>Review typed signature in Rabby</button><p>After the first response, switch to a different existing governance owner in Rabby, reconnect and review the same action. Account changes retain collected responses; authority changes invalidate them.</p><button id="download" disabled>Download private authorization JSON</button><p>Return the downloaded file for cryptographic verification before the separate owner-approved schedule transaction. No automatic broadcast. The actual two-day notice begins only when scheduling confirms onchain.</p><p>Some Blockscout source-verification requests remain pending or rate-limited (HTTP 429) at preparation. Matching the compiled runtime and publishing source are separate checks. 22 scanner highs and 7 governance-medium observations remain documented. This preparation is not an audit or production clearance. L1 finality remains unverified.</p></section></main><script>' + script + '</script></body></html>';
  return { html, accessCode: key.toString("base64url"), manifest: { scope: config.scope, endpoint, action: config.action,
    directory: config.directory, digest: config.digest, signingDeadlineUtc: config.signingDeadlineUtc, signatureMethod: "eth_signTypedData_v4",
    automaticSignature: false, transactionMethods: [], broadcastAuthorized: false, htmlSha256: sha256(html) } };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { url: { type: "string" }, publication: { type: "string" }, packet: { type: "string" }, proofs: { type: "string" }, output: { type: "string" }, "key-file": { type: "string" } } });
  const output = privateOutputPath(values.output), keyFile = privateOutputPath(values["key-file"]); assert.notEqual(output.toLowerCase(), keyFile.toLowerCase());
  const publication = JSON.parse(readFileSync(values.publication));
  assert.ok(!publication.testOnly && values.packet && values.proofs, "Production export requires both actual source packet and all five canonical deployment proofs");
  const refreshed = await prepareGovernancePublication({ packet: JSON.parse(readFileSync(values.packet)), deploymentProofs: JSON.parse(readFileSync(values.proofs)),
    action: publication.action, deadline: publication.typedData.message.deadline });
  assert.equal(refreshed.digest, publication.digest, "Governance authority changed; prepare a fresh bound authorization");
  const built = buildGovernanceReview(values.url, refreshed);
  writeFileSync(output, built.html, { flag: "wx", mode: 0o600 }); writeFileSync(keyFile, built.accessCode + "\n", { flag: "wx", mode: 0o600 });
  console.log("Prepared offchain governance signature collection only. No transaction method, live signature or publication occurred.");
}
