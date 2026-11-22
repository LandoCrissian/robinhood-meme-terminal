import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  encodeAbiParameters,
  parseAbiParameters,
  toFunctionSelector,
  toHex,
  zeroAddress,
} from "viem";
import {
  syntheticProductionConfig as config,
  syntheticProductionProposal as proposal,
} from "./curve-production-smoke.js";
import {
  curveProductionSchemaSql,
  initializeProductionCurveStore,
  commitProductionCurveRange,
  productionCurveScope,
} from "./curve-production-store.js";
import { productionActivitySchemaSql } from "./curve-production-activity.js";

const connectionString = process.env.DATABASE_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname) ||
  !new URL(connectionString).pathname.startsWith("/rmt_curve_production_smoke_")
)
  throw Error("Dedicated loopback database required");
const sql = new Client({ connectionString });
const alignedFixture = process.argv.includes("--empty-market");
const start = alignedFixture ? 215 : 3_841_724,
  legacy = "0x1111111111111111111111111111111111111111";
const auth = { Authorization: "Bearer synthetic-backfill-reader" };
let safe = start;
const hash = (height: number) => toHex(height, { size: 32 });
let blockTime = Math.floor(Date.now() / 1000);
const timestamp = (height: number) =>
  blockTime + Math.floor((height - start) / 10);
const answers = new Map<string, string>();
function getter(
  signature: string,
  type: "address" | "uint256",
  value: string | bigint,
) {
  answers.set(
    toFunctionSelector(signature),
    type === "address"
      ? encodeAbiParameters(parseAbiParameters("address"), [
          value as `0x${string}`,
        ])
      : encodeAbiParameters(parseAbiParameters("uint256"), [BigInt(value)]),
  );
}
for (const [fn, value] of Object.entries({
  protocolVersion: 6n,
  engineVersion: 1n,
  creationFeeWei: config.binding.creationFeeWei,
  tokenSupply: 10n ** 27n,
}))
  getter(fn + "()", "uint256", value);
for (const [fn, value] of Object.entries({
  creatorPayoutAuthority: legacy,
  policyRegistry: legacy,
  governance: legacy,
  canonicalProtocolTreasury: legacy,
  projectRegistry: proposal.projectRegistry,
  operatingRecipient: proposal.operatingRecipient,
  futureReserveRecipient: proposal.reserveRecipient,
}))
  getter(fn + "()", "address", value);

let fault: "429" | "503" | "timeout" | "resource" | null = null;
const asset = "0x2222222222222222222222222222222222222222";
const curve = "0x3333333333333333333333333333333333333333";
let mapped = false, disagree = false;
function marketCall(to: string, data: string) {
  if (to === proposal.factory.toLowerCase() && data === toFunctionSelector("curveForToken(address)") + asset.slice(2).padStart(64, "0"))
    return encodeAbiParameters(parseAbiParameters("address"), [mapped ? curve : zeroAddress]);
  if (mapped && to === curve) {
    const address = data === toFunctionSelector("token()") ? asset : data === toFunctionSelector("factory()") ? config.binding.factory : null;
    if (address) return encodeAbiParameters(parseAbiParameters("address"), [address]);
    for (const [signature,value] of Object.entries({
      "executionVersion()": 1n, "sold()": 0n, "backingReserve()": 0n, "poolId()": 0n, "graduated()": 0n,
      "graduationSold()": 600_000_000n * 10n**18n, "GRADUATION_BACKING()": 2n * 10n**18n,
    })) if (data === toFunctionSelector(signature)) return toHex(value, {size:32});
  }
  return answers.get(data);
}
const activityAttempts: string[] = [];
function provider(primary: boolean) {
  return createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { id, method, params = [] } = JSON.parse(raw);
    let result: unknown;
    if (method === "eth_blockNumber") result = toHex(safe + 20);
    else if (method === "eth_chainId") result = toHex(4663);
    else if (method === "eth_getCode") {
      const [addr, h] = params;
      result =
        addr.toLowerCase() === proposal.projectRegistry.toLowerCase()
          ? "0x6002"
          : addr.toLowerCase() === proposal.factory.toLowerCase()
            ? Number(h) < 100
              ? "0x"
              : "0x6001"
            : Number(h) === start - 1
              ? "0x"
              : "0x6000";
    } else if (method === "eth_getBlockByNumber") {
      const n = Number(params[0]);
      result = {
        number: toHex(n),
        timestamp: toHex(timestamp(n)),
        hash: hash(disagree && !primary && n === safe ? n+1 : n),
        parentHash: hash(n - 1),
        transactions: [],
      };
    } else if (method === "eth_call") result = marketCall(params[0].to.toLowerCase(), params[0].data);
    else if (method === "eth_getTransactionReceipt")
      result = {
        transactionHash: proposal.deploymentTransactionHash,
        status: "0x1",
        blockNumber: toHex(100),
        blockHash: hash(100),
        logs: [],
        transactionIndex: "0x0",
      };
    else if (method === "eth_getLogs") {
      const q = params[0];
      if (
        primary &&
        Number(q.fromBlock) < start &&
        [q.address]
          .flat()
          .some(
            (a: string) => a.toLowerCase() === proposal.factory.toLowerCase(),
          )
      ) {
        if (fault) {
          const failure = fault;
          activityAttempts.push(failure);
          if (failure === "timeout") {
            await wait(6500);
            res.end();
            return;
          }
          if (failure === "resource") {
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32002, message: "Resource unavailable" },
              }),
            );
            return;
          }
          res.writeHead(Number(failure));
          res.end();
          return;
        }
      }
      result = [];
    }
    if (result === undefined) {
      res.writeHead(400);
      res.end("Unsupported synthetic RPC method");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
}
async function listen(s: Server) {
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  return (s.address() as { port: number }).port;
}
async function until(task: () => Promise<boolean>, timeout = 90000) {
  const end = Date.now() + timeout;
  do {
    if (await task()) return;
    await wait(250);
  } while (Date.now() < end);
  throw Error("Timed out in worker HTTP acceptance");
}
const a = provider(true),
  b = provider(false),
  socket = createServer();
const port = await listen(socket);
await new Promise<void>((resolve) => socket.close(() => resolve()));
const ports = await Promise.all([listen(a), listen(b)]);
const url = "http://127.0.0.1:" + port;
let output = "";
const workers: ReturnType<typeof spawn>[] = [];
function boot() {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        PGSSLMODE: "disable",
        RMT_RPC_URL: "http://127.0.0.1:" + ports[0],
        RMT_ARCHIVE_RPC_URL: "http://127.0.0.1:" + ports[1],
        RMT_FACTORY_ADDRESS: legacy,
        RMT_FACTORY_START_BLOCK: String(start),
        RMT_INDEXER_READ_TOKEN: auth.Authorization.slice(7),
        RMT_CURVE_PRODUCTION_BINDING: JSON.stringify(proposal),
        RMT_INDEXER_POLL_MS: "500",
        RMT_INDEXER_CAUGHT_UP_POLL_MS: alignedFixture ? "30000" : "1000",
        RMT_INDEXER_ACTIVITY_INTERVAL_MS: "1000",
        PORT: String(port),
      },
    },
  );
  workers.push(child);
  child.stdout!.on("data", (c) => (output += c));
  child.stderr!.on("data", (c) => (output += c));
  return child;
}
const get = async (path: string, authorized = true) =>
  fetch(url + path, {
    headers: authorized ? auth : {},
    signal: AbortSignal.timeout(alignedFixture ? 8000 : 4000),
  });
let servingReads = 0;
async function verifyDiscovery() {
  const [health, ready, discovery] = await Promise.all([
    get("/health"),
    get("/ready"),
    get("/curve-launches"),
  ]);
  assert.deepEqual(
    [health.status, ready.status, discovery.status],
    [200, 200, 200],
  );
  const page = (await discovery.json()) as {
    status: string;
    checkpoint: { timestamp: string; blockNumber: string };
  };
  assert.equal(page.status, "ready");
  assert.ok(Date.now() - Date.parse(page.checkpoint.timestamp) < 120_000);
  const { feeds } = (await ready.json()) as {
    feeds: { activity: { status: string }; registration: { status: string } };
  };
  assert.ok(
    ["backfilling", "delayed", "pending"].includes(feeds.activity.status),
  );
  assert.equal(feeds.registration.status, "ready");
  servingReads++;
  return Number(page.checkpoint.blockNumber);
}
async function verifyBacklog() {
  fault = "429";
  const first = boot();
  await until(
    async () =>
      first.exitCode === null &&
      (await get("/health").then(
        (r) => r.ok,
        () => false,
      )),
  );
  const market = "/curve-market/" + proposal.factory + "?interval=60",
    activity = "/curve-activity?transactionHash=" + hash(77);
  for (const path of [market, activity]) {
    assert.equal((await get(path, false)).status, 401);
    assert.equal((await get(path)).status, 503);
  }
  for (const f of ["429", "503", "timeout", "resource"] as const) {
    fault = f;
    await until(async () => activityAttempts.includes(f));
    for (let n = 0; n < 4; n++) {
      await verifyDiscovery();
      await wait(550);
    }
    // Let each wire failure actually arrive before changing injection.
    await until(async () =>
      output.includes(
        f === "timeout"
          ? '"timeout":true'
          : f === "resource"
            ? '"rpcCode":-32002'
            : '"httpStatus":' + f,
      ),
    );
  }
  fault = null;
  safe += 10;
  await until(async () => {
    const ready = (await (await get("/ready")).json()) as {
      feeds: { registration: { checkpoint: { blockNumber: string } } };
    };
    return Number(ready.feeds.registration.checkpoint.blockNumber) === safe;
  });
  assert.equal(await verifyDiscovery(), safe);
  await until(
    async () =>
      Number(
        (await sql.query("SELECT next_block FROM rmt_curve_activity_bindings"))
          .rows[0]?.next_block,
      ) > 100,
  );
  const before = (
    await sql.query(
      "SELECT block_number::int AS n,block_hash FROM rmt_curve_activity_checkpoints ORDER BY block_number DESC LIMIT 1",
    )
  ).rows[0];
  const exited = once(first, "exit");
  first.kill();
  await exited;
  await until(
    async () =>
      (
        await sql.query(
          "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND objid=4663 AND granted",
        )
      ).rows[0].n === 0,
  );
  boot();
  await until(async () =>
    get("/health").then(
      (r) => r.ok,
      () => false,
    ),
  );
  await until(
    async () =>
      Number(
        (await sql.query("SELECT next_block FROM rmt_curve_activity_bindings"))
          .rows[0]?.next_block,
      ) >
      before.n + 1,
  );
  assert.equal(
    (
      await sql.query(
        "SELECT block_hash FROM rmt_curve_activity_checkpoints WHERE block_number=$1",
        [before.n],
      )
    ).rows[0].block_hash,
    before.block_hash,
  );
  assert.equal(
    (
      await sql.query(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND objid=4663 AND granted",
      )
    ).rows[0].n,
    1,
  );
  console.log(
    JSON.stringify({
      backlogBlocks: start - 100 + 1,
      servingReads,
      registration: safe,
      resumedAfter: before.n,
      observedFaults: [...new Set(activityAttempts)],
      singleWriter: true,
      anonymous: 401,
      marketDuringBackfill: 503,
    }),
  );
}
async function verifyEmptyMarket() {
  const market = "/curve-market/" + asset + "?interval=60";
  boot();
  await until(async () => get("/ready").then(async r => r.ok && ((await r.json()) as {feeds:{activity:{status:string}}}).feeds.activity.status === "ready", () => false));
  const absent = await get(market);
  assert.equal(absent.status, 404);
  const body = await absent.json();
  assert.deepEqual(body, {schemaVersion:1, chainId:4663, status:"not_found", token:asset,
    deployment:{factory:config.binding.factory, registry:config.binding.projectRegistry, blockNumber:"100", blockHash:hash(100)},
    checkpoint:{blockNumber:String(start), blockHash:hash(start), timestamp:new Date(timestamp(start)*1000).toISOString(),
      confirmations:20, finality:"l2-confirmed", l1Finality:"unverified"}});
  assert.equal((await get(market,false)).status,401);
  assert.equal((await fetch(url+market,{headers:{Authorization:"Bearer invalid"}})).status,401);
  for (const path of ["/curve-market/invalid","/curve-market/"+asset+"?interval=",market+"&interval=60","/curve-market/"+asset+"?interval=6e1",market+"&before=1"])
    assert.equal((await get(path)).status,400);
  const activity = await get("/curve-activity?transactionHash="+hash(77)); assert.equal(activity.status,200);
  assert.deepEqual(((await activity.json()) as {events: unknown[]}).events,[]);
  const unavailable = async () => {
    const r = await get(market); assert.equal(r.status,503);
    const data = await r.json() as {status:string; checkpoint:unknown}; assert.equal(data.status,"unavailable"); assert.equal(data.checkpoint,null);
  };
  mapped = true;
  await unavailable(); // Registration store and on-chain factory contradict one another.
  const scope = productionCurveScope(config);
  await sql.query("INSERT INTO rmt_curve_production_launches VALUES($1,$2,$3,0,$4,$5,$6)",[scope,asset,hash(123),start,hash(start),
    {token:asset, chainId:4663, factory:config.binding.factory, projectRegistry:config.binding.projectRegistry, initialCurve:curve}]);
  const empty = await get(market); assert.equal(empty.status,200);
  const snapshot = await empty.json() as {candles:unknown[]; soldWei:string; backingWei:string}; assert.deepEqual(snapshot.candles,[]); assert.equal(snapshot.soldWei,"0"); assert.equal(snapshot.backingWei,"0");
  await sql.query("DELETE FROM rmt_curve_production_launches WHERE scope=$1 AND token=$2",[scope,asset]); mapped=false;
  await sql.query("UPDATE rmt_curve_activity_checkpoints SET block_hash=$1 WHERE block_number=$2",[hash(start+8),start]);
  await unavailable();
  await sql.query("UPDATE rmt_curve_activity_checkpoints SET block_hash=$1 WHERE block_number=$2",[hash(start),start]);
  disagree=true; await unavailable(); disagree=false;
  // Force a real SELECT failure in the disposable cluster.
  await sql.query("ALTER TABLE rmt_curve_production_launches RENAME TO fixture_unavailable");
  try { await unavailable(); } finally { await sql.query("ALTER TABLE fixture_unavailable RENAME TO rmt_curve_production_launches"); }
  blockTime -= 180; safe++;
  await until(async () => ((await (await get("/ready")).json()) as {feeds:{registration:{status:string}}}).feeds.registration.status === "stale");
  await unavailable();
  console.log("Aligned zero-token catalog 404 with proof; registered/no trades 200; activity empty 200; auth 401; invalid 400; SQL, provider, cursor and factory disagreement 503.");
}
try {
  await sql.connect();
  assert.equal(
    (
      await sql.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
      )
    ).rows[0].n,
    0,
  );
  await sql.query(curveProductionSchemaSql + productionActivitySchemaSql);
  await initializeProductionCurveStore(sql, config);
  // A restored registration cursor near head and an empty activity store are fixture inputs.
  await commitProductionCurveRange(
    sql,
    config,
    100n,
    {
      blockNumber: String(start),
      blockHash: hash(start),
      timestamp: new Date(timestamp(start) * 1000).toISOString(),
    },
    [],
  );
  await sql.query("SELECT pg_advisory_unlock_all()");
  if (alignedFixture) await verifyEmptyMarket();
  else await verifyBacklog();
} catch (error) {
  console.error(JSON.stringify({ fault, activityAttempts }));
  console.error(
    output
      .split("\n")
      .filter((line) => !line.includes("indexer_feeds"))
      .slice(-35)
      .join("\n"),
  );
  throw error;
} finally {
  for (const proc of workers)
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
  a.closeAllConnections();
  b.closeAllConnections();
  a.close();
  b.close();
  await sql.end();
}
