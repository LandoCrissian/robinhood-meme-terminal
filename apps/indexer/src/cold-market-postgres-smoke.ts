import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Client } from "pg";
import {
  toEventSelector,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { curveCreationAbi } from "./curve-launch-evidence.js";
import type { CurveProductionConfig } from "./curve-production-config.js";
import { createProductionCurveIndexer } from "./curve-production.js";
import { productionCurveScope } from "./curve-production-store.js";
import {
  marketReadSignal,
  marketRequestId,
  providerBudget,
  rpcFeed,
} from "./feed-scheduler.js";
import { marketWordReader } from "./market-rpc.js";

// Run only inside the existing isolated PostgreSQL birth/restart fixture.
export async function coldMarketSmoke(
  db: Client,
  config: CurveProductionConfig,
  peers: PublicClient[],
) {
  const reg = 121597188n,
    activity = 121596200n,
    historical = 121597154n;
  const token: Address = "0xe7a2d4967b8e108927daeec6375fd0d015d5364c";
  const curve = "0x60c4c8ab81ed95aebaeb9d7bb59b16a479904f85";
  const factory = config.binding.factory.toLowerCase(),
    scope = productionCurveScope(config);
  const hash = (n: bigint) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
  const clock = Date.now(),
    seconds = BigInt(Math.floor(clock / 1000));
  const timestamp = (n: bigint) => seconds - (reg - n) / 10n;
  const date = (n: bigint) => new Date(Number(timestamp(n)) * 1000);
  const creation = activity - 5n;
  // Adjacent coverage around the first synthetic receipt; no registration
  // checkpoint exists at the activity tip (independent commit boundaries).
  for (const [feed, height] of [
    ["production", reg],
    ["activity", activity],
  ] as const) {
    await db.query(
      "UPDATE rmt_curve_" + feed + "_bindings SET next_block=$2 WHERE scope=$1",
      [scope, String(height + 1n)],
    );
    await db.query(
      "INSERT INTO rmt_curve_" + feed + "_checkpoints VALUES($1,$2,$3,$4)",
      [scope, String(height), hash(height), date(height)],
    );
  }
  await db.query(
    "INSERT INTO rmt_curve_activity_checkpoints VALUES($1,$2,$3,$4)",
    [scope, String(creation - 1n), hash(creation - 1n), date(creation - 1n)],
  );
  const registration = {
    token,
    chainId: 4663,
    factory,
    projectRegistry: config.binding.projectRegistry,
    initialCurve: curve,
  };
  await db.query(
    "INSERT INTO rmt_curve_production_launches VALUES($1,$2,$3,0,$4,$5,$6)",
    [scope, token, hash(1n), String(creation), hash(creation), registration],
  );
  await db.query(
    "INSERT INTO rmt_curve_activity_events VALUES($1,$2,$3,0,$4,$5,$6)",
    [
      scope,
      token,
      hash(1n),
      String(creation),
      hash(creation),
      { address: factory, topics: [toEventSelector(curveCreationAbi[5])] },
    ],
  );
  const values: Record<string, string | bigint> = {
    token,
    factory,
    executionVersion: 1n,
    graduated: 0n,
    sold: 0n,
    backingReserve: 0n,
    poolId: 0n,
    graduationSold: 600000000n * 10n ** 18n,
    GRADUATION_BACKING: 2n * 10n ** 18n,
  };
  const getters = new Map(
    Object.entries(values).map(([k, v]) => [
      toFunctionSelector(k + "()"),
      BigInt(v),
    ]),
  );
  const counts: number[][] = [[], []];
  let fault = true,
    fork = false,
    shift = 0;
  let transportFault: "none" | "timeout" | "429" | "reject" | "duplicate" =
    "none";
  const budgets = [
    providerBudget("primary", 400, () => 0),
    providerBudget("archive", 400, () => 0),
  ];

  const server = createServer(async (req, res) => {
    const peer = req.url === "/archive" ? 1 : 0;
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    const batch = Array.isArray(body) ? body : [body];
    counts[peer]!.push(batch.length);
    res.setHeader("content-type", "application/json");
    if (peer && transportFault === "timeout") {
      transportFault = "none";
      return;
    }
    if (peer && transportFault === "429") {
      transportFault = "none";
      res.writeHead(429);
      res.end();
      return;
    }
    if (peer && transportFault === "reject") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: batch[0].id,
          error: { code: -32601 },
        }),
      );
      return;
    }
    if (peer && transportFault === "duplicate" && batch.length > 1)
      batch[1].id = batch[0].id;

    const replies = batch
      .map(
        (x: {
          id: number;
          method: string;
          params: [
            { to: string; data: Hex },
            { blockHash: Hex; requireCanonical: boolean },
          ];
        }) => {
          assert.equal(x.method, "eth_call");
          assert.equal(x.params[1].blockHash, hash(activity));
          assert.equal(x.params[1].requireCanonical, true);
          if (peer && fault && batch.length === 3 && x.id === 1) {
            fault = false;
            return {
              id: x.id,
              jsonrpc: "2.0",
              error: { code: -32002, message: "resource unavailable" },
            };
          }
          const value =
            x.params[0].to.toLowerCase() === factory
              ? BigInt(curve)
              : getters.get(x.params[0].data);
          assert.notEqual(value, undefined);
          return {
            id: x.id,
            jsonrpc: "2.0",
            result: "0x" + value!.toString(16).padStart(64, "0"),
          };
        },
      )
      .reverse();
    res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const clients = peers.map((peer, i) => ({
      ...peer,
      getBlockNumber: async () => reg + 20n,
      getBlock: async (args: { blockNumber: bigint }) =>
        args.blockNumber < activity - 1000n
          ? peer.getBlock(args)
          : {
              number: args.blockNumber,
              hash: hash(
                args.blockNumber +
                  (fork && i === 1 && args.blockNumber === activity ? 1n : 0n),
              ),
              timestamp: timestamp(args.blockNumber),
            },
      readMarketWords: marketWordReader(
        "http://127.0.0.1:" + address.port + (i ? "/archive" : "/primary"),
        budgets[i]!,
        new AbortController().signal,
      ),
    })) as unknown as [PublicClient, PublicClient];
    let worker = createProductionCurveIndexer(
      config,
      db,
      ...clients,
      () => clock + shift,
    );
    await worker.syncOnce();
    assert.equal(worker.state().status, "ready");
    assert.equal(worker.marketAnchor().point, null);
    const read = (id: string) =>
      marketRequestId.run(id, () =>
        marketReadSignal.run(AbortSignal.timeout(7000), () =>
          rpcFeed.run("market", () =>
            worker.readMarket(db, { token, interval: 60 }),
          ),
        ),
      );
    const start = performance.now();
    const responses = await Promise.all([read("first"), read("overlap")]);
    for (const result of responses) {
      assert.equal(result.status, "ready");
      assert.equal(result.checkpoint.blockNumber, String(activity));
      assert.deepEqual(result.candles, []);
    }
    const ms = Math.round(performance.now() - start);
    assert.ok(ms < 8000);
    assert.deepEqual(counts, [
      [1, 3, 3, 3],
      [1, 3, 1, 3, 3],
    ]);
    const durations = [ms];
    // Each process starts without an in-memory activity point, with a competing
    // background slot and a completed registration checkpoint ahead of activity.
    for (let i = 1; i < 10; i++) {
      worker = createProductionCurveIndexer(
        config,
        db,
        ...clients,
        () => clock + shift,
      );
      await worker.syncOnce();
      const load = budgets.map((b) =>
        rpcFeed.run("activity", () =>
          b.request(
            "eth_blockNumber",
            () => new Promise((resolve) => setTimeout(resolve, 80)),
          ),
        ),
      );
      if (i === 1) transportFault = "429";
      if (i === 2) transportFault = "timeout";
      const began = performance.now();
      const result = await read("restart-" + i);
      durations.push(Math.round(performance.now() - began));
      assert.equal(result.status, "ready");
      assert.equal(result.checkpoint.blockNumber, String(activity));
      await Promise.all(load);
    }
    assert.ok(durations.every((v) => v < 8000));
    console.info(
      JSON.stringify({ test: "concurrent_backfill_restart", durations }),
    );
    transportFault = "reject";
    await assert.rejects(read("unsupported"), { code: -32601 });
    transportFault = "duplicate";
    await assert.rejects(read("malformed"), /batch identity/);
    transportFault = "none";
    await assert.rejects(
      worker.readMarket(db, { token: curve, interval: 60 }),
      { message: "absence_cursor_alignment" },
    );
    fork = true;
    await assert.rejects(read("reorg"), { message: "canonical_block" });
    fork = false;
    shift = 30000;
    await assert.rejects(read("aged"), { message: "activity_anchor_missing" });
    console.info(
      JSON.stringify({
        test: "cold_market",
        reg: String(reg),
        activity: String(activity),
        historicalReference: String(historical),
        initialArchiveBatches: [1, 3, 1, 3, 3],
        ms,
      }),
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
