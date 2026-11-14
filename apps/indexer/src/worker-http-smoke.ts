import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { encodeFunctionData, encodeFunctionResult, toHex } from "viem";
import { factoryReadAbi, policyRegistryReadAbi } from "./abi.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Use a dedicated loopback PostgreSQL database for the worker HTTP smoke");
}

const address = (digit: string) => ("0x" + digit.repeat(40)) as `0x${string}`;
const factory = address("1");
const policy = address("2");
const governance = address("3");
const start = 100;
const chainId = 4663;
const auth = { Authorization: "Bearer isolated-history-fixture" };
const contractResults = new Map([
  [encodeFunctionData({ abi: factoryReadAbi, functionName: "protocolVersion" }),
    encodeFunctionResult({ abi: factoryReadAbi, functionName: "protocolVersion", result: 6 })],
  [encodeFunctionData({ abi: factoryReadAbi, functionName: "creatorPayoutAuthority" }),
    encodeFunctionResult({ abi: factoryReadAbi, functionName: "creatorPayoutAuthority", result: governance })],
  [encodeFunctionData({ abi: factoryReadAbi, functionName: "policyRegistry" }),
    encodeFunctionResult({ abi: factoryReadAbi, functionName: "policyRegistry", result: policy })],
  [encodeFunctionData({ abi: policyRegistryReadAbi, functionName: "governance" }),
    encodeFunctionResult({ abi: policyRegistryReadAbi, functionName: "governance", result: governance })],
  [encodeFunctionData({ abi: policyRegistryReadAbi, functionName: "canonicalProtocolTreasury" }),
    encodeFunctionResult({ abi: policyRegistryReadAbi, functionName: "canonicalProtocolTreasury", result: governance })],
]);
let headAvailable = false;
let latestHead = start + 20;
let headCalls = 0;
function resultFor(method: string, params: unknown[]) {
  if (method === "eth_blockNumber") {
    headCalls += 1;
    return headCalls <= 2 || headAvailable ? toHex(latestHead) : null;
  }
  if (method === "eth_getCode") return params[1] === toHex(start - 1) ? "0x" : "0x6000";
  if (method === "eth_call") return contractResults.get((params[0] as { data: `0x${string}` }).data) ?? null;
  if (method === "eth_getLogs") return [];
  if (method === "eth_getBlockByNumber") return {
    number: toHex(start), timestamp: toHex(1_795_000_000), hash: "0x" + "4".repeat(64),
    parentHash: "0x" + "5".repeat(64), transactions: [],
  };
  return null;
}

const rpc = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk.toString();
  const rpcRequest = JSON.parse(body) as { id: number; method: string; params: unknown[] };
  const result = resultFor(rpcRequest.method, rpcRequest.params);
  response.setHeader("Content-Type", "application/json");
  if (result === null) {
    response.statusCode = 503;
    response.end("fixture unavailable");
  } else {
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpcRequest.id, result }));
  }
});
const database = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 });
const workers: ChildProcess[] = [];
let output = "";
function startWorker(port: number, rpcPort: number) {
  const worker = spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url))], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RMT_RPC_URL: "http://127.0.0.1:" + rpcPort,
      RMT_ARCHIVE_RPC_URL: "http://127.0.0.1:" + rpcPort,
      RMT_FACTORY_ADDRESS: factory,
      RMT_FACTORY_START_BLOCK: String(start),
      RMT_INDEXER_READ_TOKEN: auth.Authorization.substring("Bearer ".length),
      RMT_CONFIRMATION_DEPTH: "20",
      RMT_INDEXER_POLL_MS: "500",
      PGSSLMODE: "disable",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  workers.push(worker);
  worker.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  worker.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  return worker;
}
async function freePort() {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}
async function until(check: () => Promise<boolean>) {
  const untilTime = Date.now() + 15_000;
  while (Date.now() < untilTime) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error("Worker fixture failed condition\n" + output);
}

try {
  assert.equal((await database.query("SELECT to_regclass('public.indexer_state') AS old")).rows[0]?.old, null,
    "use a new fixture database");
  await new Promise<void>((resolve) => rpc.listen(0, "127.0.0.1", resolve));
  const rpcPort = (rpc.address() as { port: number }).port;
  const port = await freePort();
  const url = "http://127.0.0.1:" + port;
  const first = startWorker(port, rpcPort);
  await until(async () => fetch(url + "/ready").then((response) => response.status === 200, () => false));
  const readiness = await fetch(url + "/ready");
  assert.equal((await readiness.json() as { initialSyncComplete: boolean }).initialSyncComplete, false);
  assert.equal((await fetch(url + "/health")).status, 503);
  assert.equal((await fetch(url + "/historical-launches")).status, 401);
  assert.equal((await fetch(url + "/historical-launches", { headers: auth })).status, 503);
  assert.equal((await fetch(url + "/historical-launches", { method: "POST", headers: auth })).status, 405);

  headAvailable = true;
  const overlapping = startWorker(await freePort(), rpcPort);
  await until(async () => overlapping.exitCode !== null);
  assert.equal(overlapping.exitCode, 1);
  assert.match(output, /database_writer_conflict/);
  await until(async () => (await fetch(url + "/health")).status === 200);
  const saved = await database.query("SELECT next_block FROM indexer_state WHERE chain_id = $1", [chainId]);
  assert.equal(saved.rows[0]?.next_block, "101");

  first.kill();
  await until(async () => first.exitCode !== null || first.signalCode !== null);
  latestHead -= 1;
  const ahead = startWorker(port, rpcPort);
  await until(async () => ahead.exitCode !== null);
  assert.equal(ahead.exitCode, 1);
  assert.match(output, /database_checkpoint_ahead/);
  assert.equal((await database.query("SELECT next_block FROM indexer_state")).rows[0]?.next_block, "101");

  latestHead += 1;
  const restarted = startWorker(port, rpcPort);
  await until(async () => fetch(url + "/health").then((response) => response.status === 200, () => false));
  const checkpoint = await database.query("SELECT count(*)::int AS count FROM sync_points WHERE chain_id = $1", [chainId]);
  assert.equal(checkpoint.rows[0]?.count, 1);
  restarted.kill();
  console.info("Worker readiness, authorization, single writer, and durable restart smoke passed.");
} finally {
  for (const worker of workers) if (worker.exitCode === null && worker.signalCode === null) worker.kill();
  rpc.close();
  await database.end();
}
