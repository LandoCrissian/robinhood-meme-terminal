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
} from "viem";
import {
  syntheticProductionConfig as config,
  syntheticProductionProposal as proposal,
} from "./curve-production-smoke.js";
import {
  curveProductionSchemaSql,
  initializeProductionCurveStore,
  commitProductionCurveRange,
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
const start = 3_841_724,
  legacy = "0x1111111111111111111111111111111111111111";
const auth = { Authorization: "Bearer synthetic-backfill-reader" };
let safe = start;
const hash = (height: number) => toHex(height, { size: 32 });
const blockTime = Math.floor(Date.now() / 1000);
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
        hash: hash(n),
        parentHash: hash(n - 1),
        transactions: [],
      };
    } else if (method === "eth_call") result = answers.get(params[0].data);
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
        RMT_INDEXER_CAUGHT_UP_POLL_MS: "1000",
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
    signal: AbortSignal.timeout(4000),
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
