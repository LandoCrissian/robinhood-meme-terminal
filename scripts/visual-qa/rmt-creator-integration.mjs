import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createSocket } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, devices } from "playwright";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../apps/indexer/package.json", import.meta.url));
const { decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, parseAbi, toHex } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const { Pool } = require("pg");
const { values: args } = parseArgs({ options: {
  candidate: { type: "string" }, anvil: { type: "string" }, solc: { type: "string" },
  "pg-bin": { type: "string" }, output: { type: "string" },
} });
for (const option of ["candidate", "anvil", "solc", "pg-bin", "output"]) assert.ok(args[option], `Supply --${option}`);
const fixtureSource = resolve(args.candidate);
const out = resolve(args.output);
const anvil = resolve(args.anvil);
const solc = resolve(args.solc);
const pgBin = resolve(args["pg-bin"]);
// Build the new app and fixture worker before opening any local ports.
for (const item of ["apps/launch-website/.next/BUILD_ID", "apps/indexer/dist/curve-fixture-worker.js"]) {
  await readFile(join(repository, item)).catch(() => {
    throw new Error(`Missing ${item}. Run pnpm --filter @rmt/launch-website build and pnpm --filter indexer build.`);
  });
}

const candidateCommit = "8dca5773cbd4dc98f52a45616f420bce96b000f0";
const solidityTree = "e98de2eaedcf9d233bac0860094e7179db2ab562";
const compilerSha = {
  "darwin-x64": "0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
  "linux-x64": "d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
  "win32-x64": "537fd8d8d4a0433a971bf456fc06f7b021cdcee27b252f74da49e0d8559aeb67",
}[`${process.platform}-${process.arch}`];
const compilerInput = "992dc7cf86dbd3a6d2cc305422a6f667a2f2624538259145505c2e9703cbbc9f";
const git = (...params) => execFileSync("git", params, { cwd: fixtureSource, encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), candidateCommit);
assert.equal(git("rev-parse", "HEAD:packages/contracts/src"), solidityTree);
assert.equal(git("status", "--porcelain", "--untracked-files=no"), "", "Pinned candidate must be clean");
assert.equal(createHash("sha256").update(await readFile(solc)).digest("hex"), compilerSha);
const anchor = JSON.parse(await readFile(join(fixtureSource, "packages/contracts/test/fixtures/rmt-v4-deployment-identities.json"), "utf8")).baseSepolia;
assert.equal(anchor.rpcUrl, "https://sepolia.base.org");
assert.equal(anchor.chainId, 84532);
assert.equal(anchor.block, 57648300);
assert.equal(anchor.blockHash, "0x5bb29976ce80ddede79f192c61eba8fe9d96f499f8bfa11e0820d11820e91d20");
await mkdir(out);

const feeWei = 400_000_000_000_000n;
const backingWei = 2_000_000_000_000_000_000n;
const creator = privateKeyToAccount(generatePrivateKey());
const alternate = privateKeyToAccount(generatePrivateKey()).address;
const treasury = privateKeyToAccount(generatePrivateKey()).address;
const project = { name: "Fixture Creator 036", symbol: "FRESH036", projectURI: "https://example.test/rmt036",
  supplyPreset: 1, treasury, treasuryShareBps: 1250, supplyWei: (10_000_000n * 10n ** 18n).toString() };
const draftOnly = { description: "Private fixture draft description 036", artwork: "https://example.test/local-only-art.png" };
const factoryAbi = parseAbi([
  "function create(string,string,string,uint8,address,uint16,bytes32,uint256) payable returns (address,address)",
  "function tokenForIntent(address,bytes32) view returns (address)",
  "function originCurveForToken(address) view returns (address)",
  "function operatingRecipient() view returns (address)",
  "function creationFeeWei() view returns (uint256)",
  "function creationFeesAccrued() view returns (uint256)",
]);
const curveAbi = parseAbi([
  "function backingReserve() view returns (uint256)", "function sold() view returns (uint256)",
  "function creator() view returns (address)", "function treasury() view returns (address)",
  "function treasuryShareBps() view returns (uint16)", "function GRADUATION_BACKING() view returns (uint256)",
]);
const ports = new Set();
async function unusedPort() {
  for (;;) {
    const listener = createSocket();
    await new Promise((done, fail) => { listener.once("error", fail); listener.listen(0, "127.0.0.1", done); });
    const { port } = listener.address();
    await new Promise((done) => listener.close(done));
    if (!ports.has(port)) { ports.add(port); return port; }
  }
}
const loopback = (port) => `http://127.0.0.1:${port}`;
const rpcUrl = loopback(await unusedPort());
const site = loopback(await unusedPort());
const workerOrigin = loopback(await unusedPort());
const pgPort = await unusedPort();
const cluster = join(out, "postgres");
const pgUser = "rmt_fixture_operator";
const pgPass = randomBytes(24).toString("hex");
const database = `rmt_curve_fixture_${randomBytes(5).toString("hex")}`;
const databaseUrl = `postgresql://${pgUser}:${pgPass}@127.0.0.1:${pgPort}/${database}`;
const pg = new Pool({ connectionString: databaseUrl });
const pgExecutable = (command) => join(pgBin, command + (process.platform === "win32" ? ".exe" : ""));
const processes = [];

// Child processes get the minimum runtime environment plus explicit fixture values.
const childBase = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(?:path|pathext|systemroot|systemdrive|windir|temp|tmp|localappdata|appdata|userprofile|username|homedrive|homepath|comspec|programfiles(?:\(x86\))?|programdata|number_of_processors|os|home|lang)$/i.test(key)));
childBase.NEXT_TELEMETRY_DISABLED = "1";
function start(executable, params, name, { cwd = repository, env = childBase, discard = false } = {}) {
  const child = spawn(executable, params, { cwd, env, windowsHide: true, stdio: ["ignore", discard ? "ignore" : "pipe", discard ? "ignore" : "pipe"] });
  let stdout = "", stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += chunk; });
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((complete) => {
    child.once("error", (error) => complete({ code: -1, stdout, stderr: error.message }));
    child.once("close", (code) => complete({ code, stdout, stderr }));
  }).then(async (result) => {
    if (!discard) await writeFile(join(out, `${name}.log`), (result.stdout + result.stderr).replaceAll(pgPass, "[redacted]"));
    return result;
  });
  const job = { child, done, name };
  processes.push(job);
  return job;
}
async function successful(job) {
  const { code, stdout } = await job.done;
  assert.equal(code, 0, `${job.name} failed. See fixture output for diagnostics.`);
  return stdout;
}
async function stop(job) {
  if (job.child.exitCode === null && !job.child.signalCode) job.child.kill();
  await job.done;
}
async function waitFor(description, probe, job) {
  const until = Date.now() + 55_000;
  while (Date.now() < until) {
    if (job && (job.child.exitCode !== null || job.child.signalCode)) throw new Error(`${job.name} exited before ${description}`);
    try {
      const value = await probe();
      if (value) return value;
    } catch { /* Temporary RPC/API failures are part of the test. */ }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const body = await response.json();
  assert.ok(response.ok && !body.error, `${method} failed on the isolated chain`);
  return body.result;
}
const fetchAt = (base, path, options) => fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000), ...options });
const eq = (actual, expected) => assert.equal(actual.toLowerCase(), expected.toLowerCase());

let hideReceipt;
let missingReceiptReads = 0;
let omitCreationLogs = false;
let omittedCreationReads = 0;
let interruptLogScan = false;
let interruptedLogReads = 0;
const readProxyMethods = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode",
  "eth_getLogs", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBalance", "eth_call", "eth_estimateGas", "web3_clientVersion",
  "debug_traceTransaction"]);
const proxy = createServer(async (request, response) => {
  const write = (result, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
  };
  try {
    assert.equal(request.method, "POST");
    const raw = await Array.fromAsync(request);
    assert.ok(raw.reduce((bytes, chunk) => bytes + chunk.length, 0) <= 64 * 1024);
    const incoming = JSON.parse(Buffer.concat(raw).toString("utf8"));
    const route = async ({ id, method, params = [] }) => {
      if (!readProxyMethods.has(method)) return { id, jsonrpc: "2.0", error: { code: -32601, message: "Fixture RPC allows read methods only" } };
      if (method === "eth_getLogs" && interruptLogScan) {
        interruptedLogReads++;
        return { id, jsonrpc: "2.0", error: { code: -32000, message: "Fixture paused the log scan" } };
      }
      if (method === "eth_getLogs" && omitCreationLogs) {
        omittedCreationReads++;
        return { id, jsonrpc: "2.0", result: [] };
      }
      if (method === "eth_getTransactionReceipt" && params[0]?.toLowerCase() === hideReceipt?.toLowerCase()) {
        missingReceiptReads++;
        return { id, jsonrpc: "2.0", result: null };
      }
      try { return { id, jsonrpc: "2.0", result: await rpc(method, params) }; }
      catch { return { id, jsonrpc: "2.0", error: { code: -32000, message: "Isolated upstream read failed" } }; }
    };
    write(Array.isArray(incoming) ? await Promise.all(incoming.map(route)) : await route(incoming));
  } catch { write({ error: "Invalid fixture RPC request" }, 400); }
});
await new Promise((done, fail) => { proxy.once("error", fail); proxy.listen(0, "127.0.0.1", done); });
const rpcProxy = loopback(proxy.address().port) + "/";

let pgStarted = false;
let browser;
const evidence = { candidateCommit, solidityTree, compilerSha, compilerInput,
  anchor: { block: anchor.block, blockHash: anchor.blockHash }, chainId: 31337, project };
try {
  const chain = start(anvil, ["--host", "127.0.0.1", "--port", new URL(rpcUrl).port, "--chain-id", "31337",
    "--fork-url", anchor.rpcUrl, "--fork-block-number", String(anchor.block), "--silent"], "anvil", { discard: true });
  await waitFor("Anvil chain 31337", async () => (await rpc("eth_chainId")) === "0x7a69", chain);
  assert.match(await rpc("web3_clientVersion"), /^anvil\//i);
  eq((await rpc("eth_getBlockByNumber", [toHex(anchor.block), false])).hash, anchor.blockHash);
  const [operator] = await rpc("eth_accounts");
  const deployed = JSON.parse(await successful(start(process.execPath, ["packages/contracts/scripts/validate-curve-graduation-4663.mjs",
    "--rpc", rpcUrl, "--solc", solc, "--backing-wei", backingWei.toString(), "--operator", operator], "deploy-contract-fixture", { cwd: fixtureSource })));
  assert.equal(deployed.chainId, 31337);
  assert.equal(deployed.creationFeeWei, feeWei.toString());
  assert.equal(deployed.terms.backingWei, backingWei.toString());
  assert.equal(deployed.manifest.inputSha256, compilerInput);
  const deployBlock = await rpc("eth_getBlockByNumber", [toHex(BigInt(deployed.deployBlock)), false]);
  eq(deployBlock.hash, deployed.deployment.blockHash);
  const call = async (to, abi, functionName, args = [], block = "latest") => rpc("eth_call", [{ to,
    data: encodeFunctionData({ abi, functionName, args }) }, block]);
  const contractAddress = (word) => `0x${word.slice(-40)}`;
  const recipient = contractAddress(await call(deployed.factory, factoryAbi, "operatingRecipient"));
  eq(recipient, deployed.deployment.operatingRecipient);
  eq(keccak256(await rpc("eth_getCode", [deployed.factory, "latest"])), deployed.factoryRuntimeHash);
  eq(keccak256(await rpc("eth_getCode", [deployed.projectRegistry, "latest"])), deployed.registryRuntimeHash);
  const manifestPath = join(out, "candidate-deployment.json");
  const binding = { ...deployed, deploymentBlockHash: deployBlock.hash, creationFeeRecipient: recipient };
  await writeFile(manifestPath, JSON.stringify(binding, null, 2));
  evidence.deployment = { factory: binding.factory, projectRegistry: binding.projectRegistry, factoryRuntimeHash: binding.factoryRuntimeHash,
    registryRuntimeHash: binding.registryRuntimeHash, blockNumber: binding.deployBlock, blockHash: deployBlock.hash, feeRecipient: recipient };

  const pgPasswordFile = join(out, "postgres-password");
  await writeFile(pgPasswordFile, pgPass, { mode: 0o600 });
  try { await successful(start(pgExecutable("initdb"), ["-D", cluster, "-U", pgUser, "-A", "scram-sha-256", "--pwfile", pgPasswordFile, "--no-locale"], "postgres-init")); }
  finally { await unlink(pgPasswordFile); }
  await successful(start(pgExecutable("pg_ctl"), ["-D", cluster, "-l", join(out, "postgres.log"), "-o",
    `-h 127.0.0.1 -p ${pgPort}`, "-w", "start"], "postgres-start", { discard: true }));
  pgStarted = true;
  await successful(start(pgExecutable("createdb"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", pgUser, database], "postgres-createdb",
    { env: { ...childBase, PGPASSWORD: pgPass } }));
  await pg.query(`CREATE TABLE rmt_curve_fixture_marker (identity text PRIMARY KEY CHECK (identity = 'task036-local-only'));
    INSERT INTO rmt_curve_fixture_marker VALUES ('task036-local-only');`);

  const env = { ...childBase, RMT_CURVE_FIXTURE: "task036-local-only", RMT_CURVE_FIXTURE_RPC: rpcProxy,
    RMT_CURVE_FIXTURE_DEPLOYMENT: manifestPath, RMT_CURVE_FIXTURE_SITE_ORIGIN: site, RMT_CURVE_FIXTURE_INDEXER: workerOrigin + "/" };
  const workerEnv = { ...env, RMT_CURVE_FIXTURE_DATABASE: databaseUrl, RMT_CURVE_FIXTURE_PORT: new URL(workerOrigin).port };
  const webArgs = ["apps/launch-website/node_modules/next/dist/bin/next", "start", "apps/launch-website", "--hostname", "127.0.0.1", "--port", new URL(site).port];
  const startWeb = (name, config = env) => start(process.execPath, webArgs, name, { env: config });
  const webReady = (web) => waitFor("Next.js site", async () => (await fetchAt(site, "/create-token")).ok, web);
  const startWorker = (name, config = workerEnv) => start(process.execPath, ["apps/indexer/dist/curve-fixture-worker.js"], name, { env: config });
  const workerReady = (worker) => waitFor("durable indexer", async () => (await fetchAt(workerOrigin, "/ready")).ok, worker);

  const wrongManifest = join(out, "invalid-deployment.json");
  const unrelated = "0x" + "bd".repeat(32);
  await writeFile(wrongManifest, JSON.stringify({ ...binding, registryRuntimeHash: unrelated }));
  const badWorker = startWorker("worker-wrong-binding", { ...workerEnv, RMT_CURVE_FIXTURE_DEPLOYMENT: wrongManifest });
  assert.notEqual((await badWorker.done).code, 0, "A wrong registry runtime hash cannot start the worker");
  const catalog = (await pg.query("SELECT to_regclass('rmt_curve_fixture_launches') AS launches")).rows[0];
  assert.equal(catalog.launches, null, "A wrong binding must fail before writing the index schema");

  let web = startWeb("website-invalid-binding", { ...env, RMT_CURVE_FIXTURE_DEPLOYMENT: wrongManifest });
  await webReady(web);
  const { supplyWei: _supply, ...reviewFields } = project;
  const prepareBody = (fields, account = creator.address) => ({ action: "prepare", account,
    intentId: `0x${randomBytes(32).toString("hex")}`, fields });
  const post = (body) => fetchAt(site, "/api/launchpad/test-creation", { method: "POST",
    headers: { Origin: site, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const badReview = await post(prepareBody({ ...reviewFields, treasury: treasury.toLowerCase() }));
  assert.equal((await badReview.json()).status, "unavailable", "A wrong binding cannot provide a signable request");
  await stop(web);
  web = startWeb("website-fixture");
  await webReady(web);

  // Bring the fork clock forward only on this locally spawned Anvil, before review deadlines are issued.
  const head = await rpc("eth_getBlockByNumber", ["latest", false]);
  const now = Math.floor(Date.now() / 1000);
  if (BigInt(head.timestamp) < BigInt(now)) { await rpc("evm_setNextBlockTimestamp", [now]); await rpc("evm_mine"); }
  await rpc("anvil_setBalance", [creator.address, toHex(10n ** 18n)]);
  const ownTreasury = await post(prepareBody({ ...reviewFields, treasury: creator.address.toLowerCase() }));
  assert.equal(ownTreasury.status, 422, "The creator cannot also be the project treasury");
  const unfunded = await post(prepareBody({ ...reviewFields, treasury: treasury.toLowerCase() }, alternate));
  assert.notEqual((await unfunded.json()).status, "prepared", "The fixture cannot simulate a creation without its fee");
  const snapshot = await rpc("evm_snapshot");
  const beforeSnapshot = await rpc("eth_getBlockByNumber", ["latest", false]);
  const countBefore = BigInt(await rpc("eth_getTransactionCount", [creator.address, "latest"]));
  browser = await chromium.launch();
  const context = await browser.newContext(devices["iPhone 13"]);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const signatures = [];
  const pageErrors = [];
  const offOrigin = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== site) { offOrigin.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.exposeFunction("localCreationWallet", async (method, params = []) => {
    if (method === "eth_getBlockByNumber") return rpc(method, params);
    assert.equal(method, "eth_sendTransaction");
    assert.equal(params.length, 1);
    const [request] = params;
    eq(request.from, creator.address);
    eq(request.to, binding.factory);
    assert.equal(request.chainId, "0x7a69");
    assert.equal(BigInt(request.value), feeWei);
    assert.equal(await rpc("eth_chainId"), "0x7a69");
    const decoded = decodeFunctionData({ abi: factoryAbi, data: request.data });
    assert.equal(decoded.functionName, "create");
    const [name, symbol, projectURI, preset, toTreasury, share, intentId, deadline] = decoded.args;
    assert.deepEqual({ name, symbol, projectURI, preset, share }, { name: project.name, symbol: project.symbol, projectURI: project.projectURI,
      preset: project.supplyPreset, share: project.treasuryShareBps });
    eq(toTreasury, treasury);
    assert.match(intentId, /^0x[0-9a-f]{64}$/i);
    const gas = BigInt(await rpc("eth_estimateGas", [{ from: request.from, to: request.to, data: request.data, value: request.value }]));
    const signed = await creator.signTransaction({ chainId: 31337, to: request.to, data: request.data, value: feeWei,
      nonce: Number(BigInt(await rpc("eth_getTransactionCount", [creator.address, "pending"]))), gas: gas * 125n / 100n,
      gasPrice: BigInt(await rpc("eth_gasPrice")), type: "legacy" });
    const hash = await rpc("eth_sendRawTransaction", [signed]);
    signatures.push({ ...request, transactionHash: hash, intentId, deadline: deadline.toString() });
    hideReceipt = hash;
    return hash;
  });
  await page.addInitScript(({ account, substitute }) => {
    let connected = account, chain = "0x7a69";
    let decision = "normal";
    const listeners = new Map();
    window.fixtureWallet = {
      setDecision: (next) => { decision = next; },
      setAccount: (changed) => { connected = changed ? substitute : account; listeners.get("accountsChanged")?.([connected]); },
      setChain: (changed) => { chain = changed ? "0x1" : "0x7a69"; listeners.get("chainChanged")?.(chain); },
    };
    window.ethereum = {
      on: (name, listener) => listeners.set(name, listener),
      removeListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
      request: async ({ method, params }) => {
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [connected];
        if (method === "eth_chainId") return chain;
        if (method === "eth_sendTransaction" && decision === "reject") throw Object.assign(new Error("Synthetic wallet declined"), { code: 4001 });
        const result = await window.localCreationWallet(method, params);
        return method === "eth_sendTransaction" && decision === "lose" ? undefined : result;
      },
    };
  }, { account: creator.address, substitute: alternate });

  const button = (name) => page.getByRole("button", { name, exact: true });
  const capture = (name) => page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  await page.goto(site + "/create-token");
  await page.getByLabel("Token name", { exact: true }).fill(project.name);
  await page.getByLabel("Ticker", { exact: true }).fill(project.symbol.toLowerCase());
  await page.getByLabel("Fixed supply", { exact: true }).selectOption(String(project.supplyPreset));
  await page.getByLabel("Project description", { exact: true }).fill(draftOnly.description);
  await page.getByLabel("Project or metadata URL", { exact: true }).fill(project.projectURI);
  await page.getByLabel("Artwork URL", { exact: true }).fill(draftOnly.artwork);
  await page.getByText("Optional project treasury", { exact: true }).click();
  await page.getByLabel("Treasury address", { exact: true }).fill(treasury);
  await page.getByLabel("Treasury share of collected fees (%)", { exact: true }).fill("12.50");
  await button("Review draft").click();
  await page.getByRole("heading", { name: "Review token draft", exact: true }).waitFor();
  await button("Connect test wallet").click();
  await button("Review test creation").click();
  await button("Confirm test creation").waitFor();
  await page.evaluate(() => window.fixtureWallet.setAccount(true));
  await button("Connect test wallet").waitFor();
  assert.equal(await button("Confirm test creation").count(), 0);
  await page.evaluate(() => window.fixtureWallet.setAccount(false));
  await button("Connect test wallet").click();
  await button("Review test creation").click();
  await button("Confirm test creation").waitFor();
  await page.evaluate(() => window.fixtureWallet.setChain(true));
  await button("Connect test wallet").waitFor();
  assert.equal(await button("Confirm test creation").count(), 0);
  await page.evaluate(() => window.fixtureWallet.setChain(false));
  await button("Connect test wallet").click();
  await button("Review test creation").click();
  await button("Confirm test creation").waitFor();
  await capture("01-final-review");
  await page.evaluate(() => window.fixtureWallet.setDecision("reject"));
  await button("Confirm test creation").click();
  await page.getByText("Request declined in your test wallet.", { exact: true }).waitFor();
  assert.equal(signatures.length, 0);
  assert.equal(BigInt(await rpc("eth_getTransactionCount", [creator.address, "latest"])), countBefore);

  await button("Review test creation").click();
  await page.evaluate(() => window.fixtureWallet.setDecision("lose"));
  await button("Confirm test creation").click();
  await waitFor("one synthetic signed transaction", async () => signatures.length === 1);
  const tx = signatures[0];
  const receipt = await rpc("eth_getTransactionReceipt", [tx.transactionHash]);
  assert.equal(receipt.status, "0x1");
  const persistedTx = await rpc("eth_getTransactionByHash", [tx.transactionHash]);
  eq(persistedTx.input, tx.data);
  eq(persistedTx.from, creator.address);
  eq(persistedTx.to, deployed.factory);
  assert.equal(BigInt(persistedTx.value), feeWei);
  const token = contractAddress(await call(deployed.factory, factoryAbi, "tokenForIntent", [creator.address, tx.intentId], receipt.blockNumber));
  const curve = contractAddress(await call(deployed.factory, factoryAbi, "originCurveForToken", [token], receipt.blockNumber));
  assert.match(token, /^(?!0x0{40}$)0x[0-9a-f]{40}$/i);
  const getCurve = (method) => call(curve, curveAbi, method, [], receipt.blockNumber);
  assert.equal(BigInt(await getCurve("backingReserve")), 0n);
  assert.equal(BigInt(await getCurve("sold")), 0n);
  assert.equal(BigInt(await getCurve("GRADUATION_BACKING")), backingWei);
  eq(contractAddress(await getCurve("creator")), creator.address);
  eq(contractAddress(await getCurve("treasury")), treasury);
  assert.equal(BigInt(await getCurve("treasuryShareBps")), BigInt(project.treasuryShareBps));
  assert.equal(BigInt(await call(token, erc20Abi, "totalSupply", [], receipt.blockNumber)).toString(), project.supplyWei);
  assert.equal(BigInt(await call(token, erc20Abi, "balanceOf", [curve], receipt.blockNumber)).toString(), project.supplyWei);
  assert.equal(BigInt(await call(token, erc20Abi, "balanceOf", [creator.address], receipt.blockNumber)), 0n);
  assert.equal(BigInt(await call(deployed.factory, factoryAbi, "creationFeesAccrued", [], receipt.blockNumber)), feeWei);
  const original = { from: persistedTx.from, to: deployed.factory, data: persistedTx.input, value: persistedTx.value,
    chainId: "0x7a69", intentId: tx.intentId, deadline: tx.deadline, blockNumber: toHex(BigInt(binding.deployBlock)), blockHash: binding.deploymentBlockHash };
  for (const altered of [{ ...original, value: toHex(feeWei - 1n) }, { ...original, to: treasury }]) {
    const refused = await post({ action: "verify", request: altered, transactionHash: tx.transactionHash });
    assert.equal(refused.status, 422, "Recovery must accept only the original reviewed fee and factory");
  }

  await page.getByText("Transaction pending", { exact: true }).first().waitFor();
  await page.reload();
  await button("Check creation transaction").waitFor();
  await button("Check creation transaction").click();
  await waitFor("withheld receipt read during recovery", async () => missingReceiptReads > 0);
  await page.getByText("Evidence unavailable", { exact: true }).waitFor();
  await capture("02-missing-hash-after-refresh");
  hideReceipt = undefined;
  await button("Check creation transaction").click();
  await page.getByText(/On-chain creation confirmed/i).first().waitFor();
  await page.getByText("Indexing pending", { exact: true }).waitFor();
  await capture("03-confirmed-index-pending");
  const path = `/api/launchpad/new-engine/${token}`;
  assert.equal((await fetchAt(site, path)).status, 503, "Absent indexer must not serve unverified absence");
  assert.equal(signatures.length, 1);
  assert.equal(BigInt(await rpc("eth_getTransactionCount", [creator.address, "latest"])), countBefore + 1n);

  await rpc("anvil_mine", ["0x3"]);
  hideReceipt = tx.transactionHash;
  const earlierMissingReads = missingReceiptReads;
  let worker = startWorker("worker-first");
  await waitFor("withheld receipt during index scan", async () => missingReceiptReads > earlierMissingReads, worker);
  assert.equal((await fetchAt(workerOrigin, "/ready")).status, 503);
  assert.equal((await fetchAt(site, path)).status, 503);
  assert.equal((await pg.query("SELECT COUNT(*)::int AS count FROM rmt_curve_fixture_launches")).rows[0].count, 0);
  omitCreationLogs = true;
  hideReceipt = undefined;
  await waitFor("omitted log during index scan", async () => omittedCreationReads > 0, worker);
  assert.equal((await fetchAt(workerOrigin, "/ready")).status, 503);
  assert.equal((await fetchAt(site, path)).status, 503);
  assert.equal((await pg.query("SELECT COUNT(*)::int AS count FROM rmt_curve_fixture_launches")).rows[0].count, 0);
  omitCreationLogs = false;
  await workerReady(worker);
  const getIndexed = async () => {
    const response = await fetchAt(site, path);
    if (!response.ok) return null;
    const indexed = await response.json();
    return indexed.launches?.[0];
  };
  const indexed = await waitFor("verified application detail API", getIndexed);
  eq(indexed.token, token);
  eq(indexed.creator, creator.address);
  eq(indexed.factory, deployed.factory);
  eq(indexed.initialCurve, curve);
  eq(indexed.treasury, treasury);
  assert.equal(indexed.treasuryShareBps, project.treasuryShareBps);
  assert.equal(indexed.name, project.name);
  assert.equal(indexed.symbol, project.symbol);
  assert.equal(indexed.projectURI, project.projectURI);
  assert.equal(indexed.totalSupplyWei, project.supplyWei);
  eq(indexed.creation.transactionHash, tx.transactionHash);
  eq(indexed.creation.blockHash, receipt.blockHash);
  assert.equal(indexed.creationFee.amountWei, feeWei.toString());
  assert.equal(indexed.creationFee.refundWei, "0");
  assert.equal(indexed.chainId, 31337);
  assert.ok(!JSON.stringify(indexed).includes(draftOnly.description) && !JSON.stringify(indexed).includes(draftOnly.artwork));
  const sqlLaunches = () => pg.query(`SELECT chain_id, factory, deployment_block_hash, token, block_number, block_hash,
    transaction_hash, log_index, payload FROM rmt_curve_fixture_launches ORDER BY block_number, log_index`);
  let rows = (await sqlLaunches()).rows;
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(Number(row.chain_id), 31337);
  eq(row.factory, binding.factory);
  eq(row.deployment_block_hash, deployBlock.hash);
  eq(row.token, token);
  eq(row.block_hash, receipt.blockHash);
  eq(row.transaction_hash, tx.transactionHash);
  assert.equal(Number(row.log_index), indexed.creation.logIndex);
  await button("Check creation transaction").click();
  await page.getByText("Indexed and verified", { exact: true }).waitFor();

  await page.goto(`${site}/launches/${token}`);
  await page.getByRole("heading", { name: project.name, exact: true }).waitFor();
  await capture("04-indexed-token");
  await page.goto(site + "/");
  await page.getByRole("region", { name: "New RMT Launch engine" }).getByRole("link", { name: `${project.name} · ${project.symbol}` }).waitFor();
  await capture("05-discovery");

  const conflicting = startWorker("worker-duplicate-writer", { ...workerEnv, RMT_CURVE_FIXTURE_PORT: String(await unusedPort()) });
  assert.notEqual((await conflicting.done).code, 0, "Concurrent writer must fail closed");
  await stop(web);
  await stop(worker);
  web = startWeb("website-restarted");
  await webReady(web);
  assert.equal((await fetchAt(site, path)).status, 503);
  worker = startWorker("worker-restarted");
  await workerReady(worker);
  assert.deepEqual((await waitFor("rediscovery after both processes restart", getIndexed)).creation, indexed.creation);
  rows = (await sqlLaunches()).rows;
  assert.equal(rows.length, 1, "Restart and replay cannot duplicate a registration");
  assert.deepEqual(rows[0], row);
  await page.goto(`${site}/launches/${token}`);
  await page.getByRole("heading", { name: project.name, exact: true }).waitFor();
  await capture("06-rediscovered-after-restart");

  interruptLogScan = true;
  assert.equal(await rpc("evm_revert", [snapshot]), true);
  await rpc("evm_setNextBlockTimestamp", [Number(BigInt(beforeSnapshot.timestamp)) + 19]);
  await rpc("anvil_mine", ["0x6"]);
  assert.equal(await rpc("eth_getTransactionReceipt", [tx.transactionHash]), null);
  await waitFor("reorg rollback of durable registration", async () => (await sqlLaunches()).rows.length === 0, worker);
  await waitFor("paused replacement log scan", async () => interruptedLogReads > 0, worker);
  assert.equal((await fetchAt(site, path)).status, 503);
  interruptLogScan = false;
  await workerReady(worker);
  const reorg = await fetchAt(site, path);
  assert.equal(reorg.status, 404, "Once rebuilt, a reorged registration cannot remain verified");
  const after = await fetchAt(site, "/api/launchpad/new-engine").then((response) => response.json());
  assert.deepEqual(after.launches, []);
  assert.equal(signatures.length, 1, "Reorg must never rebroadcast a creation");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(offOrigin, []);
  Object.assign(evidence, { reviewedTransaction: tx, receipt: { hash: receipt.transactionHash, blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash, status: receipt.status }, indexed, postgresRow: row,
    initial: { backingWei: "0", soldWei: "0", inventoryWei: project.supplyWei, creatorInitialTokensWei: "0" },
    checks: { rejected: true, accountInvalidatedReview: true, chainInvalidatedReview: true, lostHashRefreshRecovered: true, insufficientFeeRejected: true,
      missingReceiptReads, omittedCreationReads, indexingDelay: true, restart: true, reorgRollback: true, interruptedLogReads,
      mutatedRequestRejected: true, wrongBinding: true, duplicateWriterRejected: true, singleSignedTransaction: true } });
  await writeFile(join(out, "creation-journey-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`Creator form → receipt → PostgreSQL → page passed on 31337. ${join(out, "creation-journey-evidence.json")}`);
} finally {
  await browser?.close();
  for (const job of processes.toReversed()) await stop(job);
  await pg.end();
  if (pgStarted) {
    await successful(start(pgExecutable("pg_ctl"), ["-D", cluster, "-w", "-m", "fast", "stop"], "postgres-stop"));
  }
  await new Promise((done) => proxy.close(done));
}
