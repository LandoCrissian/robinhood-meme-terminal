import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress, zeroAddress, type Address } from "viem";
import { createVNextExecutionIdentityAuthority, VNextExecutionIdentityConflictError, vNextExecutionIdentityErrorResponse } from "./vnext-execution-identity-authority";
import { readVNextCanonicalMarketInventory } from "./vnext-market-indexer";
import type { RobinhoodTokenIdentityEvidence } from "./universal-market-resolver";
import { ROBINHOOD_USDG_ADDRESS } from "../vnext/robinhood-assets";

const peep = getAddress("0x1111111111111111111111111111111111111111");
const unknown = getAddress("0x3333333333333333333333333333333333333333");
const credential = "execution-identity-test-credential-0123456789";
const sources = ["sushiswap-v2", "sushiswap-v3", "uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl"];
const manifest = `0x${"ab".repeat(32)}`;
const token = (address = peep, decimals = 18) => ({ address, name: "Peep", symbol: "PEEP", decimals, totalSupply: "1000" });

function page() {
  return {
    chainId: 4663, mode: "shadow", authoritative: false, sourceManifestHash: manifest,
    coverage: { complete: false, finalizedHead: null,
      sources: sources.map((sourceId) => ({ sourceId, status: "missing", indexedThrough: null })) },
    nextCursor: null,
    pools: [{
      sourceId: "uniswap-v2", protocol: "uniswap", version: 2,
      poolKey: `0x${"22".repeat(20)}`, poolAddress: `0x${"22".repeat(20)}`,
      token0: peep.toLowerCase(), token1: ROBINHOOD_USDG_ADDRESS.toLowerCase(),
      stable: null, fee: null, tickSpacing: null, hooks: null,
      transactionHash: manifest, blockNumber: "100", blockHash: manifest,
      stateStatus: null, liveFee: null, feeDenominator: null, gaugeAddress: null,
      gaugeAlive: null, gaugeWeight: null, gaugeClaimable: null, feesAddress: null,
      bribeAddress: null, stateError: null, stateObservedBlock: null, stateObservedBlockHash: null
    }],
    browseIdentities: { source: "verified-token-identity-index", freshness: "last-known", identities: [
      { address: peep.toLowerCase(), name: "Peep", symbol: "PEEP", decimals: 18 },
      { address: ROBINHOOD_USDG_ADDRESS.toLowerCase(), name: "Global Dollar", symbol: "USDG", decimals: 6 }
    ] }
  };
}

function harness(options: {
  body?: () => unknown;
  live?: (address: Address) => Promise<RobinhoodTokenIdentityEvidence>;
  waitInventory?: () => Promise<void>;
  deadlineMs?: number;
  inventoryDeadlineMs?: number;
  freshReadDeadlineMs?: number;
  maximumConflicts?: number;
  maximumPending?: number;
  maximumEntries?: number;
} = {}) {
  let inventoryReads = 0;
  let liveReads = 0;
  let clock = 100;
  const tasks: Array<() => Promise<void>> = [];
  const authority = createVNextExecutionIdentityAuthority({
    now: () => clock, revalidateAfterMs: 1, deadlineMs: options.deadlineMs,
    maximumPending: options.maximumPending, maximumEntries: options.maximumEntries,
    inventoryDeadlineMs: options.inventoryDeadlineMs, freshReadDeadlineMs: options.freshReadDeadlineMs,
    maximumConflicts: options.maximumConflicts,
    readInventory: (query, dependencies) => readVNextCanonicalMarketInventory(query, {
      ...dependencies,
      env: { RMT_MARKET_INDEXER_URL: "https://identity.test", RMT_MARKET_INDEXER_READ_TOKEN: credential },
      fetch: async (input, init) => {
        inventoryReads++;
        const url = new URL(input);
        assert.equal(url.searchParams.get("limit"), "16");
        assert.equal(url.searchParams.get("includeBrowseIdentities"), "true");
        assert.ok(url.searchParams.get("token"));
        assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${credential}`);
        await options.waitInventory?.();
        return new Response(JSON.stringify(options.body ? options.body() : page()));
      }
    }),
    readLive: async (address) => {
      liveReads++;
      return options.live ? options.live(address) : { status: "identity_read_unavailable" };
    }
  });
  return { ...authority, tasks,
    readOptions: { scheduleRevalidation: (task: () => Promise<void>) => { tasks.push(task); } },
    counts: () => ({ inventoryReads, liveReads }), advance: () => { clock += 10; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("cold restart: ETH->PEEP, PEEP->ETH and USDG pairs survive live unavailability", async () => {
  for (const [input, output] of [[zeroAddress, peep], [peep, zeroAddress],
    [ROBINHOOD_USDG_ADDRESS, peep], [peep, ROBINHOOD_USDG_ADDRESS]]) {
    const h = harness();
    const pair = await Promise.all([h.read(input as Address, h.readOptions), h.read(output as Address, h.readOptions)]);
    assert.ok(pair[0]); assert.ok(pair[1]);
    assert.equal(h.counts().liveReads, 0);
    for (const identity of pair) {
      assert.ok(identity);
      assert.equal(identity.chainId, 4663);
      assert.ok(identity.name);
      assert.equal(identity.provenance, identity.native ? "robinhood-native-asset" : "verified-token-identity-index");
    }
    await Promise.all(h.tasks.map((task) => task()));
    assert.deepEqual(await Promise.all([h.read(input as Address), h.read(output as Address)]), pair);
    assert.equal(h.counts().inventoryReads, pair.filter((identity) => !identity?.native).length);
  }
});

test("native and wrong chain never trigger ERC20 RPC; unknown falls back", async () => {
  const h = harness();
  assert.equal((await h.read(zeroAddress, h.readOptions))?.symbol, "ETH");
  assert.deepEqual(h.counts(), { inventoryReads: 0, liveReads: 0 });
  assert.equal(await h.read(peep, { ...h.readOptions, chainId: 1 }), null);
  assert.equal(await h.read(zeroAddress, { chainId: 1 }), null);
  assert.equal(await h.read("invalid" as Address), null);
  assert.equal(h.counts().liveReads, 0);
  assert.equal(await h.read(unknown, h.readOptions), null);
  assert.equal(h.tasks.length, 0);
  assert.equal(h.counts().liveReads, 1);
});

test("real inventory reader rejects malformed, untrusted and unbound persisted identity", async () => {
  const mutations: Array<(body: ReturnType<typeof page>) => unknown> = [
    (b) => ({ ...b, chainId: 1 }), (b) => ({ ...b, unexpected: true }),
    (b) => ({ ...b, browseIdentities: { ...b.browseIdentities, source: "external-labels" } }),
    (b) => ({ ...b, pools: [] }),
    (b) => ({ ...b, browseIdentities: { ...b.browseIdentities, identities: [
      ...b.browseIdentities.identities, { address: unknown, name: "Fake", symbol: "PEEP", decimals: 18 }
    ] } }),
    (b) => ({ ...b, browseIdentities: { ...b.browseIdentities, identities: [b.browseIdentities.identities[0], b.browseIdentities.identities[0]] } }),
    (b) => ({ ...b, browseIdentities: { ...b.browseIdentities, identities: [{ ...b.browseIdentities.identities[0], decimals: 1.5 }] } }),
    (b) => ({ ...b, browseIdentities: undefined })
  ];
  for (const mutate of mutations) {
    const h = harness({ body: () => mutate(page()) });
    assert.equal(await h.read(peep, h.readOptions), null);
    assert.equal(h.counts().liveReads, 1);
  }
});

test("concurrent cold reads coalesce inventory and lazy validation; warm reads do not wait for RPC", async () => {
  const live = deferred<RobinhoodTokenIdentityEvidence>();
  const h = harness({ live: () => live.promise });
  const identities = await Promise.all(Array.from({ length: 20 }, () => h.read(peep, h.readOptions)));
  assert.ok(identities.every(Boolean));
  assert.equal(h.counts().inventoryReads, 1);
  assert.equal(h.tasks.length, 1);
  const running = h.tasks[0]();
  assert.ok(await h.read(peep, h.readOptions));
  assert.equal(h.tasks.length, 1);
  live.resolve({ status: "identity_read_unavailable" });
  await running;
  await h.tasks[0]();
  assert.equal(h.counts().liveReads, 1);
});

test("positive invalid contract and decimal conflict are sticky against old durable evidence", async () => {
  for (const evidence of [
    { status: "not_erc20", reason: "no_contract" },
    { status: "not_erc20", reason: "invalid_metadata" },
    { status: "verified_token", token: token(peep, 6) }
  ] satisfies RobinhoodTokenIdentityEvidence[]) {
    const h = harness({ live: async () => evidence });
    assert.ok(await h.read(peep, h.readOptions));
    await h.tasks[0]();
    h.advance();
    await assert.rejects(h.read(peep, h.readOptions), VNextExecutionIdentityConflictError);
    assert.equal(h.counts().inventoryReads, 1);
    assert.equal(h.tasks.length, 1);
  }
});

test("positive conflict wins over stale in-flight durable and live reads", async () => {
  const gate = deferred<void>();
  const h = harness({ waitInventory: () => gate.promise });
  const loading = h.read(peep);
  h.blockOnPositiveConflict(peep, "contract_invalid");
  gate.resolve();
  await assert.rejects(loading, VNextExecutionIdentityConflictError);
  await assert.rejects(h.read(peep), VNextExecutionIdentityConflictError);

  const live = deferred<RobinhoodTokenIdentityEvidence>();
  const h2 = harness({ live: () => live.promise });
  await h2.read(peep, h2.readOptions);
  const running = h2.tasks[0]();
  h2.blockOnPositiveConflict(peep, "decimals_conflict");
  live.resolve({ status: "verified_token", token: token() });
  await running;
  await assert.rejects(h2.read(peep), VNextExecutionIdentityConflictError);
});

test("unavailable, thrown and misbound live evidence retain trusted names and decimals", async () => {
  for (const live of [
    async () => { throw new Error("RPC down"); },
    async () => ({ status: "verified_token", token: token(unknown, 6) } as const),
    async () => ({ status: "verified_token", token: { ...token(), name: "External label" } } as const)
  ]) {
    const h = harness({ live });
    const before = await h.read(peep, h.readOptions);
    await h.tasks[0]();
    assert.deepEqual(await h.read(peep), { ...before,
      freshness: (await live().catch(() => null))?.status === "verified_token"
        && (await live().catch(() => null))?.token.address === peep ? "current" : "last-known" });
    assert.equal((await h.read(peep))?.name, "Peep");
  }
});

test("lifecycle registration failures are contained and no hook starts no work", async () => {
  const h = harness();
  assert.ok(await h.read(peep));
  assert.equal(h.counts().liveReads, 0);
  assert.ok(await h.read(peep, { scheduleRevalidation: () => { throw new Error("No request scope"); } }));
  assert.ok(await h.read(peep, h.readOptions));
  assert.equal(h.tasks.length, 1);
  await h.tasks[0]();
});

test("deadline ignores late results and retains physical concurrency bound", async () => {
  const live = deferred<RobinhoodTokenIdentityEvidence>();
  const h = harness({ deadlineMs: 5, maximumPending: 1, live: () => live.promise });
  await h.read(peep, h.readOptions);
  await h.tasks[0]();
  h.advance();
  assert.ok(await h.read(ROBINHOOD_USDG_ADDRESS, h.readOptions));
  assert.equal(h.tasks.length, 1);
  assert.ok(await h.read(peep));
  live.resolve({ status: "not_erc20", reason: "no_contract" });
  await Promise.resolve();
  assert.ok(await h.read(peep));
});

test("ordinary cache eviction preserves conflicts independently", async () => {
  const h = harness({ maximumEntries: 1 });
  await h.read(peep);
  h.blockOnPositiveConflict(peep, "contract_invalid");
  assert.ok(await h.read(ROBINHOOD_USDG_ADDRESS));
  await assert.rejects(h.read(peep), VNextExecutionIdentityConflictError);
  assert.equal(h.counts().inventoryReads, 2);
});

test("bounded cold timeout cannot later publish an old durable result", async () => {
  const gate = deferred<void>();
  const h = harness({ inventoryDeadlineMs: 5, waitInventory: () => gate.promise });
  assert.equal(await h.read(peep), null);
  h.blockOnPositiveConflict(peep, "decimals_conflict");
  gate.resolve();
  await Promise.resolve();
  await assert.rejects(h.read(peep), VNextExecutionIdentityConflictError);
});

test("unknown healthy strict live identity is cached with truthful provenance", async () => {
  const h = harness({ live: async (address) => ({ status: "verified_token", token: token(address) }) });
  const values = await Promise.all(Array.from({ length: 12 }, () => h.read(unknown, h.readOptions)));
  assert.ok(values.every(Boolean));
  const identity = values[0]!;
  assert.equal(identity.address, unknown);
  assert.equal(identity.name, "Peep");
  assert.equal(identity.provenance, "verified-onchain-token-identity");
  assert.equal(identity.freshness, "current");
  assert.equal(identity.sourceManifestHash, null);
  assert.ok(Object.isFrozen(identity));
  assert.deepEqual(h.counts(), { inventoryReads: 1, liveReads: 1 });
  assert.equal(h.tasks.length, 0);
  assert.deepEqual(await h.read(unknown), identity);
});

test("unknown unavailable backs off; retry can establish live identity", async () => {
  let available = false;
  const h = harness({ live: async (address) => available
    ? { status: "verified_token", token: token(address) } : { status: "identity_read_unavailable" } });
  assert.equal(await h.read(unknown), null);
  assert.equal(await h.read(unknown), null);
  assert.deepEqual(h.counts(), { inventoryReads: 1, liveReads: 1 });
  available = true;
  for (let i = 0; i < 501; i++) h.advance();
  assert.equal((await h.read(unknown))?.provenance, "verified-onchain-token-identity");
});

test("unknown positive invalid contract throws typed safe 409", async () => {
  const h = harness({ live: async () => ({ status: "not_erc20", reason: "no_contract" }) });
  await assert.rejects(h.read(unknown), (cause: unknown) => {
    assert.ok(cause instanceof VNextExecutionIdentityConflictError);
    assert.equal(cause.reason, "contract_invalid");
    assert.equal(cause.code, "VNEXT_EXECUTION_IDENTITY_CONFLICT");
    return true;
  });
  const error = new VNextExecutionIdentityConflictError("decimals_conflict");
  error.message = "secret upstream details";
  const response = vNextExecutionIdentityErrorResponse(error)!;
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.phase, "IDENTITY_CONFLICT");
  assert.ok(!JSON.stringify(body).includes("secret"));
  assert.equal(vNextExecutionIdentityErrorResponse(new Error("RPC unavailable")), null);
});

test("strict fresh fallback rejects oversized metadata and accepts IDENTITYONLY", async () => {
  const bad = harness({ live: async (address) => ({ status: "verified_token", token: { ...token(address), symbol: "X".repeat(21) } }) });
  await assert.rejects(bad.read(unknown), VNextExecutionIdentityConflictError);
  const good = harness({ live: async (address) => ({ status: "verified_token", token: { ...token(address), symbol: "IDENTITYONLY" } }) });
  assert.equal((await good.read(unknown))?.symbol, "IDENTITYONLY");
});

test("unknown flood evicts ordinary entries without permanently excluding new identities", async () => {
  const h = harness({ maximumEntries: 2 });
  for (let index = 10; index < 20; index++) {
    assert.equal(await h.read(getAddress(`0x${index.toString(16).padStart(40, "0")}`)), null);
  }
  assert.ok(await h.read(peep));
  assert.ok(await h.read(ROBINHOOD_USDG_ADDRESS));
  assert.equal(h.counts().inventoryReads, 12);
});

test("ordinary positive LRU eviction permits cold durable recovery", async () => {
  const h = harness({ maximumEntries: 1 });
  assert.ok(await h.read(peep));
  assert.ok(await h.read(ROBINHOOD_USDG_ADDRESS));
  assert.ok(await h.read(peep));
  assert.equal(h.counts().inventoryReads, 3);
  assert.equal(h.counts().liveReads, 0);
});

test("conflict capacity fails closed without evicting a known conflict", async () => {
  const h = harness({ maximumConflicts: 1 });
  h.blockOnPositiveConflict(peep, "contract_invalid");
  h.blockOnPositiveConflict(unknown, "contract_invalid");
  await assert.rejects(h.read(peep), VNextExecutionIdentityConflictError);
  assert.equal(await h.read(ROBINHOOD_USDG_ADDRESS), null);
  assert.equal((await h.read(zeroAddress))?.native, true);
});

test("unknown live timeout backs off and late success cannot restore a conflict", async () => {
  const live = deferred<RobinhoodTokenIdentityEvidence>();
  const h = harness({ freshReadDeadlineMs: 5, live: () => live.promise });
  assert.equal(await h.read(unknown), null);
  h.blockOnPositiveConflict(unknown, "contract_invalid");
  live.resolve({ status: "verified_token", token: token(unknown) });
  await Promise.resolve();
  await assert.rejects(h.read(unknown), VNextExecutionIdentityConflictError);
});
