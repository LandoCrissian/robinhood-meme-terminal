import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  compileRotationProfile, profile, verifyRotationManifest, webTools,
} from "../rmt-task043/compile-rotation-profile.mjs";
import { deriveDeployment, validateInputs } from "../rmt-task043/deploy-rotation.mjs";

const officialRpc = "https://rpc.mainnet.chain.robinhood.com";
const manifest = JSON.parse(readFileSync(new URL("../rmt-task043/4663-rotation-profile.json", import.meta.url), "utf8"));
const readMethods = new Set([
  "eth_chainId", "eth_getBlockByNumber", "eth_getTransactionCount", "eth_getCode", "eth_getBalance", "eth_gasPrice",
  "eth_estimateGas",
]);
const maxNonce = (1n << 64n) - 10n;
const hexQuantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;
const hash = /^0x[0-9a-f]{64}$/i;
const bytecode = /^0x(?:[0-9a-f]{2})*$/i;
const hex = (n) => "0x" + n.toString(16);
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const readText = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

const fixtureAddresses = new Set();
for (const artifact of ["4663-rotation-treasury-matrix.json", "4663-rotation-safe-claims.json"]) {
  const fixture = JSON.parse(readText(new URL("../rmt-task043/" + artifact, import.meta.url)));
  const { deployment, cases } = fixture;
  const bootstrap = deployment.deployment;
  const roles = [bootstrap.operator, bootstrap.operatingRecipient, bootstrap.futureReserveRecipient, ...deployment.governanceSigners];
  for (const testCase of cases) {
    const rotation = testCase.curve.migrations.find((migration) => migration.rotation)?.rotation.rotation;
    roles.push(testCase.creator, ...testCase.recipients, rotation?.incomingSigner,
      ...testCase.swaps.map(({ buy }) => buy.trader), ...(testCase.treasurySetup?.ownerAddresses ?? []));
  }
  for (const address of roles) if (address) fixtureAddresses.add(address.toLowerCase());
}

function quantity(value, label) {
  assert.ok(typeof value === "string" && hexQuantity.test(value), "Malformed " + label);
  return BigInt(value);
}

function blockIdentity(value) {
  assert.ok(value && hash.test(value.hash) && hash.test(value.stateRoot), "Malformed canonical block identity");
  assert.ok(BigInt(value.hash) !== 0n && BigInt(value.stateRoot) !== 0n, "Empty canonical block identity");
  const timestamp = quantity(value.timestamp, "block timestamp");
  assert.ok(timestamp > 0n && timestamp <= 8_640_000_000_000n, "Invalid block timestamp");
  const gasLimit = quantity(value.gasLimit, "block gas limit");
  assert.ok(gasLimit > 0n, "Invalid block gas limit");
  return {
    number: quantity(value.number, "block number").toString(),
    hash: value.hash.toLowerCase(),
    stateRoot: value.stateRoot.toLowerCase(),
    timestamp: new Date(Number(timestamp) * 1000).toISOString(),
    gasLimit: gasLimit.toString(),
    baseFeeWeiPerGas: quantity(value.baseFeePerGas, "block base fee").toString(),
  };
}

async function boundedJson(response) {
  assert.ok(response.ok, "Official RPC HTTP " + response.status);
  assert.ok(response.body, "Official RPC response body is unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 192 * 1024) {
      await reader.cancel();
      throw new Error("Official RPC response exceeded the size limit");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Malformed official RPC response JSON");
  }
}

function makeOfficialReader() {
  let requestId = 0;
  return async (method, params) => {
    assert.ok(readMethods.has(method), "RPC method outside the read-only allowlist");
    const id = ++requestId;
    const response = await fetch(officialRpc, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const body = await boundedJson(response);
    assert.ok(body?.id === id && body.jsonrpc === "2.0", "Malformed official RPC envelope");
    if (body.error) throw new Error("Official RPC " + method + " rejected request (" + (body.error.code ?? "unknown") + ")");
    assert.ok(Object.hasOwn(body, "result"), "Official RPC result is unavailable");
    return body.result;
  };
}

function assertApprovedInput(input, viem, needsBoundNonce) {
  const missing = validateInputs(input, viem.getAddress);
  const unresolved = needsBoundNonce ? missing : missing.filter((key) => key !== "confirmedDeployerNonce");
  assert.ok(unresolved.length === 0, "Missing owner inputs: " + unresolved.join(", "));
  assert.ok(typeof input.ownerApprovalReference === "string", "Missing explicit owner approval reference");
  for (const address of [input.deployer, input.operatingTreasury, input.futureReserve, ...input.governanceSigners]) {
    assert.ok(!fixtureAddresses.has(address.toLowerCase()), "Known rehearsal account cannot serve as an owner role");
  }
}

async function readCode(read, address, block) {
  const code = await read("eth_getCode", [address, block]);
  assert.ok(typeof code === "string" && bytecode.test(code), "Malformed runtime at " + address);
  return code;
}

export async function observePreflight({ read, input, viem, deployment, firstCreate, planSha256Lf }) {
  assertApprovedInput(input, viem, Boolean(deployment));
  assert.equal(quantity(await read("eth_chainId", []), "chain ID"), 4663n, "Unexpected chain ID");
  const block = blockIdentity(await read("eth_getBlockByNumber", ["latest", false]));
  const height = hex(BigInt(block.number));
  const nonce = async (address, blockTag) =>
    quantity(await read("eth_getTransactionCount", [address, blockTag]), "account nonce");
  const [latest, pending, anchored] = await Promise.all([
    nonce(input.deployer, "latest"), nonce(input.deployer, "pending"), nonce(input.deployer, height),
  ]);
  assert.equal(pending, latest, "Pending deployer nonce differs from latest");
  assert.equal(anchored, latest, "Anchored deployer nonce differs from latest");
  assert.ok(latest <= maxNonce, "Deployer nonce leaves fewer than nine sequential slots");
  if (input.confirmedDeployerNonce !== null) {
    assert.equal(latest.toString(), input.confirmedDeployerNonce, "Deployer nonce has changed since unsigned binding");
  }

  const roles = [
    ["deployer", input.deployer], ["operatingTreasury", input.operatingTreasury], ["futureReserve", input.futureReserve],
    ...input.governanceSigners.map((address, i) => ["governanceSigner" + (i + 1), address]),
  ];
  const roleObservations = [];
  for (const [role, address] of roles) {
    const code = await readCode(read, address, height);
    const requiresEoa = role === "deployer" || role.startsWith("governanceSigner");
    if (requiresEoa) assert.ok(code === "0x" && BigInt(address) > 0xffffn, role + " must be an admitted code-empty EOA");
    roleObservations.push({ role, address, accountCode: code === "0x" ? "empty" : "present",
      runtimeHash: viem.keccak256(code), ownerControl: "unverified",
      ...(!requiresEoa && { receiveAndClaim: "requires input-specific wallet and fork evidence" }) });
  }
  const dependencyPins = [];
  for (const [name, { address, runtimeHash }] of Object.entries(manifest.externalRuntimePins)) {
    const code = await readCode(read, address, height);
    assert.ok(code !== "0x" && same(viem.keccak256(code), runtimeHash), name + " runtime pin changed");
    dependencyPins.push({ name, address, runtimeHash });
  }

  const vacantCreationTargets = [];
  for (const [name, address] of Object.entries(deployment?.prediction ?? {})) {
    const [code, accountNonce] = await Promise.all([readCode(read, address, height), nonce(address, height)]);
    assert.ok(code === "0x" && accountNonce === 0n, name + " CREATE/CREATE2 destination is occupied");
    vacantCreationTargets.push({ name, address, anchoredNonce: "0", accountCode: "empty" });
  }
  const [feeResponse, balanceResponse] = await Promise.all([
    read("eth_gasPrice", []), read("eth_getBalance", [input.deployer, height]),
  ]);
  const gasPrice = quantity(feeResponse, "gas price");
  assert.ok(gasPrice > 0n, "Official RPC gas price is zero");
  const balance = quantity(balanceResponse, "deployer balance");
  let firstCreateEstimate = null;
  if (firstCreate) {
    try {
      const gas = quantity(await read("eth_estimateGas", [firstCreate, height]), "first CREATE estimate");
      assert.ok(gas > 0n, "First CREATE estimate is zero");
      const cost = gas * gasPrice;
      firstCreateEstimate = { status: "observed", estimatedGas: gas.toString(), gasPriceWei: gasPrice.toString(),
        illustratedCostWei: cost.toString(), illustratedCostEth: viem.formatEther(cost) };
    } catch (error) {
      firstCreateEstimate = { status: "unavailable", reason: error.message };
    }
  }
  const [recheckedBlock, recheckedLatest, recheckedPending] = await Promise.all([
    read("eth_getBlockByNumber", [height, false]), nonce(input.deployer, "latest"), nonce(input.deployer, "pending"),
  ]);
  assert.deepEqual(blockIdentity(recheckedBlock), block, "Canonical observation block changed");
  assert.equal(recheckedLatest, latest, "Latest deployer nonce changed during observation");
  assert.equal(recheckedPending, latest, "Pending deployer nonce changed during observation");

  return {
    profile, chainId: 4663, state: "BLOCKED_NO_BROADCAST", broadcastAuthorized: false,
    ownerApproval: "operator-supplied reference; verify separately", planSha256Lf: planSha256Lf ?? null,
    deploymentInput: { ...input, confirmedDeployerNonce: latest.toString() },
    observation: {
      observedAt: new Date().toISOString(), block,
      nonce: { latest: latest.toString(), pending: pending.toString(), anchored: anchored.toString(),
        recheckedLatest: recheckedLatest.toString(), recheckedPending: recheckedPending.toString() },
      roles: roleObservations, dependencyPins, vacantCreationTargets,
      fees: { gasPriceWeiPerGas: gasPrice.toString(), deployerBalanceWei: balance.toString(), firstCreateEstimate,
        sequentialEstimate: "requires exact owner-input fork rehearsal and separate L1 data-cost evidence" },
    },
    executionBoundary: [
      "Reserve this deployer to one operator and workflow through both governance notice windows.",
      "Recheck latest and pending nonces against the exact planned next nonce before every separately approved submission.",
      "Abort on nonce drift, overlap, a changed pin, missing receipts, or unverified production authority. This read cannot reserve a nonce.",
    ],
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    checkout: { type: "string" }, inputs: { type: "string" }, plan: { type: "string" }, solc: { type: "string" },
  } });
  assert.ok(values.checkout && ((values.inputs && !values.plan && !values.solc) || (!values.inputs && values.plan && values.solc)),
    "Use --checkout <pinned> with --inputs <approved machine inputs> or --plan <unsigned plan> --solc <pinned compiler>");
  const viem = webTools(values.checkout);
  let input;
  let deployment;
  let firstCreate;
  let planSha256Lf;
  const { verifiedRelease } = await import("./verify-release.mjs");
  const release = await verifiedRelease();
  if (values.plan) {
    const planText = readText(values.plan);
    const plan = JSON.parse(planText);
    assert.ok(plan.profile === profile && plan.chainId === 4663 && plan.state === "BLOCKED_NO_BROADCAST" &&
      plan.broadcastAuthorized === false && Array.isArray(plan.missingInputs) && plan.missingInputs.length === 0,
    "Expected the exact blocked unsigned 4663 plan");
    assert.equal(plan.releaseManifestSha256Lf, release.releaseManifestSha256Lf, "Unsigned plan release manifest mismatch");
    assert.deepEqual(plan.releaseGate, release.releaseGate, "Unsigned plan release gate mismatch");
    input = plan.suppliedInputs;
    assertApprovedInput(input, viem, true);
    verifyRotationManifest(plan.manifest);
    const compilation = await compileRotationProfile({ checkout: resolve(values.checkout), solc: resolve(values.solc) });
    verifyRotationManifest(compilation.manifest);
    deployment = deriveDeployment(input, compilation, viem);
    assert.deepEqual(deployment, plan.derivedDeployment, "Unsigned deployment fields differ from exact derivation");
    const first = deployment.sequence[0];
    const data = compilation.artifacts[first.contract].bytecode + first.constructorData.slice(2);
    assert.ok(same(viem.keccak256(data), first.initcodeHash), "First CREATE calldata hash mismatch");
    firstCreate = { from: input.deployer, nonce: hex(BigInt(first.nonce)), data, value: "0x0" };
    planSha256Lf = sha256(planText);
  } else {
    input = JSON.parse(readText(values.inputs));
  }
  const result = await observePreflight({ read: makeOfficialReader(), input, viem, deployment, firstCreate, planSha256Lf });
  console.log(JSON.stringify({ ...result, candidateCommit: release.candidateCommit,
    releaseManifestSha256Lf: release.releaseManifestSha256Lf, releaseGate: release.releaseGate,
    observation: { source: officialRpc, ...result.observation } }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
