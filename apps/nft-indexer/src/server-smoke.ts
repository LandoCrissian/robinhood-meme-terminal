import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import type { NftIndexerWorker } from "./worker.js";
import { createNftIndexerServer } from "./server.js";

const token = "a".repeat(64);
const worker = { status: { lastError: null } } as unknown as NftIndexerWorker;
const pool = { query: async () => { throw new Error("database must not be reached without authorization"); } } as unknown as Pool;
const server = createNftIndexerServer(worker, pool, token);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const port = (server.address() as AddressInfo).port;
  const unauthorized = await fetch(`http://127.0.0.1:${port}/internal/v1/projects/ccff00/onchain`);
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.text()).includes(token), false);
  const queryToken = await fetch(`http://127.0.0.1:${port}/internal/v1/projects/ccff00/onchain?token=${token}`);
  assert.equal(queryToken.status, 404);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
console.info("nft-indexer internal read authorization smoke: PASS");
