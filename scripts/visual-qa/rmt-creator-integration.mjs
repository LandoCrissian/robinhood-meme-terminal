import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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
const { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, parseAbi,
  parseAbiParameters, parseEventLogs, toHex } = require("viem");
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
const treasurySigner = privateKeyToAccount(generatePrivateKey());
const treasury = treasurySigner.address;
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
  "function quoteBuy(uint256) view returns (uint256,uint256,uint256,uint256)",
  "function quoteSell(uint256) view returns (uint256,uint256,uint256)",
  "function buy(uint256 minimumTokenOut,uint256 deadline) payable returns (uint256)",
  "function sell(uint256 amountIn,uint256 minimumEthOut,uint256 deadline) returns (uint256)",
  "function graduate(uint256 deadline)",
  "function graduated() view returns (bool)", "function graduationEngine() view returns (address)",
  "event CurveTrade(address indexed account,bool indexed isBuy,uint256 tokenAmount,uint256 grossNative,uint256 fee,uint256 nativeRefund,uint256 sold,uint256 backingReserve)",
]);
const nativeCurrency = "0x0000000000000000000000000000000000000000";
const router = anchor.universalRouter212.address;
const permit2 = anchor.permit2.address;
const routerAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const permitAbi = parseAbi(["function approve(address token,address spender,uint160 amount,uint48 expiration)",
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)"]);
const feesAbi = parseAbi(["function collectLpFees(address token,uint256 deadline) returns (uint256,uint256)",
  "function previewLpFees(address token) view returns (uint256,uint256)", "function lpFeeLedger(address token) view returns (address)",
  "event LpFeesCollected(address indexed token,uint256 indexed positionTokenId,address indexed ledger,uint256 nativeAmount,uint256 tokenAmount)"]);
const ledgerAbi = parseAbi(["function claim() returns (uint256,uint256)", "function claimable(address) view returns (uint256,uint256)",
  "event LpFeesClaimed(address indexed recipient,uint256 nativeAmount,uint256 tokenAmount)"]);
const v4Routes = parseAbiParameters("bytes actions,bytes[] inputs");
const v4Swap = parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData");
const routerSwap = [{ type: "tuple", components: v4Swap }];
const settleV4 = parseAbiParameters("address currency,uint256 amount,bool payerIsUser");
const takeV4 = parseAbiParameters("address currency,uint256 minimum");
const swapAbi = parseAbi(["event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)"]);
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
const indexReadKey = randomBytes(32).toString("hex");
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
    if (!discard) await writeFile(join(out, `${name}.log`), (result.stdout + result.stderr)
      .replaceAll(pgPass, "[redacted]").replaceAll(indexReadKey, "[redacted]"));
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
let hideTradeTrace = false;
let hiddenTradeTraces = 0;
let rpcOutage = false;
const readProxyMethods = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode",
  "eth_getLogs", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_getBalance", "eth_call", "eth_estimateGas", "eth_gasPrice", "web3_clientVersion",
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
      if (rpcOutage) return { id, jsonrpc: "2.0", error: { code: -32000, message: "Fixture RPC is offline" } };
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
      if (method === "debug_traceTransaction" && hideTradeTrace) {
        hiddenTradeTraces++;
        return { id, jsonrpc: "2.0", error: { code: -32000, message: "Fixture paused transaction proof" } };
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
let page;
const evidence = { candidateCommit, solidityTree, compilerSha, compilerInput,
  anchor: { block: anchor.block, blockHash: anchor.blockHash }, chainId: 31337, project };
try {
  const chain = start(anvil, ["--host", "127.0.0.1", "--port", new URL(rpcUrl).port, "--chain-id", "31337",
    "--fork-url", anchor.rpcUrl, "--fork-block-number", String(anchor.block), "--silent"], "anvil", { discard: true });
  await waitFor("Anvil chain 31337", async () => (await rpc("eth_chainId")) === "0x7a69", chain);
  assert.match(await rpc("web3_clientVersion"), /^anvil\//i);
  eq((await rpc("eth_getBlockByNumber", [toHex(anchor.block), false])).hash, anchor.blockHash);
  const [operator, operations, reserve] = await rpc("eth_accounts");
  const deployed = JSON.parse(await successful(start(process.execPath, ["packages/contracts/scripts/validate-curve-graduation-4663.mjs",
    "--rpc", rpcUrl, "--solc", solc, "--backing-wei", backingWei.toString(), "--operator", operator], "deploy-contract-fixture", { cwd: fixtureSource })));
  assert.equal(deployed.chainId, 31337);
  assert.equal(deployed.creationFeeWei, feeWei.toString());
  assert.equal(deployed.terms.backingWei, backingWei.toString());
  assert.equal(deployed.manifest.inputSha256, compilerInput);
  const deployBlock = await rpc("eth_getBlockByNumber", [toHex(BigInt(deployed.deployBlock)), false]);
  eq(deployBlock.hash, deployed.deployment.blockHash);
  const call = async (to, abi, functionName, args = [], block = "latest", overrides = {}) => rpc("eth_call", [{ to,
    data: encodeFunctionData({ abi, functionName, args }), ...overrides }, block]);
  const contractAddress = (word) => `0x${word.slice(-40)}`;
  const recipient = contractAddress(await call(deployed.factory, factoryAbi, "operatingRecipient"));
  eq(recipient, deployed.deployment.operatingRecipient);
  eq(recipient, operations);
  eq(keccak256(await rpc("eth_getCode", [router, "latest"])), anchor.universalRouter212.runtimeHash);
  eq(keccak256(await rpc("eth_getCode", [permit2, "latest"])), anchor.permit2.runtimeHash);
  eq(keccak256(await rpc("eth_getCode", [anchor.quoter.address, "latest"])), anchor.quoter.runtimeHash);
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
  await appendFile(join(cluster, "postgresql.conf"), "\nunix_socket_directories = ''\n");
  await successful(start(pgExecutable("pg_ctl"), ["-D", cluster, "-l", join(out, "postgres.log"), "-o",
    `-h 127.0.0.1 -p ${pgPort}`, "-w", "start"], "postgres-start", { discard: process.platform === "win32" }));
  pgStarted = true;
  await successful(start(pgExecutable("createdb"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", pgUser, database], "postgres-createdb",
    { env: { ...childBase, PGPASSWORD: pgPass } }));
  await pg.query(`CREATE TABLE rmt_curve_fixture_marker (identity text PRIMARY KEY CHECK (identity = 'task036-local-only'));
    INSERT INTO rmt_curve_fixture_marker VALUES ('task036-local-only');`);

  const env = { ...childBase, RMT_CURVE_FIXTURE: "task036-local-only", RMT_CURVE_FIXTURE_RPC: rpcProxy,
    RMT_CURVE_FIXTURE_READ_KEY: indexReadKey,
    RMT_CURVE_FIXTURE_DEPLOYMENT: manifestPath, RMT_CURVE_FIXTURE_SITE_ORIGIN: site, RMT_CURVE_FIXTURE_INDEXER: workerOrigin + "/" };
  const workerEnv = { ...env, RMT_CURVE_FIXTURE_DATABASE: databaseUrl, RMT_CURVE_FIXTURE_PORT: new URL(workerOrigin).port };
  const webArgs = ["apps/launch-website/node_modules/next/dist/bin/next", "start", "apps/launch-website", "--hostname", "127.0.0.1", "--port", new URL(site).port];
  const startWeb = (name, config = env) => start(process.execPath, webArgs, name, { env: config });
  const webReady = (web) => waitFor("Next.js site", async () => (await fetchAt(site, "/create-token")).ok, web);
  const startWorker = (name, config = workerEnv) => start(process.execPath, ["apps/indexer/dist/curve-fixture-worker.js"], name, { env: config });
  const workerReady = (worker) => waitFor("durable indexer", async () => (await fetchAt(workerOrigin, "/ready")).ok, worker);
  const lifePost = (body, origin = site) => fetchAt(site, "/api/launchpad/test-lifecycle", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

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
  await rpc("anvil_setBalance", [creator.address, toHex(20n * 10n ** 18n)]);
  await rpc("anvil_setBalance", [treasury, toHex(10n ** 18n)]);
  const ownTreasury = await post(prepareBody({ ...reviewFields, treasury: creator.address.toLowerCase() }));
  assert.equal(ownTreasury.status, 422, "The creator cannot also be the project treasury");
  const unfunded = await post(prepareBody({ ...reviewFields, treasury: treasury.toLowerCase() }, alternate));
  assert.notEqual((await unfunded.json()).status, "prepared", "The fixture cannot simulate a creation without its fee");
  const snapshot = await rpc("evm_snapshot");
  const beforeSnapshot = await rpc("eth_getBlockByNumber", ["latest", false]);
  const countBefore = BigInt(await rpc("eth_getTransactionCount", [creator.address, "latest"]));
  browser = await chromium.launch();
  const context = await browser.newContext(devices["iPhone 13"]);
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const signatures = [];
  let currentToken;
  let currentCurve;
  let currentGraduation;
  let currentLedger;
  const signerFor = new Map([creator, treasurySigner].map((account) => [account.address.toLowerCase(), account]));
  const protocolAccounts = new Set([operations, reserve].map((account) => account.toLowerCase()));
  const pageErrors = [];
  const offOrigin = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== site) { offOrigin.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.exposeFunction("localCreationWallet", async (method, params = []) => {
    if (method === "eth_getBlockByNumber" || method === "eth_getTransactionCount") return rpc(method, params);
    assert.equal(method, "eth_sendTransaction");
    assert.equal(params.length, 1);
    const [request] = params;
    const from = request.from.toLowerCase();
    const signer = signerFor.get(from);
    assert.ok(signer || protocolAccounts.has(from), "Wallet is a known synthetic account");
    assert.equal(request.chainId, "0x7a69");
    assert.equal(await rpc("eth_chainId"), "0x7a69");
    const transactionValue = BigInt(request.value);
    let decoded;
    let intentId, deadline;
    if (request.to.toLowerCase() === binding.factory.toLowerCase()) {
      decoded = decodeFunctionData({ abi: factoryAbi, data: request.data });
      assert.equal(transactionValue, feeWei);
      eq(request.from, creator.address);
      assert.equal(decoded.functionName, "create");
      const [name, symbol, projectURI, preset, toTreasury, share, intent, expires] = decoded.args;
      assert.deepEqual({ name, symbol, projectURI, preset, share }, { name: project.name, symbol: project.symbol, projectURI: project.projectURI,
        preset: project.supplyPreset, share: project.treasuryShareBps });
      eq(toTreasury, treasury);
      assert.match(intent, /^0x[0-9a-f]{64}$/i);
      intentId = intent;
      deadline = expires;
    } else {
      assert.ok(currentToken && currentCurve);
      if (request.to.toLowerCase() === currentToken.toLowerCase()) {
        decoded = decodeFunctionData({ abi: erc20Abi, data: request.data });
        assert.equal(decoded.functionName, "approve");
        eq(decoded.args[0], currentGraduation ? permit2 : currentCurve);
        assert.equal(transactionValue, 0n);
        if (currentGraduation) decoded.functionName = "v4-token-approve";
      } else if (currentGraduation && request.to.toLowerCase() === permit2.toLowerCase()) {
        decoded = decodeFunctionData({ abi: permitAbi, data: request.data });
        assert.equal(decoded.functionName, "approve");
        eq(decoded.args[0], currentToken);
        eq(decoded.args[1], router);
        assert.equal(transactionValue, 0n);
        decoded.functionName = "v4-permit2-approve";
      } else if (currentGraduation && request.to.toLowerCase() === router.toLowerCase()) {
        decoded = decodeFunctionData({ abi: routerAbi, data: request.data });
        assert.equal(decoded.functionName, "execute");
        const [operations, [nested]] = decoded.args;
        assert.equal(operations, "0x10");
        const [actions, [swap, settle, take]] = decodeAbiParameters(v4Routes, nested);
        assert.equal(actions, "0x060b0f");
        const [terms] = decodeAbiParameters(routerSwap, swap);
        const [payment, spent, payerIsUser] = decodeAbiParameters(settleV4, settle);
        const [receive, minimum] = decodeAbiParameters(takeV4, take);
        for (const part of ["currency0", "currency1", "hooks"]) eq(terms.poolKey[part], currentGraduation.poolKey[part]);
        assert.equal(terms.poolKey.fee, currentGraduation.poolKey.fee);
        assert.equal(terms.poolKey.tickSpacing, currentGraduation.poolKey.tickSpacing);
        eq(payment, terms.zeroForOne ? nativeCurrency : currentToken);
        eq(receive, terms.zeroForOne ? currentToken : nativeCurrency);
        assert.ok(payerIsUser && minimum > 0n);
        assert.equal(spent, terms.amountIn);
        assert.equal(minimum, terms.amountOutMinimum);
        assert.equal(terms.minHopPriceX36, minimum * 10n ** 36n / spent);
        assert.equal(terms.hookData, "0x");
        assert.equal(transactionValue, terms.zeroForOne ? spent : 0n);
        decoded.functionName = terms.zeroForOne ? "v4-buy" : "v4-sell";
      } else if (currentGraduation && request.to.toLowerCase() === currentGraduation.owner.toLowerCase()) {
        decoded = decodeFunctionData({ abi: feesAbi, data: request.data });
        assert.equal(decoded.functionName, "collectLpFees");
        eq(decoded.args[0], currentToken);
        assert.equal(transactionValue, 0n);
        decoded.functionName = "lp-collect";
      } else if (currentLedger && request.to.toLowerCase() === currentLedger.toLowerCase()) {
        decoded = decodeFunctionData({ abi: ledgerAbi, data: request.data });
        assert.equal(decoded.functionName, "claim");
        assert.equal(transactionValue, 0n);
        decoded.functionName = "lp-claim";
      } else {
        eq(request.to, currentCurve);
        decoded = decodeFunctionData({ abi: curveAbi, data: request.data });
        assert.ok(["buy", "sell", "graduate"].includes(decoded.functionName));
        assert.equal(transactionValue > 0n, decoded.functionName === "buy");
      }
    }
    const gas = BigInt(await rpc("eth_estimateGas", [{ from: request.from, to: request.to, data: request.data, value: request.value }]));
    const nonce = BigInt(await rpc("eth_getTransactionCount", [request.from, "pending"]));
    if (request.nonce !== undefined) assert.equal(BigInt(request.nonce), nonce, "Bound account nonce");
    const hash = signer ? await rpc("eth_sendRawTransaction", [await signer.signTransaction({ chainId: 31337, to: request.to,
      data: request.data, value: transactionValue, nonce: Number(nonce), gas: gas * 125n / 100n,
      gasPrice: BigInt(await rpc("eth_gasPrice")), type: "legacy" })])
      : await rpc("eth_sendTransaction", [{ from: request.from, to: request.to, data: request.data, value: request.value,
        nonce: toHex(nonce), gas: toHex(gas * 125n / 100n) }]);
    signatures.push({ ...request, transactionHash: hash, operation: decoded.functionName, intentId, deadline: deadline?.toString() });
    if (decoded.functionName === "create") hideReceipt = hash;
    return hash;
  });
  await page.addInitScript(({ account, substitute }) => {
    let connected = account, chain = "0x7a69";
    let decision = "normal";
    const listeners = new Map();
    const emit = (name, payload) => { for (const listener of listeners.get(name) ?? []) listener(payload); };
    window.fixtureWallet = {
      setDecision: (next) => { decision = next; },
      setAccount: (changed) => { connected = changed ? substitute : account; emit("accountsChanged", [connected]); },
      selectAccount: (next) => { connected = next; emit("accountsChanged", [connected]); },
      setChain: (changed) => { chain = changed ? "0x1" : "0x7a69"; emit("chainChanged", chain); },
    };
    window.ethereum = {
      on: (name, listener) => { const group = listeners.get(name) ?? new Set(); group.add(listener); listeners.set(name, group); },
      removeListener: (name, listener) => listeners.get(name)?.delete(listener),
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
  currentToken = token;
  currentCurve = curve;
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

  await page.getByText("The wallet did not return a hash. Check the original request before continuing.", { exact: true }).waitFor();
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
  for (const key of [undefined, unrelated.slice(2)]) {
    const headers = key ? { "X-RMT-Fixture-Key": key } : {};
    assert.ok([401, 404].includes((await fetchAt(workerOrigin, "/curve-launches/" + token, { headers })).status),
      "Direct worker reads require the fixture session key");
  }
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

  await page.getByRole("link", { name: "Open test token", exact: true }).click();
  await page.getByRole("heading", { name: project.name, exact: true }).waitFor();
  await capture("04-indexed-token");
  await page.goto(site + "/");
  await page.getByRole("region", { name: "New RMT Launch engine" }).getByRole("link", { name: `${project.name} · ${project.symbol}` }).waitFor();
  await capture("05-discovery");

  const testCall = (operation, args, value = 0n) =>
    call(curve, curveAbi, operation, args, "latest", { from: creator.address, value: toHex(value) });
  const uint = (raw, index = 0) => BigInt("0x" + raw.slice(2 + index * 64, 2 + (index + 1) * 64));
  const balance = (owner = creator.address, height = "latest") =>
    call(token, erc20Abi, "balanceOf", [owner], height).then(uint);
  const allowance = () => call(token, erc20Abi, "allowance", [creator.address, curve]).then(uint);
  const state = () => Promise.all(["sold", "backingReserve"].map((fn) => call(curve, curveAbi, fn).then(uint)));
  const mine = () => rpc("anvil_mine", ["0x3"]);
  const lastReceipt = async (operation) => {
    const submission = signatures.at(-1);
    assert.equal(submission.operation, operation);
    const settled = await rpc("eth_getTransactionReceipt", [submission.transactionHash]);
    const block = await rpc("eth_getBlockByNumber", [settled.blockNumber, false]);
    assert.equal(settled.status, "0x1");
    eq(settled.blockHash, block.hash);
    eq(settled.transactionHash, submission.transactionHash);
    return { operation, hash: submission.transactionHash, blockNumber: settled.blockNumber, blockHash: settled.blockHash,
      gasUsed: settled.gasUsed, input: submission.data, value: submission.value, logs: settled.logs };
  };
  const sendThroughPage = async (label, decision = "normal") => {
    const before = signatures.length;
    await page.evaluate((mode) => window.fixtureWallet.setDecision(mode), decision);
    await button(label).click();
    await waitFor(label, async () => signatures.length === before + 1);
  };
  const openToken = async () => {
    await page.goto(`${site}/launches/${token}`);
    await page.getByRole("heading", { name: project.name, exact: true }).waitFor();
  };
  const openTradeWallet = async () => {
    const connect = button("Connect test trading wallet");
    const side = page.getByRole("region", { name: "Isolated test trading" }).getByRole("combobox");
    await connect.or(side).first().waitFor();
    if (await connect.isVisible()) await connect.click();
    await side.waitFor();
  };
  const reviewed = async (side, amount) => {
    await page.getByRole("region", { name: "Isolated test trading" }).getByRole("combobox").selectOption({ label: side });
    await page.getByLabel("Trade amount", { exact: true }).fill(amount);
  };
  const checkSettlement = async (description, continueJourney = true, nextWallet = true) => {
    const labels = { approval: "exact test approval", "v4 token approval": "exact v4 token approval",
      "Permit2 approval": "exact Permit2 approval", "LP fee collection": "test LP fee collection", "LP fee claim": "test LP fee claim" };
    const label = labels[description] ?? `test ${description}`;
    const status = page.getByText(`On-chain ${label} confirmed`, { exact: true });
    const proceed = button("Continue from verified transaction");
    const check = button("Check original transaction");
    let observed = false;
    await waitFor(`${description} confirmation from the original receipt`, async () => {
      if (await status.isVisible()) {
        observed = true;
        if (!continueJourney) return true;
      }
      if (observed && !await check.isVisible()) return true;
      if (await proceed.isVisible() && await proceed.isEnabled()) {
        await proceed.click({ timeout: 1500 });
      } else if (await check.isVisible() && await check.isEnabled()) {
        await check.click({ timeout: 1500 });
      }
      return false;
    });
    if (continueJourney && nextWallet) await openTradeWallet();
  };
  const indexTx = (hash) => waitFor("same canonical PostgreSQL trade", async () => {
    const row = await getIndexed();
    return row?.lifecycle.trades.find((trade) => trade.transactionHash.toLowerCase() === hash.toLowerCase());
  });
  const assertCurveTrade = async (receiptProof, side, beforeTokens, beforeBacking) => {
    const [event] = parseEventLogs({ abi: curveAbi, eventName: "CurveTrade",
      logs: receiptProof.logs.filter((entry) => entry.address.toLowerCase() === curve.toLowerCase()) });
    assert.ok(event);
    const { account, isBuy, tokenAmount, grossNative, fee, nativeRefund: refund, backingReserve, sold } = event.args;
    eq(account, creator.address);
    assert.equal(isBuy, side === "buy");
    assert.ok(tokenAmount > 0n && grossNative > fee && fee > 0n);
    assert.equal(await balance(), isBuy ? beforeTokens + tokenAmount : beforeTokens - tokenAmount);
    assert.deepEqual(await state(), [sold, isBuy ? beforeBacking + grossNative - fee : beforeBacking - grossNative]);
    assert.equal(backingReserve, (await state())[1]);
    if (isBuy) assert.equal(grossNative + refund, BigInt(receiptProof.value));
    else assert.equal(refund, 0n);
    const nativeTrace = await rpc("debug_traceTransaction", [receiptProof.hash, { tracer: "callTracer" }]);
    const transfers = (nativeTrace.calls ?? []).filter((edge) =>
      edge.from.toLowerCase() === curve.toLowerCase() && edge.to.toLowerCase() === creator.address.toLowerCase());
    const expected = isBuy ? refund : grossNative - fee;
    assert.deepEqual(transfers.map((edge) => BigInt(edge.value)), expected > 0n ? [expected] : []);
    const accrued = (nativeTrace.calls ?? []).filter((edge) => edge.to.toLowerCase() === indexed.revenueLedger.toLowerCase());
    assert.deepEqual(accrued.map((edge) => BigInt(edge.value)), [fee]);
    const trade = await indexTx(receiptProof.hash);
    eq(trade.blockHash, receiptProof.blockHash);
    assert.equal(trade.side, side);
    eq(trade.account, creator.address);
    assert.deepEqual([trade.tokenWei, trade.nativeWei, trade.feeWei, trade.nativeRefundWei], [tokenAmount, grossNative, fee, refund].map(String));
    return { receipt: receiptProof, indexed: trade };
  };

  await openToken();
  await page.getByRole("heading", { name: "Verified bonding curve" }).waitFor();
  await openTradeWallet();
  assert.equal((await lifePost({ action: "state", token }, "http://outside.invalid")).status, 403);
  assert.equal((await lifePost({ action: "state", token, account: creator.address })).status, 200);
  const initialState = await state();
  const firstBudget = 200_000_000_000_000_000n;
  const nowOnChain = () => rpc("eth_getBlockByNumber", ["latest", false]).then(({ timestamp }) => BigInt(timestamp));
  const liveDeadline = (await nowOnChain()) + 240n;
  const firstQuote = uint(await call(curve, curveAbi, "quoteBuy", [firstBudget]));
  await assert.rejects(testCall("buy", [1n, 1n], firstBudget), /eth_call failed/, "Expired curve buy must revert");
  await assert.rejects(testCall("buy", [firstQuote + 1n, liveDeadline], firstBudget), /eth_call failed/, "Impossible minimum buy output must revert");
  assert.deepEqual(await state(), initialState);
  const prepareTrade = (operation, amountWei, slippageBps = 100, prior) => lifePost({
    action: "prepare", token, account: creator.address, operation, amountWei: amountWei.toString(), slippageBps,
    ...(prior && { prior }),
  }).then((response) => response.json());
  const firstPreview = await prepareTrade("buy", firstBudget);
  assert.equal(firstPreview.status, "prepared");
  assert.equal(BigInt(firstPreview.quote.outputWei), firstQuote);
  assert.equal(BigInt(firstPreview.quote.minimumOutputWei), firstQuote * 99n / 100n);
  assert.equal((await prepareTrade("buy", firstBudget, 501)).status, "invalid");
  await reviewed("Buy", "0.2");
  await button("Review test buy").click();
  await button("Confirm test buy").waitFor();
  await capture("07-reviewed-test-buy");
  hideTradeTrace = true;
  await sendThroughPage("Confirm test buy", "lose");
  const buyReceipt = await lastReceipt("buy");
  await mine();
  await waitFor("interrupted native trade proof", async () => hiddenTradeTraces > 0, worker);
  assert.equal((await fetchAt(site, path)).status, 503, "Missing exact native proof cannot publish a canonical trade");
  await page.reload();
  await button("Check original transaction").waitFor();
  await button("Check original transaction").click();
  assert.equal(signatures.length, 2, "Loss and reload never repeat a transaction");
  await capture("08-trade-proof-unavailable");
  hideTradeTrace = false;
  await workerReady(worker);
  const buy = await assertCurveTrade(buyReceipt, "buy", 0n, 0n);
  await checkSettlement("buy");
  await openToken();
  await openTradeWallet();
  const tokenBalanceBuy = await balance();
  const [soldAfterBuy, backingAfterBuy] = await state();
  const sellTokens = 1_000n * 10n ** 18n;
  assert.ok(tokenBalanceBuy > sellTokens);
  assert.equal(await allowance(), 0n);
  const sellQuote = uint(await call(curve, curveAbi, "quoteSell", [sellTokens]));
  assert.ok(sellQuote > 0n);
  await assert.rejects(testCall("sell", [sellTokens, 1n, (await nowOnChain()) + 240n]), /eth_call failed/,
    "An unapproved sale must revert");
  assert.deepEqual(await prepareTrade("sell", sellTokens), { status: "invalid", reason: "insufficient-allowance" });
  assert.deepEqual(await state(), [soldAfterBuy, backingAfterBuy]);
  await reviewed("Sell", "1000");
  await button("Review exact test approval").click();
  await sendThroughPage("Confirm exact test approval");
  const approval = await lastReceipt("approve");
  assert.equal(await allowance(), sellTokens);
  await mine();
  await workerReady(worker);
  await checkSettlement("approval");
  await assert.rejects(testCall("sell", [sellTokens, sellQuote + 1n, (await nowOnChain()) + 240n]), /eth_call failed/,
    "Impossible minimum sell output must revert with a valid allowance");
  assert.equal(await allowance(), sellTokens);
  await reviewed("Sell", "1000");
  await button("Review test sell").click();
  await button("Confirm test sell").waitFor();
  await capture("09-reviewed-test-sell");
  await sendThroughPage("Confirm test sell");
  const sellReceipt = await lastReceipt("sell");
  assert.equal(await allowance(), 0n, "Curve consumes only the exact granted allowance");
  await mine();
  await workerReady(worker);
  const sell = await assertCurveTrade(sellReceipt, "sell", tokenBalanceBuy, backingAfterBuy);
  await checkSettlement("sell");

  const conflicting = startWorker("worker-duplicate-writer", { ...workerEnv, RMT_CURVE_FIXTURE_PORT: String(await unusedPort()) });
  assert.notEqual((await conflicting.done).code, 0, "Concurrent writer must fail closed");
  await stop(web);
  await stop(worker);
  web = startWeb("website-restarted");
  await webReady(web);
  assert.equal((await fetchAt(site, path)).status, 503);
  worker = startWorker("worker-restarted");
  await workerReady(worker);
  const restarted = await waitFor("rediscovery after both processes restart", getIndexed);
  assert.deepEqual(restarted.creation, indexed.creation);
  assert.deepEqual(restarted.lifecycle.trades, (await getIndexed()).lifecycle.trades);
  assert.equal(restarted.lifecycle.trades.length, 2);
  assert.ok(restarted.lifecycle.trades.some((trade) => trade.transactionHash === sellReceipt.hash));
  rows = (await sqlLaunches()).rows;
  assert.equal(rows.length, 1, "Restart and replay cannot duplicate a registration");
  assert.deepEqual(rows[0], row);
  await page.goto(`${site}/launches/${token}`);
  await page.getByRole("heading", { name: project.name, exact: true }).waitFor();
  await capture("06-rediscovered-after-restart");

  const preGraduationSnapshot = await rpc("evm_snapshot");
  await openTradeWallet();
  await reviewed("Buy", "3");
  await button("Review test buy").click();
  await sendThroughPage("Confirm test buy");
  const thresholdReceipt = await lastReceipt("buy");
  await mine();
  await workerReady(worker);
  const threshold = await assertCurveTrade(thresholdReceipt, "buy", tokenBalanceBuy - sellTokens, BigInt(sell.indexed.backingWei));
  assert.deepEqual(await state(), [BigInt(project.supplyWei) * 3n / 5n, backingWei]);
  assert.ok(BigInt(threshold.indexed.nativeRefundWei) > 0n, "Terminal purchase returns the exact excess");
  await checkSettlement("buy");
  await openToken();
  await openTradeWallet();
  assert.equal((await getIndexed()).lifecycle.phase, "eligible");
  await assert.rejects(testCall("buy", [1n, (await nowOnChain()) + 240n], firstBudget), /eth_call failed/, "Threshold closes curve purchases");
  await button("Review test graduation").click();
  await button("Confirm test graduation").waitFor();
  await capture("10-reviewed-test-graduation");
  await sendThroughPage("Confirm test graduation");
  const graduationReceipt = await lastReceipt("graduate");
  await mine();
  await workerReady(worker);
  const graduated = await waitFor("indexed canonical position", async () => {
    const value = await getIndexed();
    return value?.lifecycle.phase === "graduated" && value.lifecycle;
  });
  const v4 = graduated.graduation;
  eq(v4.transactionHash, graduationReceipt.hash);
  eq(v4.blockHash, graduationReceipt.blockHash);
  eq(v4.poolKey.currency1, token);
  assert.equal(v4.poolKey.currency0, "0x0000000000000000000000000000000000000000");
  assert.deepEqual([v4.poolKey.fee, v4.poolKey.tickSpacing], [3000, 60]);
  eq(v4.owner, contractAddress(await call(curve, curveAbi, "graduationEngine")));
  const positionAbi = parseAbi(["function ownerOf(uint256) view returns (address)", "function getPositionLiquidity(uint256) view returns (uint128)"]);
  eq(contractAddress(await call(v4.positionManager, positionAbi, "ownerOf", [BigInt(v4.positionTokenId)])), v4.owner);
  assert.equal(uint(await call(v4.positionManager, positionAbi, "getPositionLiquidity", [BigInt(v4.positionTokenId)])).toString(), v4.liquidityWei);
  assert.equal(BigInt(v4.nativeUsedWei) + BigInt(v4.nativeDustWei), backingWei);
  assert.equal(BigInt(v4.tokenUsedWei) + BigInt(v4.tokenDustWei), BigInt(project.supplyWei) * 2n / 5n);
  assert.equal(await balance(curve), BigInt(v4.tokenDustWei));
  assert.equal((await state())[1], 0n);
  assert.equal(uint(await call(curve, curveAbi, "graduated")), 1n);
  for (const [op, values, payment] of [["buy", [1n, (await nowOnChain()) + 240n], firstBudget],
    ["sell", [1n, 1n, (await nowOnChain()) + 240n], 0n], ["graduate", [(await nowOnChain()) + 240n], 0n]]) {
    await assert.rejects(testCall(op, values, payment), /eth_call failed/, `Completed graduation closes ${op}`);
  }
  await checkSettlement("graduation", true, false);
  await openToken();
  await page.getByRole("heading", { name: "Verified Uniswap v4 graduation", exact: true }).waitFor();
  await capture("11-verified-v4-position");
  assert.equal(signatures.length, 6);

  const dbEvidence = async (tableName) => (await pg.query(`SELECT token, block_number, block_hash, transaction_hash, log_index
    FROM rmt_curve_fixture_${tableName} ORDER BY block_number, log_index`)).rows;
  currentGraduation = v4;
  currentLedger = contractAddress(await call(v4.owner, feesAbi, "lpFeeLedger", [token]));
  const postSnapshot = await rpc("evm_snapshot");
  const postState = async () => (await getIndexed())?.lifecycle.postGraduation;
  const startPost = await waitFor("verified v4 and fee ledger detail", postState);
  assert.deepEqual(startPost.events, []);
  eq(startPost.ledger, currentLedger);
  eq(startPost.router, router);
  eq(startPost.permit2, permit2);
  eq(startPost.quoter, anchor.quoter.address);

  const exactWallet = (account) => page.evaluate((address) => window.fixtureWallet.selectAccount(address), account);
  const executeReviewed = async (label, operation, mode = "normal") => {
    await button(`Review ${label}`).click();
    const confirm = `Confirm ${label}`;
    await button(confirm).waitFor();
    await sendThroughPage(confirm, mode);
    return lastReceipt(operation);
  };
  const preparedPost = (operation, amountWei, slippageBps, account = creator.address, prior) => lifePost({
    action: "prepare", token, operation, account, amountWei: amountWei.toString(), slippageBps,
    ...(prior && { prior }),
  }).then((response) => response.json());
  const eventFor = (hash, kind) => waitFor(`verified ${kind} in new-engine detail`, async () =>
    (await postState())?.events.find((event) => event.kind === kind && event.transactionHash.toLowerCase() === hash.toLowerCase()));
  const expectedFees = async (account, block = "latest") => {
    const raw = await call(currentLedger, ledgerAbi, "claimable", [account], block);
    return { nativeWei: uint(raw).toString(), tokenWei: uint(raw, 1).toString() };
  };
  const checkPosition = async () => {
    const spot = (await getIndexed()).lifecycle.graduation;
    eq(spot.poolId, v4.poolId);
    eq(spot.owner, v4.owner);
    assert.equal(spot.positionTokenId, v4.positionTokenId);
    assert.equal(spot.liquidityWei, v4.liquidityWei);
    assert.equal(uint(await call(v4.positionManager, positionAbi, "getPositionLiquidity", [BigInt(v4.positionTokenId)])).toString(), spot.liquidityWei);
    eq(contractAddress(await call(v4.positionManager, positionAbi, "ownerOf", [BigInt(v4.positionTokenId)])), v4.owner);
  };
  const tokenPermitAllowance = () => call(token, erc20Abi, "allowance", [creator.address, permit2]).then(uint);
  const routerPermitAllowance = () => call(permit2, permitAbi, "allowance", [creator.address, token, router]).then(uint);
  const assertV4Receipt = async (proof, kind, balanceBefore) => {
    const buy = kind === "v4-buy";
    const events = parseEventLogs({ abi: swapAbi, eventName: "Swap",
      logs: proof.logs.filter((log) => log.address.toLowerCase() === v4.poolManager.toLowerCase()) });
    assert.equal(events.length, 1);
    const { id, sender, amount0, amount1, fee } = events[0].args;
    eq(id, v4.poolId);
    eq(sender, router);
    assert.equal(fee, 3000);
    const nativeAmount = buy ? -amount0 : amount0;
    const tokenAmount = buy ? amount1 : -amount1;
    assert.ok(nativeAmount > 0n && tokenAmount > 0n);
    assert.equal(await balance(), buy ? balanceBefore + tokenAmount : balanceBefore - tokenAmount);
    const observed = await eventFor(proof.hash, kind);
    eq(observed.blockHash, proof.blockHash);
    eq(observed.account, creator.address);
    assert.deepEqual([observed.nativeWei, observed.tokenWei], [nativeAmount, tokenAmount].map(String));
    await checkPosition();
    return { receipt: proof, indexed: observed };
  };

  await page.getByRole("heading", { name: "Verified Uniswap v4 trading", exact: true }).waitFor();
  await openTradeWallet();
  const v4Budget = 10_000_000_000_000_000n;
  const v4Preview = await preparedPost("v4-buy", v4Budget, 100);
  assert.equal(v4Preview.status, "prepared");
  assert.equal((await preparedPost("v4-buy", v4Budget, 501)).status, "invalid");
  const selectedPool = v4Preview.request.v4.poolKey;
  const wrongPool = { ...v4Preview.request, v4: { ...v4Preview.request.v4,
    poolKey: { ...selectedPool, fee: selectedPool.fee + 1 } } };
  const wrongRouter = { ...v4Preview.request, to: alternate };
  for (const mutated of [wrongPool, wrongRouter]) {
    assert.equal((await preparedPost("v4-buy", v4Budget, 100, creator.address, mutated)).status, "invalid");
  }
  const [route, [encoded]] = decodeFunctionData({ abi: routerAbi, data: v4Preview.request.data }).args;
  const [actions, [v4Payload, settlement, receiving]] = decodeAbiParameters(v4Routes, encoded);
  const [tradeTerms] = decodeAbiParameters(routerSwap, v4Payload);
  const expiry = BigInt(v4Preview.request.deadline);
  const routerSim = (params, at) => call(router, routerAbi, "execute", [route, [params], at], "latest",
    { from: creator.address, value: toHex(v4Budget) });
  await assert.rejects(routerSim(encoded, 1n), /eth_call failed/, "Expired v4 deadline must revert");
  const impossible = BigInt(v4Preview.quote.outputWei) + 1n;
  const withNewTerms = (terms) => encodeAbiParameters(v4Routes, [actions, [encodeAbiParameters(routerSwap, [terms]), settlement, receiving]]);
  await assert.rejects(routerSim(withNewTerms({ ...tradeTerms, poolKey: wrongPool.v4.poolKey }), expiry), /eth_call failed/, "Wrong full PoolKey must revert");
  await assert.rejects(routerSim(withNewTerms({ ...tradeTerms, amountOutMinimum: impossible,
    minHopPriceX36: impossible * 10n ** 36n / v4Budget }), expiry), /eth_call failed/, "v4 minimum output must protect the buyer");

  await reviewed("Buy", "0.01");
  await button("Review test v4 buy").click();
  await button("Confirm test v4 buy").waitFor();
  await capture("14-reviewed-v4-buy");
  const v4BalanceBefore = await balance();
  hideTradeTrace = true;
  await sendThroughPage("Confirm test v4 buy", "lose");
  const v4BuyReceipt = await lastReceipt("v4-buy");
  const v4TraceReads = hiddenTradeTraces;
  await mine();
  await waitFor("v4 trace missing", async () => hiddenTradeTraces > v4TraceReads, worker);
  assert.equal((await fetchAt(site, path)).status, 503);
  await page.reload();
  await button("Check original transaction").click();
  assert.equal(signatures.length, 7, "Missing v4 response hash never triggers a duplicate request");
  await capture("15-v4-recovery-pending");
  hideTradeTrace = false;
  await workerReady(worker);
  const v4Buy = await assertV4Receipt(v4BuyReceipt, "v4-buy", v4BalanceBefore);
  await checkSettlement("v4 buy");

  const sellV4Amount = 100n * 10n ** 18n;
  assert.equal((await preparedPost("v4-sell", sellV4Amount, 100)).reason, "insufficient-allowance");
  await reviewed("Sell", "100");
  const v4TokenApproval = await executeReviewed("exact v4 token approval", "v4-token-approve");
  assert.equal(await tokenPermitAllowance(), sellV4Amount);
  await mine();
  await workerReady(worker);
  await checkSettlement("v4 token approval");
  const v4PermitApproval = await executeReviewed("exact Permit2 approval", "v4-permit2-approve");
  assert.equal(await routerPermitAllowance(), sellV4Amount);
  await mine();
  await workerReady(worker);
  await checkSettlement("Permit2 approval");
  assert.equal((await preparedPost("v4-sell", sellV4Amount - 1n, 100)).reason, "insufficient-allowance",
    "An allowance in excess of the chosen sale cannot be reused");
  const v4SellBefore = await balance();
  await button("Review test v4 sell").click();
  await button("Confirm test v4 sell").waitFor();
  await capture("16-reviewed-v4-sell");
  await sendThroughPage("Confirm test v4 sell");
  const v4SellReceipt = await lastReceipt("v4-sell");
  assert.equal(await tokenPermitAllowance(), 0n);
  assert.equal(await routerPermitAllowance(), 0n);
  await mine();
  await workerReady(worker);
  const v4Sell = await assertV4Receipt(v4SellReceipt, "v4-sell", v4SellBefore);
  await checkSettlement("v4 sell");
  const earned = await waitFor("both real LP fee assets", async () => {
    const post = await postState();
    return post && BigInt(post.uncollected.nativeWei) > 0n && BigInt(post.uncollected.tokenWei) > 0n && post;
  });
  assert.deepEqual(earned.accrued, { nativeWei: "0", tokenWei: "0" });
  const collectProof = await executeReviewed("test LP fee collection", "lp-collect");
  await mine();
  await workerReady(worker);
  const collected = await eventFor(collectProof.hash, "lp-collect");
  assert.deepEqual({ nativeWei: collected.nativeWei, tokenWei: collected.tokenWei }, earned.uncollected);
  const collectedState = await postState();
  assert.deepEqual(collectedState.accrued, earned.uncollected);
  assert.deepEqual(collectedState.uncollected, { nativeWei: "0", tokenWei: "0" });
  await checkPosition();
  await checkSettlement("LP fee collection", true, false);
  assert.equal((await preparedPost("lp-claim", 0n, 0, alternate)).reason, "no-fees");
  await assert.rejects(call(currentLedger, ledgerAbi, "claim", [], "latest", { from: alternate }), /eth_call failed/);
  const claims = [];
  for (const account of [creator.address, treasury, operations, reserve]) {
    const credit = await expectedFees(account);
    assert.ok(BigInt(credit.nativeWei) > 0n && BigInt(credit.tokenWei) > 0n);
    await exactWallet(account);
    await button("Connect test trading wallet").click();
    await page.getByText(new RegExp(`Connected test account ${account}`, "i")).waitFor();
    const proof = await executeReviewed("test LP fee claim", "lp-claim");
    await mine();
    await workerReady(worker);
    const claim = await eventFor(proof.hash, "lp-claim");
    eq(claim.account, account);
    eq(claim.blockHash, proof.blockHash);
    assert.deepEqual({ nativeWei: claim.nativeWei, tokenWei: claim.tokenWei }, credit);
    assert.deepEqual(await expectedFees(account), { nativeWei: "0", tokenWei: "0" });
    await checkPosition();
    await checkSettlement("LP fee claim", true, false);
    claims.push({ receipt: proof, indexed: claim });
  }
  const settledPost = await postState();
  assert.deepEqual(settledPost.claimed, settledPost.accrued);
  await page.getByRole("heading", { name: "Canonical Uniswap v4 and LP fee activity", exact: true }).waitFor();
  await capture("17-v4-swaps-and-fee-claims");
  assert.equal(signatures.length, 15);

  const tradesBeforeReorg = await dbEvidence("trades");
  const graduationsBeforeReorg = await dbEvidence("graduations");
  const postBeforeReorg = await dbEvidence("post_events");
  assert.equal(tradesBeforeReorg.length, 3);
  assert.equal(graduationsBeforeReorg.length, 1);
  assert.equal(postBeforeReorg.length, 7);
  eq(graduationsBeforeReorg[0].transaction_hash, graduationReceipt.hash);
  await stop(web);
  await stop(worker);
  web = startWeb("website-after-graduation");
  worker = startWorker("worker-after-graduation");
  await webReady(web);
  await workerReady(worker);
  const reopened = await waitFor("persistent graduated token", getIndexed);
  assert.deepEqual(reopened.lifecycle.postGraduation, settledPost);
  assert.deepEqual(await dbEvidence("post_events"), postBeforeReorg);
  await checkPosition();
  await openToken();
  await page.getByRole("heading", { name: "Verified Uniswap v4 graduation", exact: true }).waitFor();
  await capture("12-verified-v4-after-restart");
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture("18-fee-and-custody-landscape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture("19-fee-and-custody-desktop");
  await page.setViewportSize({ width: 390, height: 844 });

  rpcOutage = true;
  await waitFor("local RPC outage withholds post-graduation proof", async () => (await fetchAt(site, path)).status === 503, worker);
  rpcOutage = false;
  await workerReady(worker);
  assert.deepEqual(await postState(), settledPost);

  interruptLogScan = true;
  assert.equal(await rpc("evm_revert", [postSnapshot]), true);
  await rpc("evm_setNextBlockTimestamp", [Number((await nowOnChain()) + 73n)]);
  await rpc("anvil_mine", ["0x6"]);
  await waitFor("v4 trades and fee rollback", async () => (await dbEvidence("post_events")).length === 0, worker);
  assert.equal((await fetchAt(site, path)).status, 503);
  interruptLogScan = false;
  await workerReady(worker);
  await checkPosition();
  const rolledBack = await postState();
  assert.deepEqual(rolledBack, startPost, "Replacing v4 transactions must roll back fees while preserving graduation");
  assert.equal(await rpc("eth_getTransactionReceipt", [v4SellReceipt.hash]), null);
  assert.equal(await rpc("eth_getTransactionReceipt", [collectProof.hash]), null);

  interruptLogScan = true;
  assert.equal(await rpc("evm_revert", [preGraduationSnapshot]), true);
  const revivedHead = await nowOnChain();
  await rpc("evm_setNextBlockTimestamp", [Number(revivedHead + 41n)]);
  await rpc("anvil_mine", ["0x6"]);
  await waitFor("graduation rollback", async () => (await dbEvidence("graduations")).length === 0, worker);
  assert.equal((await fetchAt(site, path)).status, 503);
  interruptLogScan = false;
  await workerReady(worker);
  const restored = await waitFor("restored pre-graduation state", getIndexed);
  assert.equal(restored.lifecycle.phase, "curve");
  assert.equal(restored.lifecycle.backingWei, sell.indexed.backingWei);
  assert.equal(restored.lifecycle.trades.length, 2);
  assert.equal(await rpc("eth_getTransactionReceipt", [graduationReceipt.hash]), null);
  await openToken();
  await page.getByRole("heading", { name: "Verified bonding curve" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Verified Uniswap v4 graduation", exact: true }).count(), 0);
  await capture("13-curve-restored-after-reorg");

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
  assert.equal(signatures.length, 15, "Reorg and outages must not rebroadcast transactions");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(offOrigin, []);
  Object.assign(evidence, { reviewedTransaction: tx, receipt: { hash: receipt.transactionHash, blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash, status: receipt.status }, indexed, postgresRow: row,
    initial: { backingWei: "0", soldWei: "0", inventoryWei: project.supplyWei, creatorInitialTokensWei: "0" },
    lifecycle: { buy, approval, sell, threshold, graduation: { receipt: graduationReceipt, verified: v4 },
      v4: { buy: v4Buy, tokenApproval: v4TokenApproval, permit2Approval: v4PermitApproval, sell: v4Sell,
        collect: { receipt: collectProof, indexed: collected }, claims, settled: settledPost },
      postgres: { trades: tradesBeforeReorg, graduation: graduationsBeforeReorg, postEvents: postBeforeReorg },
      preGraduationAfterReorg: restored.lifecycle },
    checks: { rejected: true, accountInvalidatedReview: true, chainInvalidatedReview: true, lostHashRefreshRecovered: true, insufficientFeeRejected: true,
      missingReceiptReads, omittedCreationReads, indexingDelay: true, restart: true, reorgRollback: true, interruptedLogReads,
      mutatedRequestRejected: true, wrongBinding: true, duplicateWriterRejected: true, singleCreationBroadcast: true,
      totalWalletBroadcasts: signatures.length, hiddenTradeTraces, approvalConsumed: true, expiredAndSlippageRejected: true,
      indexedTradeRestart: true, indexedGraduationRestart: true, graduationRollback: true,
      postGraduationRestart: true, postGraduationReorg: true, rpcOutage: true, unauthorizedClaimRejected: true,
      wrongRouterAndPoolKeyRejected: true, excessiveApprovalRejected: true, exactCustodyPreserved: true } });
  await writeFile(join(out, "creation-journey-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`Same-app creation → curve trades → v4 swaps → fee collection and claims passed on 31337. ${join(out, "creation-journey-evidence.json")}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(out, "failure.png"), fullPage: true }).catch(() => undefined);
    const text = await page.locator("main").innerText({ timeout: 2_000 }).catch(() => "");
    if (text) await writeFile(join(out, "failure-page.txt"), text.slice(0, 16_000));
  }
  throw error;
} finally {
  await browser?.close();
  for (const job of processes.toReversed()) await stop(job);
  await pg.end();
  if (pgStarted) {
    await successful(start(pgExecutable("pg_ctl"), ["-D", cluster, "-w", "-m", "fast", "stop"], "postgres-stop"));
  }
  await new Promise((done) => proxy.close(done));
}
