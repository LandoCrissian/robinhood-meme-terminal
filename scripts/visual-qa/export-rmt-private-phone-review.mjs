import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { pinnedSafeCreationRows, safeProxyRuntimeHash } from "../../packages/contracts/scripts/mobile-review-plan.mjs";
import { approvedOperationsFeeCap, operationsFeeApprovalSource, operationsSafeBaseline, operationsSafePolicyApprovalSource,
  operationsSigningDecision, operationsOverCapSigningDecision, recommendOperationsFeeCap }
  from "../../packages/contracts/scripts/prepare-operations-safe.mjs";
import { approvedFirstProject, approvedRmtTerms } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../production-readiness/mobile-sender.mjs";
import { privateReviewPage } from "./rmt-private-phone-review-page.mjs";

const blocked = "BLOCKED_NO_BROADCAST";
const scope = "RMT_4663_OPERATIONS_SAFE_UNSIGNED_REVIEW";
const ttl = 24 * 60 * 60 * 1000;
const maxQuoteAgeMs = 120_000;
const address = /^0x[0-9a-f]{40}$/i;
const digest = /^0x[0-9a-f]{64}$/i;
const decimal = /^(?:0|[1-9][0-9]{0,77})$/;
const maxNonce = (1n << 64n) - 1n;
const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 240
  && !/[\u0000-\u001f<>]|0x[0-9a-f]{65}/i.test(value);
const matches = (value, pattern) => typeof value === "string" && value.trim() === value && pattern.test(value);
const sameHex = (observed, expected) => typeof observed === "string" && observed.toLowerCase() === expected.toLowerCase();
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const keys = (value, fields) => assert.deepEqual(Object.keys(value).sort(), fields.split(" ").sort(), "Unexpected review fields");

function validateReview(packet) {
  const currentPolicy = packet.schemaVersion === 5;
  const approved = currentPolicy || packet.schemaVersion === 4;
  const capped = approved || packet.schemaVersion === 3;
  keys(packet, "schemaVersion scope status broadcastAuthorized chainId sender observedAt expiresAt anchor pendingNonce confirmedNonce balanceWei delegation planId operation terms firstProject"
    + (approved ? " signingDecision transactionApproval" : "") + (currentPolicy ? " policyApproval" : ""));
  assert.ok((capped || packet.schemaVersion === 2) && packet.scope === scope && packet.status === blocked &&
    packet.broadcastAuthorized === false && packet.chainId === 4663, "Expected a blocked Operations Safe review on 4663");
  if (approved) {
    const decisions = currentPolicy ? [operationsSigningDecision, operationsOverCapSigningDecision]
      : ["BLOCKED_RELEASE_GATES", "BLOCKED_FEE_CEILING_AND_RELEASE_GATES"];
    assert.ok(decisions.includes(packet.signingDecision) &&
      packet.transactionApproval === null,
      "Expected signing to remain blocked independently of the owner-approved fee ceiling");
    if (currentPolicy) assert.equal(packet.policyApproval, operationsSafePolicyApprovalSource, "Missing scoped owner policy approval");
    assert.equal(packet.pendingNonce, operationsSafeBaseline.nonce, "The approved Operations Safe nonce has drifted");
  }
  assert.ok(matches(packet.sender, address) && sameHex(packet.sender, MOBILE_DEPLOYMENT_PAYER), "Unexpected proposed account");
  assert.ok(matches(packet.planId, digest) && matches(packet.balanceWei, decimal) &&
    matches(packet.pendingNonce, decimal) && packet.pendingNonce === packet.confirmedNonce &&
    BigInt(packet.pendingNonce) < maxNonce, "Invalid confirmed or pending nonce snapshot");
  keys(packet.anchor, "number hash blockTimeUtc");
  assert.ok(matches(packet.anchor.number, decimal) && BigInt(packet.anchor.number) <= maxNonce && matches(packet.anchor.hash, digest) &&
    timestamp(packet.anchor.blockTimeUtc) && timestamp(packet.observedAt) && timestamp(packet.expiresAt) &&
    Date.parse(packet.observedAt) >= Date.parse(packet.anchor.blockTimeUtc) &&
    Date.parse(packet.expiresAt) > Date.parse(packet.observedAt) &&
    Date.parse(packet.expiresAt) <= Date.parse(packet.anchor.blockTimeUtc) + maxQuoteAgeMs,
  "Invalid observation anchor or quote window");
  keys(packet.delegation, "address runtimeHash designator");
  for (const name of ["address", "runtimeHash", "designator"]) {
    assert.ok(sameHex(packet.delegation[name], MOBILE_DELEGATE_POLICY[name]), "Unexpected delegation policy");
  }
  assert.deepEqual(packet.terms, approvedRmtTerms, "Review terms differ from the approved engine");
  assert.deepEqual(packet.firstProject, approvedFirstProject, "Review metadata differs from the approved first project");

  const row = packet.operation;
  const [operations] = pinnedSafeCreationRows();
  const safe = operations.details;
  keys(row, "id label dependsOn sender nonce destination predictedAddress valueWei inputHash action status gas checks expectedRuntimeHash owners threshold safeVersion saltNonce initializerHash"
    + (capped ? " feeCap" : "") + (approved ? " feeApproval feeCapStatus freshRecommendation" : ""));
  assert.ok(row.id === "operations-safe" && row.action === "createProxyWithNonce(address,bytes,uint256)" &&
    row.status === "UNSIGNED_OPERATIONS_APPROVAL_REQUIRED" && row.valueWei === "0" && row.nonce === packet.pendingNonce &&
    sameHex(row.sender, packet.sender) && sameHex(row.destination, operations.to) &&
    sameHex(row.predictedAddress, operations.expectedAddress) && sameHex(row.inputHash, operations.dataHash) &&
    sameHex(row.expectedRuntimeHash, safeProxyRuntimeHash), "Unexpected Operations Safe transaction identity");
  assert.deepEqual(row.dependsOn, []);
  assert.deepEqual(row.owners, safe.owners, "Unexpected Operations Safe owners");
  assert.ok(row.threshold === safe.threshold && row.safeVersion === safe.safeProfile &&
    sameHex(row.saltNonce, safe.saltNonce) && sameHex(row.initializerHash, safe.initializerHash),
  "Unexpected Operations Safe setup");
  assert.ok(text(row.label) && Array.isArray(row.checks) && row.checks.length <= 16 && row.checks.every(text), "Invalid display text");

  const gas = row.gas;
  const gasFields = ["gasUnits", "l2GasUnits", "l1PosterGasUnits", "estimatedFeeWei", "estimatedL1FeeWei", "estimatedL2FeeWei"];
  if (capped) gasFields.push("rpcEstimateGas", "l2BaseFeeWei");
  keys(gas, gasFields.join(" ") + " provenance");
  assert.ok(gasFields.every((name) => matches(gas[name], decimal)) &&
    gas.provenance === "CURRENT_4663_READ_ONLY_NITRO_GAS_COMPONENTS" && BigInt(gas.gasUnits) > 0n &&
    BigInt(gas.gasUnits) === BigInt(gas.l2GasUnits) + BigInt(gas.l1PosterGasUnits) &&
    BigInt(gas.estimatedFeeWei) === BigInt(gas.estimatedL2FeeWei) + BigInt(gas.estimatedL1FeeWei) &&
    BigInt(gas.l2GasUnits) > 0n && BigInt(gas.estimatedL2FeeWei) > 0n, "Invalid Operations Safe fee evidence");

  if (!capped) return;
  const feeCap = row.feeCap;
  const feeCapFields = ["gasLimit", "maxFeePerGasWei", "maxPriorityFeePerGasWei", "maxNetworkFeeWei"];
  keys(feeCap, feeCapFields.join(" "));
  assert.ok(feeCapFields.every((name) => matches(feeCap[name], decimal)), "Invalid Operations Safe fee cap");
  const gasLimit = BigInt(feeCap.gasLimit);
  const maxFeePerGasWei = BigInt(feeCap.maxFeePerGasWei);
  const maxNetworkFeeWei = BigInt(feeCap.maxNetworkFeeWei);
  const l2BaseFee = BigInt(gas.l2BaseFeeWei);
  assert.ok(l2BaseFee > 0n && BigInt(gas.rpcEstimateGas) > 0n &&
    BigInt(gas.estimatedL2FeeWei) === l2BaseFee * BigInt(gas.l2GasUnits) &&
    BigInt(gas.estimatedL1FeeWei) === l2BaseFee * BigInt(gas.l1PosterGasUnits) &&
    feeCap.maxPriorityFeePerGasWei === "0" && maxNetworkFeeWei === gasLimit * maxFeePerGasWei &&
    maxNetworkFeeWei <= BigInt(packet.balanceWei), "Invalid Operations Safe fee cap");
  const required = recommendOperationsFeeCap({ nitroGas: gas.gasUnits, rpcGas: gas.rpcEstimateGas, l2BaseFee: gas.l2BaseFeeWei });
  if (approved) {
    assert.deepEqual(feeCap, approvedOperationsFeeCap, "The approved Operations Safe fee cap has changed");
    assert.equal(row.feeApproval, operationsFeeApprovalSource, "Missing conditional fee-ceiling approval");
    assert.deepEqual(row.freshRecommendation, required, "Invalid refreshed fee recommendation");
    const withinCeiling = BigInt(required.gasLimit) <= gasLimit && BigInt(required.maxFeePerGasWei) <= maxFeePerGasWei &&
      BigInt(gas.estimatedFeeWei) <= maxNetworkFeeWei;
    assert.equal(row.feeCapStatus, withinCeiling ? "WITHIN_APPROVED_CEILING" : "OVER_APPROVED_CEILING", "Invalid approved ceiling status");
    const withinDecision = currentPolicy ? operationsSigningDecision : "BLOCKED_RELEASE_GATES";
    const overDecision = currentPolicy ? operationsOverCapSigningDecision : "BLOCKED_FEE_CEILING_AND_RELEASE_GATES";
    assert.equal(packet.signingDecision, withinCeiling ? withinDecision : overDecision,
      "Signing decision does not match the approved ceiling evidence");
  } else {
    assert.deepEqual(feeCap, required, "Invalid Operations Safe fee cap");
  }
}

export function buildPrivatePhoneReview(endpoint, packet, expiry, { runtimeBytesForTest } = {}) {
  const url = new URL(endpoint);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
    /^[a-z0-9.-]+$/i.test(url.hostname) && (url.pathname === "/" || /^\/[a-z0-9/_-]+\.html$/i.test(url.pathname)),
  "Supply the exact approved HTTPS site root or a plain .html path");
  const expiryMs = Date.parse(expiry);
  assert.ok(timestamp(expiry) && expiryMs > Date.now() && expiryMs <= Date.now() + ttl, "Review expiry must be within 24 hours");
  validateReview(packet);
  assert.ok(runtimeBytesForTest === undefined || (url.hostname.endsWith(".test") && Buffer.isBuffer(runtimeBytesForTest) &&
    runtimeBytesForTest.length > 0 && runtimeBytesForTest.length <= 24576), "Runtime overrides are test-only");
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const binding = "RMT OPERATIONS PRIVATE PHONE REVIEW v" + packet.schemaVersion + "\n" + url.href + "\n" + expiry;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding));
  const payload = Buffer.concat([cipher.update(JSON.stringify(packet), "utf8"), cipher.final(), cipher.getAuthTag()]);
  const pageSource = privateReviewPage.toString().replace(/\r\n?/g, "\n");
  const script = "(" + pageSource + ")(" + JSON.stringify({
    url: url.href, expiryMs, binding, iv: iv.toString("base64"), payload: payload.toString("base64"),
    runtimeBytes: runtimeBytesForTest?.length ?? 11185,
    runtimeSha256: runtimeBytesForTest
      ? createHash("sha256").update(runtimeBytesForTest).digest("hex")
      : "c921aae598d4413e7e93d9b69cfce4043c59687bd988c31a41d56fd45094be90",
  }) + ");";
  const style = [
    "html{color-scheme:dark}body{margin:0;background:#0a0e0b;color:#eef4ee;font:1rem/1.45 system-ui,sans-serif}",
    "main{max-width:39rem;margin:1rem auto;padding:0 1rem}h1{font-size:1.65rem;line-height:1.15;margin:.4rem 0}p{margin:.5rem 0}",
    "button,input{box-sizing:border-box;max-width:100%;font:inherit;padding:.7rem;border-radius:.45rem}input{width:100%;margin:.35rem 0 .6rem}",
    "button{background:#2bdf4b;color:#071009;border:0;font-weight:700;min-height:44px}button:disabled{opacity:.55}",
    "#status{margin:.65rem 0;font-size:.9rem}section{border:1px solid #3a473e;border-radius:.6rem;padding:.65rem .75rem}",
    "#fee-status,#signing-status{font-size:.9rem;margin:0 0 .45rem}#signing-status,#fee-status[data-expired=true]{color:#ffd689}",
    "details{border-top:1px solid #3a473e}summary{cursor:pointer;font-weight:700;min-height:44px;display:list-item;align-content:center}",
    "dl{display:grid;gap:.25rem .65rem;grid-template-columns:minmax(0,1fr) minmax(0,2.15fr);font-size:.85rem;margin:.3rem 0 .5rem}",
    "dt{font-weight:650;color:#c2d1c2}dd{margin:0;overflow-wrap:anywhere}p,li,summary{overflow-wrap:anywhere}ol{padding-inline-start:1.45em}",
  ].join("");
  const sha = (value) => createHash("sha256").update(value).digest("base64");
  const policy = "default-src 'none'; script-src 'sha256-" + sha(script) + "'; style-src 'sha256-" + sha(style)
    + "'; base-uri 'none'; form-action 'none'";
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">',
    '<meta http-equiv="Content-Security-Policy" content="' + policy + '">',
    '<title>RMT Operations Safe review</title><style>' + style + '</style></head>',
    '<body><main><h1>RMT Operations Safe review</h1><p>Robinhood Chain 4663 · Read-only</p>',
    '<div id="unlock-panel"><p>Unlock to review the exact Operations Safe transaction and fee limit.</p>',
    '<label for="unlock-key">Review access code</label>',
    '<input id="unlock-key" type="password" maxlength="43" autocomplete="off" autocapitalize="off" spellcheck="false" disabled>',
    '<button id="unlock" disabled>Unlock review</button></div>',
    '<p id="status" role="status" aria-live="polite">Checking the review origin.</p>',
    '<section id="review" hidden aria-label="Unsigned Operations Safe creation"></section>',
    '<p><small>BLOCKED_NO_BROADCAST · Expires <time datetime="' + expiry + '">' + expiry + '</time>.</small></p>',
    '</main><script>' + script + '</script></body></html>',
  ].join("\n");
  return { html, accessCode: key.toString("base64url") };
}

function existingDirectoryFor(file) {
  assert.ok(isAbsolute(file), "Use absolute paths for local files");
  return realpathSync(dirname(file));
}

function outsideRepository(directory) {
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const location = relative(realpathSync(repo), directory);
  assert.ok(isAbsolute(location) || location === ".." || location.startsWith("..\\") || location.startsWith("../"),
    "Keep private phone review files outside the repository");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: {
    url: { type: "string" }, review: { type: "string" }, output: { type: "string" },
    "key-file": { type: "string" }, expires: { type: "string" },
  } });
  assert.ok(values.url && values.review && values.output && values["key-file"] && values.expires,
    "Supply --url, --review, --output, --key-file and --expires (ISO UTC)");
  const outputDirectory = existingDirectoryFor(values.output);
  const keyDirectory = existingDirectoryFor(values["key-file"]);
  for (const directory of [outputDirectory, keyDirectory, existingDirectoryFor(values.review)]) outsideRepository(directory);
  const keyLocation = relative(outputDirectory, keyDirectory);
  assert.ok(keyLocation !== "" && (isAbsolute(keyLocation) || keyLocation === ".." ||
    keyLocation.startsWith("..\\") || keyLocation.startsWith("../")), "Keep the access-code file outside the HTML output directory");
  assert.ok(!existsSync(values.output) && !existsSync(values["key-file"]), "Use fresh review output paths");
  const { html, accessCode } = buildPrivatePhoneReview(values.url, JSON.parse(readFileSync(values.review, "utf8")), values.expires);
  writeFileSync(values.output, html, { encoding: "utf8", flag: "wx", mode: 0o600 });
  writeFileSync(values["key-file"], accessCode + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
}
