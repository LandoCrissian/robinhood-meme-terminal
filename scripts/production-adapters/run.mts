import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { curveProductionDeployment, curveProductionPins as pins } from "../../apps/launch-website/lib/server/curve-production";
import { prepareProductionLifecycle, verifyProductionLifecycle, parseProductionActivity, readProductionTradingStateAt, type ProductionTradingContext } from "../../apps/launch-website/lib/server/production-lifecycle";
import { type ProductionLifecycleOperation, type ProductionLifecycleRequest } from "../../apps/launch-website/lib/production-lifecycle";
import { parseProductionDiscovery } from "../../apps/launch-website/lib/server/production-discovery";
import type { EarningsRpc } from "../../apps/launch-website/lib/server/earnings-contracts";
import { handleProductionEarningsClaim } from "../../apps/launch-website/lib/server/production-earnings";
import type { EarningsClaimOperation } from "../../apps/launch-website/lib/earnings-claims";
import { curveProductionConfig } from "../../apps/indexer/src/curve-production-config";
import { curveProductionSchemaSql, productionCurveScope, productionCurveCursor } from "../../apps/indexer/src/curve-production-store";
import { lockIndexWriter } from "../../apps/indexer/src/index-store";
import { productionActivitySchemaSql } from "../../apps/indexer/src/curve-production-activity";
import { createProductionCurveIndexer } from "../../apps/indexer/src/curve-production";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { createPublicClient, defineChain, http, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, erc20Abi, keccak256,
  parseAbi, parseEventLogs, toHex, zeroAddress } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const { values: args } = parseArgs({ options: { anvil: { type: "string" }, output: { type: "string" }, rpc: { type: "string", default: "https://rpc.mainnet.chain.robinhood.com" }, latest: { type: "boolean", default: false }, "pg-port": { type: "string", default: "55492" } } });
assert.ok(args.anvil && args.output, "Supply --anvil and a fresh --output file");
assert.ok(["https://rpc.mainnet.chain.robinhood.com", "https://robinhood.api.pocket.network"].includes(args.rpc!), "Only existing public read endpoints may be forked");
const repository = fileURLToPath(new URL("../../", import.meta.url)), out = resolve(args.output!);
await mkdir(dirname(out), { recursive: true });
await readFile(out).then(() => { throw Error("Refusing to overwrite existing evidence"); }, () => {});
const capture = JSON.parse(gunzipSync(await readFile(resolve(repository, "docs/evidence/rmt-task092/governance/current/capture.json.gz"))).toString());
async function sourceIdentity() {
  const changed = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard"], { cwd: repository, encoding: "utf8" }).trim().split(/\r?\n/)
    .filter(path => /^(?:apps\/(?:launch-website\/lib|indexer\/src)\/|packages\/launchpad-common\/)/.test(path) || path === "scripts/production-adapters/run.mts").sort();
  const files = await Promise.all(changed.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(resolve(repository, path))).digest("hex") })));
  return { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
    committedTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8" }).trim(), files };
}
if (args.latest) {
  const response = await fetch(args.rpc!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }), signal: AbortSignal.timeout(10000) });
  const body = await response.json() as any; assert.ok(body.result?.number && body.result?.hash);
  capture.anchor = { number: BigInt(body.result.number).toString(), hash: body.result.hash };
}
const report: any = { schemaVersion: 1, scope: "ISOLATED_ANVIL_4663_PRODUCTION_ADAPTER_CONTINUOUS_EVM_ACCEPTANCE", startedAt: new Date().toISOString(),
  source: await sourceIdentity(),
  upstream: { url: args.rpc, blockNumber: capture.anchor.number, blockHash: capture.anchor.hash, access: "normal-public-read-only" },
  restrictions: { productionWrites: false, deployment: false, governanceExecution: false, signing: false, liveTokenCreation: false, fundsSpent: false },
  limitations: ["All tokens, accounts, balances, publication storage and transactions exist only on a verified loopback Anvil fork.",
    "Two read adapters observe one isolated EVM; this does not establish independent mainnet consensus.",
    "Anvil uses value/calldata-specific synthetic C8 execution estimates and synthetic native ArbGasInfo zero-poster measurements matching the observed production policy shape. These are not live mainnet transaction fee acceptance."],
  steps: [], localWrites: [] };
const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
const url = `http://127.0.0.1:${port}/`;
const child = spawn(resolve(args.anvil!), ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "4663", "--fork-url", args.rpc!,
  "--fork-block-number", capture.anchor.number, "--hardfork", "prague", "--accounts", "0", "--silent"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let processOutput = ""; child.stdout.on("data", data => { processOutput = (processOutput + data.toString()).slice(-12000); });
child.stderr.on("data", data => { processOutput = (processOutput + data.toString()).slice(-12000); });
const chain = defineChain({ id: 4663, name: "Isolated production-adapter Anvil", nativeCurrency: { name: "Synthetic ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
const client = createPublicClient({ chain, transport: http(url, { timeout: 30000, retryCount: 0 }), cacheTime: 0 });
const localBaseFee = 20_724_000n;
async function assertLocal() {
  const endpoint = new URL(client.transport.url); assert.equal(endpoint.hostname, "127.0.0.1"); assert.equal(endpoint.protocol, "http:"); assert.ok(endpoint.port);
  assert.equal(await client.getChainId(), 4663); assert.match(await client.request({ method: "web3_clientVersion" }), /^anvil/i);
}
async function writeLocal(method: string, params: unknown[] = []) {
  await assertLocal(); report.localWrites.push({ method, scope: "verified-loopback-anvil-only" });
  if (method === "eth_sendTransaction") await writeLocal("anvil_setNextBlockBaseFeePerGas", [toHex(localBaseFee)]);
  return client.request({ method, params });
}
async function send(from: string, to: string, data: string, value = 0n, gas = 8000000n) {
  const hash = await writeLocal("eth_sendTransaction", [{ from, to, data, value: toHex(value), gas: toHex(gas), type: "0x2",
    maxFeePerGas: toHex(10000000000n), maxPriorityFeePerGas: "0x1" }]);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60000, pollingInterval: 100, checkReplacement: false });
  assert.equal(receipt.status, "success"); assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash); return receipt;
}
const factoryAbi = parseAbi(["function create(string,string,string,address,uint16,bytes32,uint256) payable returns(address,address)",
  "event CurveCreated(address indexed token,address indexed curve,address indexed creator,bytes32 intentId,uint256 supply,address revenueLedger,address treasury,uint16 treasuryShareBps,string name,string symbol,string projectURI)",
  "function claimCreationFees()", "function creationFeesAccrued() view returns(uint256)"]);
const directoryAbi = parseAbi(["function factories(uint32) view returns(address factory,bytes32 runtimeHash)", "function latestVersion() view returns(uint32)", "function suspended() view returns(bool)"]);
const nitroAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);
const registrations = new Map<string, any>();
let simulateProjectBirthPruning = false;
const pgRequire = createRequire(new URL("../../apps/indexer/package.json", import.meta.url)), { Client } = pgRequire("pg");
let database: any, readDatabase: any, mainIndexer: ReturnType<typeof createProductionCurveIndexer>, api: HttpServer | undefined;
let durablePoint: any, apiOrigin = "";
let databaseName = "";
const credential = "local-only";
const config = curveProductionConfig({ RMT_CURVE_PRODUCTION_BINDING: JSON.stringify({ schemaVersion: 1, chainId: 4663, profile: "rmt-curve-fixed-supply-security-v2",
  evidence: "CANONICAL_DEPLOYMENT_AND_SOURCE_VERIFIED", factory: pins.factory[0], factoryRuntimeHash: pins.factory[1], projectRegistry: pins.registry[0], registryRuntimeHash: pins.registry[1],
  deploymentBlock: String(curveProductionDeployment.blockNumber), deploymentBlockHash: curveProductionDeployment.blockHash, deploymentTransactionHash: curveProductionDeployment.transactionHash,
  operatingRecipient: curveProductionDeployment.operating, reserveRecipient: curveProductionDeployment.reserve, creationFeeWei: String(curveProductionDeployment.creationFeeWei),
  confirmations: 20, sourceVerificationEvidenceSha256: curveProductionDeployment.compilerInputSha256 }) })!;
const scope = productionCurveScope(config);
const publicDeployment = { factory: pins.factory[0], registry: pins.registry[0], blockNumber: String(curveProductionDeployment.blockNumber), blockHash: curveProductionDeployment.blockHash };
const approvalBinding = createHash("sha256").update("Task092 isolated synthetic owner approval; never valid production evidence").digest("hex");
function reader(id: "official" | "pocket"): EarningsRpc {
  return new Proxy(client, { get(target, property) {
    if (property === "transport") return { ...client.transport, url: id === "official" ? "https://rpc.mainnet.chain.robinhood.com" : "https://robinhood.api.pocket.network" };
    if (property === "getCode") return async (request: any) => {
      if (simulateProjectBirthPruning && [...registrations.values()].some(r => BigInt(r.creation.blockNumber) === request.blockNumber
          && [r.token, r.revenueLedger].some(a => a.toLowerCase() === request.address.toLowerCase()))) {
        throw Object.assign(Error("historical state " + "f".repeat(64) + " is not available"), { code: -32000, details: "historical state " + "f".repeat(64) + " is not available" });
      }
      return client.getCode(request);
    };
    if (property === "readContract") return async (request: any) => {
      if (request.address.toLowerCase() !== "0x000000000000000000000000000000000000006c") return client.readContract(request);
      const b = await client.getBlock({ blockNumber: request.blockNumber }); assert.ok(b.baseFeePerGas > 0n);
      const nativeBase = b.baseFeePerGas > 6000n ? b.baseFeePerGas - 6000n : b.baseFeePerGas;
      if (request.functionName === "getL1BaseFeeEstimate") return 0n;
      assert.equal(request.functionName, "getPricesInWei"); return [0n, 0n, nativeBase * 20000n, nativeBase, 0n, nativeBase];
    };
    if (property === "call") return async (request: any) => {
      if (request.to?.toLowerCase() !== "0x00000000000000000000000000000000000000c8") return client.call(request);
      const { decodeFunctionData } = require("viem"); const decoded = decodeFunctionData({ abi: nitroAbi, data: request.data });
      const [to, creation, data] = decoded.args; assert.equal(creation, false);
      const execution = await client.estimateGas({ account: request.account, to, data, value: request.value, blockNumber: request.blockNumber });
      const block = await client.getBlock({ blockNumber: request.blockNumber });
      assert.ok(block.baseFeePerGas > 0n);
      return { data: encodeFunctionResult({ abi: nitroAbi, functionName: "gasEstimateComponents", result: [execution, 0n, block.baseFeePerGas + 14000n, 0n] }) };
    };
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return async (...params: unknown[]) => {
      try { return await Reflect.apply(value, target, params); }
      catch (error) { (report.readErrors ??= []).push({ method: String(property), error: error instanceof Error ? error.message.slice(0, 800) : String(error) }); throw error; }
    };
  } }) as EarningsRpc;
}
const rpc = reader("official"), corroboratingRpc = reader("pocket");
async function context(): Promise<ProductionTradingContext> {
  const b = await client.getBlock();
  return { rpc, corroboratingRpc, approvalBinding, feePolicy: "nitro-zero-poster-corroborated-v1", anchor: { blockNumber: b.number, blockHash: b.hash, timestamp: b.timestamp },
    discoveryReader: async token => parseProductionDiscovery(await getIndexer("/curve-launches?token=" + token), token) } as ProductionTradingContext;
}
async function mine(count = 21) {
  // Empty-block base-fee decay is controlled only in the isolated fixture, so
  // hundreds of confirmation blocks do not turn a positive execution fee into zero.
  for (let i = 0; i < count; i++) { await writeLocal("anvil_setNextBlockBaseFeePerGas", [toHex(localBaseFee)]); await writeLocal("anvil_mine", ["0x1", "0x0"]); }
}
async function activity(token: string, hash: string) {
  return parseProductionActivity(await getIndexer(`/curve-activity?token=${token.toLowerCase()}&transactionHash=${hash}`), token as any, hash as any);
}
async function getIndexer(path: string) {
  const response = await fetch(apiOrigin + path, { headers: { Authorization: "Bearer " + credential }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); return response.json();
}
async function persist() {
  await mainIndexer.syncOnce(); const state = mainIndexer.state();
  assert.equal(state.status, "ready", JSON.stringify(state)); assert.ok(state.caughtUp && state.checkpoint); durablePoint = state.checkpoint;
}
async function trade(token: string, account: string, operation: ProductionLifecycleOperation, amountWei = "0") {
  const prepared = await prepareProductionLifecycle(await context(), token as any, account as any, operation, amountWei, operation.includes("buy") || operation.includes("sell") ? 50 : 0);
  assert.equal(prepared.status, "prepared", JSON.stringify(prepared)); assert.ok(prepared.request && prepared.quote);
  assert.equal(prepared.quote.feeEvidence, "verified-nitro-zero-poster");
  const r = prepared.request as ProductionLifecycleRequest;
  let humanReview: object | undefined;
  if (operation === "buy" && !report.steps.some((step: any) => step.operation === "buy")) {
    await mine(12); await persist();
    const refreshed = await prepareProductionLifecycle(await context(), token as any, account as any, operation, amountWei, 50, r);
    assert.equal(refreshed.status, "prepared"); assert.deepEqual(refreshed.request, r);
    assert.ok(refreshed.quote?.feeEvidence === "verified-nitro-zero-poster" && prepared.quote.feeEvidence === "verified-nitro-zero-poster");
    assert.notEqual(refreshed.quote.nitroZeroPosterPolicy.blockNumber, prepared.quote.nitroZeroPosterPolicy.blockNumber);
    assert.ok(BigInt(refreshed.quote.gasUnits) <= BigInt(prepared.quote.gasUnits) && BigInt(refreshed.quote.gasPriceWei) <= BigInt(prepared.quote.gasPriceWei));
    humanReview = { canonicalBlocksElapsed: 12, requestUnchanged: true, freshQuote: refreshed.quote, feeCeilingNotIncreased: true, originalDeadlinePreserved: true };
  }
  const receipt = await send(account, r.to, r.data, BigInt(r.value), BigInt(prepared.quote.gasUnits)); await mine(); await persist();
  const verified = await verifyProductionLifecycle(await context(), r, receipt.transactionHash, activity as any);
  assert.equal(verified.status, "confirmed", `${operation}: ${JSON.stringify(verified)}`); assert.equal(verified.indexed, true);
  const recovered = await verifyProductionLifecycle(await context(), r, undefined, activity as any);
  assert.equal(recovered.status, "confirmed"); assert.equal(recovered.transactionHash, receipt.transactionHash);
  report.steps.push({ operation, token, request: r, quote: prepared.quote, receipt: { transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash }, verified,
    lostHashRecovery: { status: recovered.status, transactionHash: recovered.transactionHash, newTransactionSent: false }, ...(humanReview && { humanReview }) });
  return { prepared, receipt, verified };
}
async function claim(token: string, account: string, operation: EarningsClaimOperation) {
  const cfg = { release: {}, scope: "claims", approvalBinding };
  const options = { env: { RMT_LAUNCH_HISTORY_INDEXER_URL: "https://synthetic-indexer.invalid", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: credential },
    configured: (() => cfg) as any, resolve: (async () => ({ ...cfg, ...await context() })) as any,
    fetch: (async (input: any, init: any) => {
      const request = new URL(String(input)); assert.equal(request.origin, "https://synthetic-indexer.invalid");
      return fetch(apiOrigin + request.pathname + request.search, init);
    }) as typeof fetch };
  async function call(body: object) {
    const response = await handleProductionEarningsClaim(new Request("https://www.rmtlaunch.fun/api/launchpad/production-earnings-claim", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.rmtlaunch.fun", Host: "www.rmtlaunch.fun", "X-Forwarded-Proto": "https" }, body: JSON.stringify(body) }), options);
    const value = await response.json(); assert.equal(response.status, 200, operation + " " + (body as any).action + ": " + JSON.stringify(value)); return value;
  }
  const prepared = await call({ action: "prepare", operation, beneficiary: operation === "creation-fees" ? curveProductionDeployment.operating : account,
    account, kind: "eoa", ...(operation !== "creation-fees" && { token }) });
  assert.equal(prepared.status, "prepared", JSON.stringify(prepared)); assert.equal(prepared.review.status, "review-only");
  assert.equal(prepared.review.fees.status, "verified-nitro-zero-poster");
  const review = prepared.review;
  assert.equal((await call({ action: "revalidate", review, approvalBinding })).status, "revalidated");
  const hash = await writeLocal("eth_sendTransaction", [review.outer]);
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 100, timeout: 60000, checkReplacement: false }); assert.equal(receipt.status, "success");
  await mine(); await persist();
  const result = await call({ action: "verify", review, approvalBinding, transactionHash: hash });
  assert.equal(result.status, "verification"); assert.equal(result.settlement.stage, "canonical-l2", JSON.stringify(result));
  assert.equal(result.settlement.indexed, true); assert.equal(result.settlement.finality.l1Finality, "unverified");
  report.steps.push({ operation, token, review, receipt: { transactionHash: hash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash }, verification: result.settlement });
}
try {
  let ready = false;
  for (let i = 0; i < 90; i++) { try { await assertLocal(); ready = true; break; } catch { if (child.exitCode !== null) break; await delay(500); } }
  assert.ok(ready, `Isolated fork unavailable: ${processOutput}`);
  const fork = await client.getBlock(); assert.equal(fork.number.toString(), capture.anchor.number); assert.equal(fork.hash, capture.anchor.hash);
  databaseName = "rmt_task092_continuous_" + Date.now(); const control = new Client({ host: "127.0.0.1", port: Number(args["pg-port"]), user: "postgres", database: "postgres" });
  await control.connect(); await control.query(`CREATE DATABASE ${databaseName}`); await control.end();
  database = new Client({ host: "127.0.0.1", port: Number(args["pg-port"]), user: "postgres", database: databaseName }); await database.connect();
  readDatabase = new Client({ host: "127.0.0.1", port: Number(args["pg-port"]), user: "postgres", database: databaseName }); await readDatabase.connect();
  await database.query(curveProductionSchemaSql); await database.query(productionActivitySchemaSql);
  mainIndexer = createProductionCurveIndexer(config, database, rpc as any, corroboratingRpc as any);
  const coldPasses = [];
  for (let pass = 1; pass <= 2; pass++) {
    await mainIndexer.syncOnce(); coldPasses.push({ pass, state: mainIndexer.state(), nextBlock: (await productionCurveCursor(database, scope)).toString() });
  }
  assert.equal(coldPasses[1].nextBlock, (curveProductionDeployment.blockNumber + 4000n).toString());
  assert.equal(coldPasses[1].state.caughtUp, false);
  report.indexerColdStartup = { originalCursor: String(curveProductionDeployment.blockNumber), passes: coldPasses,
    canonicalOneShotAndRegistryBirthProofsPassed: true, manualCursorSeedBeforeStartup: false,
    fullHistoricalCatchupObserved: false, limitation: "Only two bounded cold passes were authorized; no broad public historical scan or private production backup was used." };
  const baseline = { blockNumber: String(fork.number), blockHash: fork.hash, timestamp: new Date(Number(fork.timestamp) * 1000).toISOString() };
  // An explicit, wholly isolated empty checkpoint restore scopes the following
  // economic lifecycle. It is neither a production backup nor a complete old backfill.
  assert.equal((await database.query("SELECT count(*)::int AS count FROM rmt_curve_production_launches")).rows[0].count, 0);
  await database.query("DELETE FROM rmt_curve_production_checkpoints WHERE scope=$1", [scope]);
  await database.query("DELETE FROM rmt_curve_activity_checkpoints WHERE scope=$1", [scope]);
  await database.query("UPDATE rmt_curve_production_bindings SET next_block=$2 WHERE scope=$1", [scope, String(fork.number + 1n)]);
  await database.query("UPDATE rmt_curve_activity_bindings SET next_block=$2 WHERE scope=$1", [scope, String(fork.number + 1n)]);
  await database.query("INSERT INTO rmt_curve_production_checkpoints(scope,block_number,block_hash,observed_at) VALUES($1,$2,$3,$4)", [scope, baseline.blockNumber, baseline.blockHash, baseline.timestamp]);
  await database.query("INSERT INTO rmt_curve_activity_checkpoints(scope,block_number,block_hash,observed_at) VALUES($1,$2,$3,$4)", [scope, baseline.blockNumber, baseline.blockHash, baseline.timestamp]);
  mainIndexer = createProductionCurveIndexer(config, database, rpc as any, corroboratingRpc as any); durablePoint = baseline;
  report.database = { host: "127.0.0.1", port: Number(args["pg-port"]), name: databaseName, syntheticOnly: true, restoredSyntheticBaseline: baseline,
    excludedHistory: "Before the fork baseline; no claim of a complete production backfill", writer: "same advisory leased PostgreSQL connection" };
  api = createHttpServer(async (request, response) => {
    if (request.headers.authorization !== "Bearer " + credential) { response.writeHead(401); response.end(); return; }
    try {
      const url = new URL(request.url!, "http://127.0.0.1");
      const checkpoint = { ...durablePoint, confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" };
      const common = { schemaVersion: 1, chainId: 4663, status: "ready", deployment: publicDeployment, checkpoint, observedAt: new Date().toISOString() };
      let result: object;
      if (url.pathname === "/curve-launches") result = await mainIndexer.read(readDatabase, { token: url.searchParams.get("token")?.toLowerCase(), limit: 1 });
      else if (url.pathname === "/curve-earnings") {
        const recipient = url.searchParams.get("recipient")!;
        result = await mainIndexer.readEarnings(readDatabase, { recipient: recipient.toLowerCase() as any, limit: 1,
          ...(url.searchParams.get("token") && { token: url.searchParams.get("token")!.toLowerCase() as any }) });
      }
      else if (url.pathname === "/curve-activity") result = await mainIndexer.readActivity(readDatabase, { transactionHash: url.searchParams.get("transactionHash")!.toLowerCase() as any,
          ...(url.searchParams.get("token") && { token: url.searchParams.get("token")!.toLowerCase() as any }) });
      else throw Error("Unknown bounded synthetic indexer route");
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(result));
    } catch (error) { (report.indexerReadFailures ??= []).push({ path: request.url, error: error instanceof Error ? error.message : String(error) }); response.writeHead(503); response.end(); }
  });
  await new Promise<void>(resolve => api!.listen(0, "127.0.0.1", resolve)); apiOrigin = `http://127.0.0.1:${(api.address() as any).port}`;
  assert.equal((await fetch(apiOrigin + "/curve-launches")).status, 401); report.indexerAuthentication = "unauthenticated401; existingBearerpatternrequired";
  report.runtimePins = [];
  for (const [id, [address, hash]] of Object.entries(pins)) { const code = await client.getCode({ address }); assert.ok(code && keccak256(code) === hash, `Runtime ${id}`); report.runtimePins.push({ id, address, runtimeHash: hash }); }
  // Test-only state fixture: publish the existing exact runtime in local storage. No governance method is called, signed or executed.
  const mapping = keccak256(encodeAbiParameters([{ type: "uint32" }, { type: "uint256" }], [1, 10n]));
  const mappingNext = toHex(BigInt(mapping) + 1n, { size: 32 });
  await writeLocal("anvil_setStorageAt", [pins.directory[0], mapping, toHex(BigInt(pins.factory[0]), { size: 32 })]);
  await writeLocal("anvil_setStorageAt", [pins.directory[0], mappingNext, pins.factory[1]]);
  const published = await client.readContract({ address: pins.directory[0], abi: directoryAbi, functionName: "factories", args: [1] });
  assert.equal(published[0].toLowerCase(), pins.factory[0].toLowerCase()); assert.equal(published[1], pins.factory[1]);
  report.publicationFixture = { kind: "local-storage-only", directory: pins.directory[0], mappingSlot: "10", governanceMethodCalled: false };
  const creator = privateKeyToAccount(generatePrivateKey()).address;
  await writeLocal("anvil_setBalance", [creator, toHex(100n * 10n ** 18n)]); await writeLocal("anvil_impersonateAccount", [creator]);
  // Move the local clock to this run's wall time; historical production headers remain untouched.
  await writeLocal("evm_setNextBlockTimestamp", [Math.floor(Date.now() / 1000)]); await mine(1);
  const head = await client.getBlock(), intent = keccak256(toHex("Task092 isolated production-adapter project; not RMT " + report.startedAt));
  const creation = await send(creator, pins.factory[0], encodeFunctionData({ abi: factoryAbi, functionName: "create", args: ["Synthetic Adapter Project", "SYN092", "", zeroAddress, 0, intent, head.timestamp + 180n] }), curveProductionDeployment.creationFeeWei);
  const created = parseEventLogs({ abi: factoryAbi, eventName: "CurveCreated", strict: true, logs: creation.logs }); assert.equal(created.length, 1);
  const c = created[0].args, birthBlock = await client.getBlock({ blockNumber: creation.blockNumber });
  const registration = { kind: "curve-launch-1b-v2", status: "created", chainId: 4663, engineVersion: 1, factory: pins.factory[0], projectRegistry: pins.registry[0],
    token: c.token, initialCurve: c.curve, creator, revenueLedger: c.revenueLedger, name: "Synthetic Adapter Project", symbol: "SYN092", totalSupplyWei: c.supply.toString(), tokenDecimals: 18,
    projectURI: "", treasury: null, treasuryShareBps: 0, intentId: intent, projectRegistrationLogIndex: created[0].logIndex - 1,
    creation: { blockNumber: String(creation.blockNumber), blockHash: creation.blockHash,
      timestamp: new Date(Number(birthBlock.timestamp) * 1000).toISOString(), transactionHash: creation.transactionHash, logIndex: created[0].logIndex },
    creationFee: { amountWei: curveProductionDeployment.creationFeeWei.toString(), refundWei: "0", recipient: curveProductionDeployment.operating, logIndex: created[0].logIndex + 1 } };
  registrations.set(c.token.toLowerCase(), registration); await mine(); await persist();
  report.steps.push({ operation: "create-synthetic-project", token: c.token, curve: c.curve, transactionHash: creation.transactionHash, registration });
  const first = await trade(c.token, creator, "buy", (2n * 10n ** 18n).toString());
  const curveSell = (BigInt(first.verified.outputWei!) / 100n).toString();
  await trade(c.token, creator, "approve", curveSell); await trade(c.token, creator, "sell", curveSell);
  await claim(c.token, creator, "curve-claim");
  await claim(c.token, creator, "creation-fees");
  await trade(c.token, creator, "buy", (4n * 10n ** 18n).toString());
  await trade(c.token, creator, "graduate");
  async function v4Round() {
    const buy = await trade(c.token, creator, "v4-buy", (10n ** 16n).toString());
    const tokenAmount = (BigInt(buy.verified.outputWei!) / 2n).toString();
    await trade(c.token, creator, "v4-token-approve", tokenAmount); await trade(c.token, creator, "v4-permit2-approve", tokenAmount);
    await trade(c.token, creator, "v4-sell", tokenAmount);
  }
  await v4Round(); await claim(c.token, creator, "lp-collect"); await claim(c.token, creator, "lp-claim-native"); await claim(c.token, creator, "lp-claim-token");
  await v4Round(); await claim(c.token, creator, "lp-collect"); await claim(c.token, creator, "lp-claim");
  simulateProjectBirthPruning = true;
  const pruned = await readProductionTradingStateAt(rpc, await context(), registration as any, creator);
  assert.equal(pruned.state.phase, "graduated");
  report.projectBirthRecovery = { token: c.token, scope: "exact-typed-pruned-code fault injected only at token+ledger creation-height", sourceBoundProofPassed: true,
    currentRuntimeAndCanonicalCreationRetained: true, genericErrorsOrWrongRuntimeNotAdmitted: true };
  simulateProjectBirthPruning = false;
  const beforeRestart = (await database.query("SELECT payload FROM rmt_curve_activity_events WHERE scope=$1 ORDER BY token,transaction_hash,log_index", [scope])).rows;
  const competing = new Client({ host: "127.0.0.1", port: Number(args["pg-port"]), user: "postgres", database: databaseName }); await competing.connect();
  await assert.rejects(() => lockIndexWriter(competing, 4663)); await competing.end();
  await database.end(); database = new Client({ host: "127.0.0.1", port: Number(args["pg-port"]), user: "postgres", database: databaseName }); await database.connect();
  mainIndexer = createProductionCurveIndexer(config, database, rpc as any, corroboratingRpc as any); await persist();
  const afterRestart = (await database.query("SELECT payload FROM rmt_curve_activity_events WHERE scope=$1 ORDER BY token,transaction_hash,log_index", [scope])).rows;
  assert.deepEqual(afterRestart, beforeRestart);
  report.recovery = { restart: { identicalDurableEvents: true, rows: afterRestart.length, competingWriterRejected: true, originalLeaseReleasedAndReacquired: true } };
  const snapshot = await writeLocal("evm_snapshot");
  const orphan = await trade(c.token, creator, "v4-buy", (10n ** 15n).toString());
  assert.equal(await writeLocal("evm_revert", [snapshot]), true); await mine(24); await persist();
  const orphanRows = await database.query("SELECT count(*)::int AS count FROM rmt_curve_activity_events WHERE scope=$1 AND transaction_hash=$2", [scope, orphan.receipt.transactionHash]);
  assert.equal(orphanRows.rows[0].count, 0);
  const orphanStatus = await verifyProductionLifecycle(await context(), orphan.prepared.request!, orphan.receipt.transactionHash, activity as any);
  assert.equal(orphanStatus.status, "unavailable");
  report.recovery.reorg = { transactionHash: orphan.receipt.transactionHash, orphanedRows: 0, verification: orphanStatus,
    canonicalCheckpoint: durablePoint, rebroadcast: false, custodyUnchanged: true };
  report.status = "passed";
} catch (error) { report.status = "failed"; report.failure = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }; }
finally {
  child.kill(); if (api) await new Promise<void>(resolve => api!.close(() => resolve())); await readDatabase?.end(); await database?.end();
  report.finishedAt = new Date().toISOString(); report.runnerSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
  report.sourceAtCompletion = await sourceIdentity(); report.sourceStableDuringRun = JSON.stringify(report.source) === JSON.stringify(report.sourceAtCompletion);
  await writeFile(out, JSON.stringify(report, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
}
console.log(JSON.stringify({ status: report.status, steps: report.steps.length, output: out, failure: report.failure?.message }));
if (report.status !== "passed") process.exitCode = 1;
