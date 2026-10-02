import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readLaunchIntelligence,
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
