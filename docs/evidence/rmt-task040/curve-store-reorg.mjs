import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const indexer = new URL("../../../apps/indexer/", import.meta.url);
const { Client } = createRequire(new URL("package.json", indexer))("pg");
const {
  commitCurveFixtureRange, curveScope, fixtureCheckpoint, initializeCurveFixtureStore,
  loadCurveFixtureCursors, readCurveFixtureRows, rollbackCurveFixture, storedCurveCheckpoints,
} = await import(new URL("dist/curve-fixture-store.js", indexer));

const [postgresBin] = process.argv.slice(2);
assert.ok(postgresBin && process.argv.length === 3, "Usage: node curve-store-reorg.mjs /path/to/postgresql/bin");
const tool = (name) => join(resolve(postgresBin), process.platform === "win32" ? name + ".exe" : name);
const start = (name, args) => new Promise((resolve, reject) => {
  const process = spawn(tool(name), args, { stdio: "ignore", windowsHide: true });
  process.once("error", reject);
  process.once("close", (code) => code === 0 ? resolve() : reject(new Error(name + " exited with " + code)));
});

const server = createServer();
const port = await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});
const temporary = await mkdtemp(join(tmpdir(), "rmt-task040-db-"));
const cluster = join(temporary, "cluster");
const passwordFile = join(temporary, "init-password");
const database = "rmt_curve_fixture_review";
const user = "rmt_fixture";
const password = randomBytes(24).toString("hex");
const connect = (database) => new Client({ host: "127.0.0.1", port, user, password, database, connectionTimeoutMillis: 5_000 });
const admin = connect("postgres");
const writer = connect(database);
const reader = connect(database);
let started = false;
let readerConnected = false;
let writerConnected = false;
let adminConnected = false;

const hash = (value) => "0x" + value.toString(16).padStart(64, "0");
const addr = (value) => "0x" + value.toString(16).padStart(40, "0");
const block = (number, identity) => ({
  blockNumber: String(number), blockHash: hash(identity), timestamp: new Date(number * 1000).toISOString(),
});
const anchor = block(100, 1);
const creationBlock = block(101, 2);
const originalBranch = block(102, 3);
const replacement = block(102, 4);
const profile = "task036-local-only";
const binding = {
  chainId: 31337, engineVersion: 1, profile, confirmations: 2, factory: addr(17), projectRegistry: addr(18),
  deploymentBlock: 100n, deploymentBlockHash: anchor.blockHash, factoryRuntimeHash: hash(18),
  projectRegistryRuntimeHash: hash(19), creationFeeWei: 400000000000000n, creationFeeRecipient: addr(19),
};
const authority = { graduationEngine: addr(20), graduationHash: hash(20), guard: addr(8192), guardHash: hash(21) };
const scope = curveScope(binding);
const assetAddress = addr(1001);
const creator = addr(22);
const curve = addr(23);
const supply = "1000000000000000000000000";
const log = (at, transaction, logIndex) => ({ ...at, transactionHash: hash(transaction), logIndex });
const launch = {
  kind: "curve-launch-v1", status: "created", chainId: 31337, engineVersion: 1, factory: binding.factory,
  projectRegistry: binding.projectRegistry, token: assetAddress, initialCurve: curve, creator, revenueLedger: addr(24),
  totalSupplyWei: supply, intentId: hash(30), name: "PostgreSQL evidence fixture", symbol: "FIX",
  projectURI: "", treasury: null, treasuryShareBps: 0, creation: log(creationBlock, 1020, 0),
  projectRegistrationLogIndex: 1, creationFee: { amountWei: "400000000000000", refundWei: "0", recipient: binding.creationFeeRecipient, logIndex: 2 },
  checkpoint: fixtureCheckpoint(creationBlock),
};
const amounts = { nativeWei: "6", tokenWei: "7" };
const zero = { nativeWei: "0", tokenWei: "0" };
const graduationProof = {
  ...log(originalBranch, 1030, 0), poolId: hash(31), positionTokenId: "1", owner: authority.graduationEngine,
  poolKey: { currency0: addr(0), currency1: assetAddress, fee: 3000, tickSpacing: 60, hooks: authority.guard },
  liquidityWei: "100", nativeUsedWei: "2000000000000000000", tokenUsedWei: "400000000000000000000000",
  nativeDustWei: "0", tokenDustWei: "0", poolManager: addr(25), positionManager: addr(26), sqrtPriceX96: "31",
};
const collection = { ...log(originalBranch, 1031, 1), ...amounts, kind: "lp-collect", account: creator };
const nativeClaim = { ...log(originalBranch, 1032, 2), nativeWei: "6", tokenWei: "0", kind: "lp-claim", account: creator };
const state = (observed, graduated = false) => ({
  phase: graduated ? "graduated" : "curve", activeCurve: curve, observed,
  backingWei: "0", soldWei: "0", inventoryWei: graduated ? "0" : supply,
  graduationBackingWei: "2000000000000000000", graduationSoldWei: "600000000000000000000000", feeBps: 100,
  ...(graduated ? {
    graduation: { ...graduationProof, spotSqrtPriceX96: "31", spotTick: 0, poolLiquidityWei: "100" },
    postGraduation: { ledger: addr(27), router: addr(28), permit2: addr(29), quoter: addr(30),
      uncollected: zero, accrued: amounts, claimed: { nativeWei: "6", tokenWei: "0" }, balances: { nativeWei: "0", tokenWei: "7" }, beneficiaries: [] },
  } : {}),
});
const scoped = (evidence) => ({ token: assetAddress, evidence });
const range = (contents) => ({
  blocks: [], launches: [], trades: [], graduations: [], postEvents: [], states: [], ...contents,
});
const read = (at) => readCurveFixtureRows(reader, scope, at, assetAddress);

try {
  await writeFile(passwordFile, password + "\n", { mode: 0o600, flag: "wx" });
  try {
    await start("initdb", ["-D", cluster, "-U", user, "-A", "scram-sha-256", "--pwfile", passwordFile, "--no-locale"]);
  } finally {
    await unlink(passwordFile);
  }
  await appendFile(join(cluster, "postgresql.conf"), "\nunix_socket_directories = ''\n");
  const serverLog = join(temporary, "postgres.log");
  try {
    await start("pg_ctl", ["-D", cluster, "-l", serverLog, "-o", "-h 127.0.0.1 -p " + port, "-w", "-t", "12", "start"]);
  } catch (error) {
    const log = await readFile(serverLog, "utf8").catch(() => "");
    throw new Error("PostgreSQL fixture failed to start.\n" + log.slice(-2000), { cause: error });
  }
  started = true;
  await admin.connect();
  adminConnected = true;
  const { rows: [server] } = await admin.query("SELECT version(), host(inet_server_addr()) AS host");
  assert.equal(server.host, "127.0.0.1");
  await admin.query("CREATE DATABASE " + database);
  await writer.connect();
  writerConnected = true;
  await reader.connect();
  readerConnected = true;
  await writer.query(`CREATE TABLE rmt_curve_fixture_marker (identity text PRIMARY KEY);
    INSERT INTO rmt_curve_fixture_marker VALUES ('task036-local-only');`);
  await initializeCurveFixtureStore(writer, database, binding, authority);

  await commitCurveFixtureRange(writer, scope, range({
    blocks: [anchor, creationBlock], launches: [launch], states: [scoped(state(creationBlock))],
  }));
  const branch = range({
    blocks: [originalBranch], graduations: [scoped(graduationProof)],
    postEvents: [scoped(collection), scoped(nativeClaim)], states: [scoped(state(originalBranch, true))],
  });

  // Both a new checkpoint and valid preliminary events precede the invalid row in the same transaction.
  await assert.rejects(commitCurveFixtureRange(writer, scope, {
    ...branch, postEvents: [...branch.postEvents, scoped({ ...nativeClaim, blockHash: hash(999), transactionHash: hash(999), logIndex: 4 })],
  }), { code: "23503" });
  assert.deepEqual(await storedCurveCheckpoints(reader, scope, 2), [creationBlock, anchor]);
  const [preBranch] = await loadCurveFixtureCursors(reader, scope);
  assert.equal(preBranch.graduation, undefined);
  assert.deepEqual(preBranch.postEvents, []);
  await commitCurveFixtureRange(writer, scope, branch);
  await assert.rejects(commitCurveFixtureRange(writer, scope, branch), { code: "23505" });
  const oldRows = await read(originalBranch);
  assert.deepEqual(oldRows[0].lifecycle.postGraduation.events, [nativeClaim, collection]);

  await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    assert.deepEqual(await read(originalBranch), oldRows);
    await rollbackCurveFixture(writer, scope, 101n);
    await commitCurveFixtureRange(writer, scope, range({ blocks: [replacement], states: [scoped(state(replacement))] }));
    assert.deepEqual(await read(originalBranch), oldRows);
    await assert.rejects(read(replacement), /row identity mismatch/);
  } finally {
    await reader.query("ROLLBACK");
  }

  // A new snapshot sees just the new branch. Reusing the orphan checkpoint cannot publish a mixed row.
  await assert.rejects(read(originalBranch), /row identity mismatch/);
  const [active] = await read(replacement);
  assert.deepEqual(active.creation, launch.creation);
  assert.deepEqual(active.checkpoint, fixtureCheckpoint(replacement));
  assert.equal(active.checkpoint.l1Finality, "unverified");
  assert.equal(active.lifecycle.phase, "curve");
  assert.equal(active.lifecycle.postGraduation, undefined);
  const [cursor] = await loadCurveFixtureCursors(reader, scope);
  assert.equal(cursor.graduation, undefined);
  assert.deepEqual(cursor.postEvents, []);
  assert.deepEqual(await storedCurveCheckpoints(reader, scope, 3), [replacement, creationBlock, anchor]);
  console.log(JSON.stringify({
    engine: server.version.split(" on ")[0], blockRange: "100–102", loopback: true, chainId: 31337,
    checks: ["foreign-key batch rollback", "duplicate range rollback", "old snapshot isolation",
      "replacement checkpoint proof", "orphan checkpoint rejection", "fee and graduation removal", "registration retained"],
  }, null, 2));
} finally {
  if (readerConnected) await reader.end();
  if (writerConnected) await writer.end();
  if (adminConnected) await admin.end();
  if (started) await start("pg_ctl", ["-D", cluster, "-w", "-t", "12", "-m", "fast", "stop"]);
  await rm(temporary, { recursive: true, force: true });
}
