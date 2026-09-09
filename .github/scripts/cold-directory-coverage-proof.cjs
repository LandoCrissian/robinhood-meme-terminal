// Deterministic Production-function proof. Uses only test storage and captured
// public, verified identity evidence; never opens a database or wallet connection.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const root = resolve(__dirname, '../..');
const web = createRequire(resolve(root, 'apps/web/package.json'));
web('tsx/cjs');
const indexer = createRequire(resolve(root, 'apps/market-indexer/package.json'));
const frozen = JSON.parse(readFileSync(resolve(root, 'apps/market-indexer/fixtures/cold-directory-coverage.json'), 'utf8'));
const { identityCoverageFixture } = indexer('./src/token-identity-coverage-fixture.ts');
const { refreshCanonicalTokenIdentityIndex, readCanonicalBrowseIdentities } = indexer('./src/token-identity-index.ts');
const { readVNextIndexedMarketDirectoryPage } = web('./lib/server/vnext-indexed-market-directory.ts');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function scenario(mode) {
  const storage = identityCoverageFixture(frozen.liveIdentities, frozen.frozen.pools.length);
  const initial = frozen.frozen.browseIdentities.identities.map((identity) => identity.address.toLowerCase());
  storage.seed(initial, storage.addresses.filter((address) => !initial.includes(address)));
  let writer = storage.pool();
  if (mode !== 'sparse') {
    for (let batch = 0; batch < 256; batch += 1) {
      if (!await refreshCanonicalTokenIdentityIndex(writer, storage.rpc, 25, 100n, `0x${'1'.repeat(64)}`)) break;
    }
  }
  // A new reader connection discards ALL worker module-memory evidence. It must
  // recover the ready set by decoding the persisted compressed PostgreSQL rows.
  const identities = await readCanonicalBrowseIdentities(storage.pool(), storage.addresses);
  if (mode !== 'sparse') assert.equal(identities.length, 82);
  const inventory = { ...frozen.frozen,
    browseIdentities: { source: 'verified-token-identity-index', freshness: 'last-known', identities } };
  let liveIdentityRequests = 0;
  const admitted = async (markets) => ({ admitted: markets, authorityStatus: 'ready' });
  const deps = {
    readInventory: async () => inventory,
    readStocks: async () => ({ coverage: 'complete', assetsByAddress: new Map() }),
    // For full coverage this MUST NOT be called, even with a 45-second upstream.
    readIdentities: async () => { liveIdentityRequests += 1; return new Map(); },
    admit: admitted
  };
  const start = performance.now();
  const response = await readVNextIndexedMarketDirectoryPage('https://fixture.invalid/api/vnext/market-directory', deps);
  const elapsedMs = performance.now() - start;
  assert.equal(response.status, 200);
  assert.equal(response.body.inventorySource, 'indexed');
  assert.equal(response.body.stale, true, 'last-known browse evidence is never labeled fresh');
  assert.equal(response.body.markets.length, mode === 'sparse' ? 3 : 82);
  if (mode !== 'sparse') {
    assert.equal(liveIdentityRequests, 0, 'durable browse publication cannot depend on optional live identity enrichment');
    assert.ok(elapsedMs <= 2_000, `cold durable publication took ${elapsedMs}ms`);
  }
  const set = response.body.markets.map((market) => market.address.toLowerCase()).sort();
  if (mode === 'warm') {
    const again = await readVNextIndexedMarketDirectoryPage('https://fixture.invalid/api/vnext/market-directory', deps);
    assert.deepEqual(again.body.markets.map((market) => market.address.toLowerCase()).sort(), set);
  }
  return { mode, pools: frozen.frozen.pools.length, tokens: storage.addresses.length,
    durableIdentityCount: identities.length, published: set.length, digest: digest(set), elapsedMs,
    liveIdentityRequests, identityEvidence: response.body.identityEvidence, stale: response.body.stale };
}

async function main() {
  if (process.argv[2] === '--child') {
    process.stdout.write(`${JSON.stringify(await scenario(process.argv[3]))}\n`);
    return;
  }
  const results = [];
  for (const mode of ['sparse', 'cold', 'warm']) {
    const child = spawnSync(process.execPath, [__filename, '--child', mode], {
      cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_ENV: 'test' }
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    results.push(JSON.parse(child.stdout.trim()));
  }
  assert.equal(results[1].digest, results[2].digest, 'separate cold and warm processes have the same durable admitted set');
  const report = { source: 'production-indexer-and-web-functions', storage: 'test-compressed-shards',
    frozenTokenDigest: frozen.tokenDigest, results, productionChanged: false, realTransactions: 0 };
  if (process.env.RMT_COVERAGE_EVIDENCE_OUTPUT) {
    writeFileSync(process.env.RMT_COVERAGE_EVIDENCE_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
