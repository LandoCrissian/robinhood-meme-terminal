import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LaunchDiscovery } from "../../app/launches/launch-discovery";
import {
  readLaunchIntelligence,
  readLaunchSourceAvailability,
  launchEvidenceSchema,
} from "./launch-intelligence-reader";
import {
  launchNavigationHref,
  launchTerminalEntry,
} from "../vnext/launch-presentation";
import {
  searchVNextUniversalMarkets,
  type VNextUniversalMarketSearchDependencies,
} from "./vnext-universal-market-search";
import type { LaunchDirectory } from "@rmt/shared/launch-intelligence";
async function main() {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../../market-indexer/fixtures/launch-presentation-evidence.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const directory = fixture.directory as LaunchDirectory;
  const row = directory.entries[0]!;
  const env = {
    NODE_ENV: "test" as const,
    RMT_MARKET_INDEXER_URL: "https://launch-read.example/internal",
    RMT_MARKET_INDEXER_READ_TOKEN: "controlled-reader-token-000000000000000001",
  };
  let requested: URL | undefined;
  const read = (value: unknown, query = {}) =>
    readLaunchIntelligence(query, {
      env,
      fetch: async (input, init) => {
        requested = new URL(String(input));
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          `Bearer ${env.RMT_MARKET_INDEXER_READ_TOKEN}`,
        );
        return Response.json(value);
      },
    });
  assert.equal((await read(directory)).entries.length, 10);
  assert.equal(requested!.pathname, "/internal/v1/launches");
  // Controlled replay regression: page one contains only newer Pons records,
  // while older StonkBrokers evidence is discoverable through a bounded query.
  const pons = directory.entries.find((entry) => entry.source === "PONS")!;
  const stonk = directory.entries.find((entry) => entry.source === "STONKBROKERS")!;
  const ponsPage = { ...directory, entries: [pons] };
  const availabilityRequests: URL[] = [];
  const availableSources = await readLaunchSourceAvailability(ponsPage, {
    env,
    fetch: async (input) => {
      const url = new URL(String(input));
      availabilityRequests.push(url);
      assert.equal(url.searchParams.get("source"), "STONKBROKERS");
      assert.equal(url.searchParams.get("limit"), "1");
      assert.equal(url.searchParams.get("q"), null);
      assert.equal(url.searchParams.get("cursor"), null);
      return Response.json({ ...directory, entries: [stonk], nextCursor: null });
    },
  });
  assert.deepEqual(availableSources, ["PONS", "STONKBROKERS"]);
  assert.equal(availabilityRequests.length, 1, "Only the missing source is probed");
  // tsx's standalone JSX transform is classic; Next uses its automatic runtime.
  const reactGlobal = globalThis as typeof globalThis & { React?: typeof React };
  const priorReact = reactGlobal.React;
  let markup: string;
  try {
    reactGlobal.React = React;
    markup = renderToStaticMarkup(createElement(LaunchDiscovery, {
      initial: ponsPage, availableSources, query: "", observedNow: Date.parse(pons.launchTime),
    }));
  } finally {
    if (priorReact) reactGlobal.React = priorReact;
    else Reflect.deleteProperty(reactGlobal, "React");
  }
  assert.match(markup, /source=STONKBROKERS[^>]*>StonkBrokers<\/a>/,
    "The landing source filter survives a Pons-only first page");
  assert.equal(markup.includes(`data-token="${stonk.token}"`), false,
    "Availability never inserts synthetic rows into the current page");
  for (const value of [
    { ...directory, entries: [], nextCursor: null },
    { ...directory, entries: [pons], nextCursor: null },
  ]) {
    assert.deepEqual(await readLaunchSourceAvailability(ponsPage, {
      env, fetch: async () => Response.json(value),
    }), ["PONS"], "Configured sources or mismatched evidence do not establish availability");
  }
  for (const status of [401, 429, 503]) {
    assert.deepEqual(await readLaunchSourceAvailability(ponsPage, {
      env, fetch: async () => new Response("Unavailable", { status }),
    }), ["PONS"], "A failed availability probe preserves already displayed evidence");
  }
  assert.deepEqual(await readLaunchSourceAvailability(ponsPage, {
    env, timeoutMs: 100,
    fetch: async (_, init) => new Promise((_, reject) =>
      init!.signal!.addEventListener("abort", () => reject(Error("Controlled timeout")))),
  }), ["PONS"]);
  const probeOrder: string[] = [];
  let activeProbes = 0;
  assert.deepEqual(await readLaunchSourceAvailability({ ...directory, entries: [] }, {
    env, fetch: async (input) => {
      assert.equal(activeProbes++, 0, "Availability probes remain sequential");
      const source = new URL(String(input)).searchParams.get("source")!;
      probeOrder.push(source);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeProbes--;
      return Response.json({ ...directory, entries: [source === "PONS" ? pons : stonk] });
    },
  }), ["PONS", "STONKBROKERS"], "An empty search page retains genuinely available sources");
  assert.deepEqual(probeOrder, ["PONS", "STONKBROKERS"]);
  assert.deepEqual(await readLaunchSourceAvailability({ ...directory, entries: [], sources: [] }, {
    env, fetch: async () => { assert.fail("No probes without known producer source metadata"); },
  }), []);
  for (const mutate of [
    (d: any) => (d.entries[0].chainId = 1),
    (d: any) => (d.entries[0].sourceContract = "0x" + "a".repeat(40)),
    (d: any) => (d.entries[0].launchId = "incorrect"),
    (d: any) => (d.entries[0].sourceVersion = "V2_R2"),
    (d: any) => (d.entries[0].identity.decimals = 18.5),
    (d: any) => (d.entries[0].observedBlock = "0"),
    (d: any) => d.entries.push(d.entries[0]),
  ]) {
    const bad = structuredClone(directory);
    mutate(bad);
    assert.equal((await read(bad)).status, "unavailable");
  }
  assert.equal(
    (await read(directory, { token: directory.entries[1]!.token })).status,
    "unavailable",
  );
  assert.equal((await read(directory, { token: "bad" })).status, "unavailable");
  const unknown = {
    ...row,
    identity: { ...row.identity, decimals: null },
    identityObservations: {},
  };
  assert.equal(launchEvidenceSchema.safeParse(unknown).success, true);
  const seed = launchTerminalEntry(
    { context: "asset", market: row.token },
    unknown,
  )!;
  assert.equal(seed.address, row.token);
  assert.equal(seed.verifiedIdentity, undefined);
  assert.ok(
    launchNavigationHref(row).includes(encodeURIComponent(row.launchId)),
  );
  assert.equal(
    launchTerminalEntry(
      { context: "asset", market: directory.entries[1]!.token },
      row,
    ),
    undefined,
  );
  const enrolled = directory.entries.find(
    (e) => e.relationship === "TOKEN_ENROLLED",
  )!;
  assert.equal(
    launchEvidenceSchema.safeParse({
      ...enrolled,
      identityObservations: {
        decimals: {
          block: "1",
          blockHash: row.launchBlockHash,
          observedAt: row.launchTime,
        },
      },
    }).success,
    true,
    "Pre-existing enrolled tokens can have prior identity observations",
  );
  for (const status of [401, 429, 503])
    assert.equal(
      (
        await readLaunchIntelligence(
          {},
          {
            env,
            fetch: async () => new Response("Provider unavailable", { status }),
          },
        )
      ).status,
      "unavailable",
    );
  assert.equal(
    (
      await readLaunchIntelligence(
        {},
        { env, fetch: async () => new Response("not json") },
      )
    ).status,
    "unavailable",
  );
  assert.equal(
    (
      await readLaunchIntelligence(
        {},
        {
          env,
          fetch: async () => new Response(env.RMT_MARKET_INDEXER_READ_TOKEN),
        },
      )
    ).status,
    "unavailable",
  );
  assert.equal(
    (
      await readLaunchIntelligence(
        {},
        {
          env,
          timeoutMs: 100,
          fetch: async (_, init) =>
            new Promise((_, reject) =>
              init!.signal!.addEventListener("abort", () =>
                reject(Error("Controlled timeout")),
              ),
            ),
        },
      )
    ).status,
    "unavailable",
  );
  assert.equal(
    (await read(directory)).entries.length,
    10,
    "Recovery does not reuse an unavailable result",
  );
  const deps: VNextUniversalMarketSearchDependencies = {
    readInventory: async () => ({
      status: "upstream_unavailable",
      reason: "request_failed",
    }),
    readIdentity: async () => null,
    readCanonicalCatalog: async () => ({
      status: "unavailable" as const,
      entries: [],
    }),
    searchCanonicalTokens: async () => ({ status: "unavailable", entries: [] }),
    admitProjectIdentities: async <T>(candidates: readonly T[]) => [...candidates],
    fetch: async () => Response.json({ pairs: [] }),
    readLaunches: async () => directory,
  };
  const search = await searchVNextUniversalMarkets(row.identity.symbol!, deps);
  assert.equal(search.results[0]?.address, row.token);
  assert.equal(
    (
      await searchVNextUniversalMarkets(row.identity.symbol!, {
        ...deps,
        readLaunches: async () => ({ ...directory, entries: [unknown] }),
      })
    ).results.length,
    0,
    "Unknown units are never fabricated for legacy search results",
  );
  let launchReads = 0;
  await searchVNextUniversalMarkets(row.token, {
    ...deps,
    readLaunches: async () => {
      launchReads++;
      return directory;
    },
  });
  assert.equal(
    launchReads,
    0,
    "Exact contract search preserves the existing authority",
  );
  console.info(
    JSON.stringify({
      launchReaderValidation: true,
      pageIndependentSourceAvailability: true,
      boundedPositiveEvidenceProbes: true,
      genuineReplayedRecords: 10,
      unknownUnits: true,
      timeoutRecovery: true,
      searchSupplement: true,
      executionGateAdded: false,
    }),
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
