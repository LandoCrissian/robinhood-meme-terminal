import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../production-readiness/mobile-sender.mjs";
import { privateReviewPage } from "./rmt-private-phone-review-page.mjs";

const blocked = "BLOCKED_NO_BROADCAST";
const scope = "RMT_4663_UNSIGNED_PRIVATE_REVIEW";
const ttl = 24 * 60 * 60 * 1000;
const stageIds = [
  "operations-safe", "reserve-safe", "directory", "registry", "successor-v2", "successor-v3", "bootstrap",
  "schedule-factory", "execute-factory", "schedule-migration-template", "execute-migration-template", "first-rmt",
];
const pinnedTerms = {
  fixedSupplyTokens: "1000000000", decimals: 18, curveTokens: "600000000", liquidityTokens: "400000000",
  projectShareBps: 9000, operationsShareBps: 500, reserveShareBps: 500,
  creationFeeWei: "400000000000000", graduationBackingWei: "2000000000000000000", curveFeeBps: 100,
};
const address = /^0x[0-9a-f]{40}$/i;
const digest = /^0x[0-9a-f]{64}$/i;
const decimal = /^(?:0|[1-9][0-9]{0,77})$/;
const maxNonce = (1n << 64n) - 1n;
const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 240
  && !/[\u0000-\u001f<>]|0x[0-9a-f]{65}/i.test(value);
const matches = (value, pattern) => typeof value === "string" && value.trim() === value && pattern.test(value);
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const optional = (value, pattern) => value === null || matches(value, pattern);
const keys = (value, fields) => assert.deepEqual(Object.keys(value).sort(), fields.split(" ").sort(), "Unexpected review fields");

function validateReview(packet) {
  keys(packet, "schemaVersion scope status broadcastAuthorized chainId sender observedAt expiresAt anchor pendingNonce confirmedNonce balanceWei delegation planId rows terms approvals");
  assert.ok(packet.schemaVersion === 1 && packet.scope === scope && packet.status === blocked &&
    packet.broadcastAuthorized === false && packet.chainId === 4663, "Expected a blocked sanitized 4663 review");
  assert.ok(matches(packet.sender, address) && packet.sender.toLowerCase() === MOBILE_DEPLOYMENT_PAYER.toLowerCase(),
    "Unexpected proposed account");
  assert.ok(matches(packet.planId, digest) && matches(packet.balanceWei, decimal) &&
    matches(packet.pendingNonce, decimal) && packet.pendingNonce === packet.confirmedNonce &&
    BigInt(packet.pendingNonce) + 6n <= maxNonce, "Invalid confirmed or pending nonce snapshot");
  keys(packet.anchor, "number hash blockTimeUtc");
  assert.ok(matches(packet.anchor.number, decimal) && BigInt(packet.anchor.number) <= maxNonce && matches(packet.anchor.hash, digest) &&
    timestamp(packet.anchor.blockTimeUtc) && timestamp(packet.observedAt) && timestamp(packet.expiresAt) &&
    Date.parse(packet.expiresAt) > Date.parse(packet.observedAt), "Invalid observation anchor");
  keys(packet.delegation, "address runtimeHash designator");
  for (const name of ["address", "runtimeHash", "designator"]) {
    assert.ok(typeof packet.delegation[name] === "string" &&
      packet.delegation[name].toLowerCase() === MOBILE_DELEGATE_POLICY[name].toLowerCase(), "Unexpected delegation policy");
  }
  assert.deepEqual(packet.terms, pinnedTerms, "Review terms differ from the proposed engine");
  assert.ok(Array.isArray(packet.rows) && packet.rows.length === stageIds.length, "Expected all 12 ordered review stages");
  for (const [index, row] of packet.rows.entries()) {
    keys(row, "id label dependsOn sender nonce destination predictedAddress valueWei inputHash action status gas checks expectedRuntimeHash");
    assert.equal(row.id, stageIds[index], "Unexpected review order");
    assert.ok(Array.isArray(row.dependsOn) && new Set(row.dependsOn).size === row.dependsOn.length &&
      row.dependsOn.every((id) => stageIds.slice(0, index).includes(id)), "Invalid stage prerequisites");
    assert.ok(text(row.label) && text(row.action) && text(row.status) && Array.isArray(row.checks) &&
      row.checks.length <= 16 && row.checks.every(text), "Invalid display text");
    assert.ok(["sender", "destination", "predictedAddress"].every((name) => optional(row[name], address)) &&
      ["valueWei", "nonce"].every((name) => optional(row[name], decimal)) &&
      ["inputHash", "expectedRuntimeHash"].every((name) => optional(row[name], digest)), "Invalid review identity");
    if (index < 7) {
      assert.equal(row.sender?.toLowerCase(), packet.sender.toLowerCase(), "Unexpected deployment sender");
      assert.equal(row.nonce, (BigInt(packet.pendingNonce) + BigInt(index)).toString(), "Invalid deployment nonce order");
    }
    keys(row.gas, "gasUnits l2GasUnits l1PosterGasUnits estimatedFeeWei provenance");
    assert.ok(["gasUnits", "l2GasUnits", "l1PosterGasUnits", "estimatedFeeWei"].every((name) => optional(row.gas[name], decimal)) &&
      text(row.gas.provenance), "Invalid fee evidence");
  }
  assert.ok(Array.isArray(packet.approvals) && packet.approvals.length <= 12, "Invalid approval sheet");
  for (const approval of packet.approvals) {
    keys(approval, "id label status");
    assert.ok(matches(approval.id, /^[a-z0-9-]{1,60}$/i) && text(approval.label) && approval.status === "UNASSIGNED",
      "Unexpected release approval");
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
  const binding = "RMT PRIVATE PHONE REVIEW v1\n" + url.href + "\n" + expiry;
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding));
  const payload = Buffer.concat([cipher.update(JSON.stringify(packet), "utf8"), cipher.final(), cipher.getAuthTag()]);
  const script = "(" + privateReviewPage.toString() + ")(" + JSON.stringify({
    url: url.href, expiryMs, binding, iv: iv.toString("base64"), payload: payload.toString("base64"),
    runtimeBytes: runtimeBytesForTest?.length ?? 11185,
    runtimeSha256: runtimeBytesForTest
      ? createHash("sha256").update(runtimeBytesForTest).digest("hex")
      : "c921aae598d4413e7e93d9b69cfce4043c59687bd988c31a41d56fd45094be90",
  }) + ");";
  const style = "html{color-scheme:dark}body{margin:0;background:#0a0e0b;color:#eef4ee;font:1rem/1.5 system-ui,sans-serif}main{max-width:40rem;margin:2rem auto;padding:0 1rem}button,input{box-sizing:border-box;max-width:100%;font:inherit;padding:.7rem;border-radius:.45rem}input{width:100%;margin:.35rem 0 .6rem}button{background:#2bdf4b;color:#071009;border:0;font-weight:700}button:disabled{opacity:.55}details{padding:.65rem 0;border-top:1px solid #3a473e}summary{cursor:pointer;font-weight:700}dl{margin:.3rem 0 1rem}dt{font-weight:700;margin-top:.35rem}dd{margin:0;overflow-wrap:anywhere}#status{min-height:3rem}p,li,summary{overflow-wrap:anywhere}";
  const sha = (value) => createHash("sha256").update(value).digest("base64");
  const policy = "default-src 'none'; script-src 'sha256-" + sha(script) + "'; style-src 'sha256-" + sha(style)
    + "'; base-uri 'none'; form-action 'none'";
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">',
    '<meta http-equiv="Content-Security-Policy" content="' + policy + '">',
    '<title>RMT private deployment review</title><style>' + style + '</style></head>',
    '<body><main><h1>RMT private deployment review</h1><p>Robinhood Chain 4663 · BLOCKED_NO_BROADCAST</p>',
    '<p>Unlock this review and verify the selected MetaMask account to view the unsigned sequence. Wallet access is limited to public reads and no result leaves this page.</p>',
    '<div id="unlock-panel"><label for="unlock-key">Review access code</label>',
    '<input id="unlock-key" type="password" maxlength="43" autocomplete="off" autocapitalize="off" spellcheck="false" disabled>',
    '<button id="unlock" disabled>Unlock review</button></div>',
    '<button id="connect" hidden disabled>Connect wallet and check nonce</button>',
    '<p id="status" role="status" aria-live="polite">Checking the review origin.</p>',
    '<section id="review" hidden aria-label="Unsigned deployment sequence"></section>',
    '<p><small>Review copy expires <time datetime="' + expiry + '">' + expiry + '</time>.</small></p>',
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
