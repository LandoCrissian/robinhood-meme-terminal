import assert from "node:assert/strict";
import { RMT_DISCOVERABLE_PROJECTS } from "@rmt/shared/project-identity";
import { directoryMarketFromUniversalSearchResult, selectVNextMarketDirectoryView, type VNextDirectoryMarket } from "./market-directory";
import { MARKET_UNIVERSES, selectMarketUniverse } from "./market-universe";
import { reconcileScannerRows } from "./scanner-reconciliation";

// Controlled rank-boundary transitions; these fixtures never enter production.
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const key = (row: VNextDirectoryMarket) => row.address.toLowerCase();
const make = (contract: string, n: number): VNextDirectoryMarket => ({
  ...directoryMarketFromUniversalSearchResult({ address: contract, name: `Controlled ${n}`, symbol: `C${n}`, decimals: 18, matchedBy: "token", markets: [] }),
  priceUsd: 1, volume1h: 100, buys1h: 100 - n, sells1h: 1,
  ageMinutes: n, priceChange24h: 100 - n, momentumScore: 100 - n, signal: "moving"
});

export function runScannerRowContinuityChecks() {
  const views = ["active", "movers", "new", "trending"] as const;
  const seed = Array.from({ length: 32 }, (_, n) => make(address(100_000 + n), n));
  const projectTokens = RMT_DISCOVERABLE_PROJECTS.flatMap(project => project.assets.filter(asset => asset.kind === "ERC20").map(asset => asset.contract));
  let checks = 0;
  for (const universe of MARKET_UNIVERSES) for (const view of views) {
    const rows = universe === "projects" ? projectTokens.map(make) : seed.map(row => ({ ...row,
      ...(universe === "rwa" ? { rwaRelationship: "paired-market-asset" as const } : {}),
      ...(universe === "stock" ? { rwaRelationship: "canonical-stock-token" as const } : {})
    }));
    const heldAddresses = new Set(rows.map(key));
    const eligible = selectVNextMarketDirectoryView(selectMarketUniverse(rows, universe, heldAddresses), view);
    assert.ok(eligible.length >= 2, `${universe}/${view} has a meaningful eligible fixture`);
    const limit = Math.min(24, eligible.length - 1), baseline = eligible.slice(0, limit);
    const changed = rows.map((row, n) => ({ ...row, priceUsd: 2, buys1h: n + 1, ageMinutes: rows.length - n, priceChange24h: n + 1, momentumScore: n + 1 }));
    const freshEligible = selectVNextMarketDirectoryView(selectMarketUniverse(changed, universe, heldAddresses), view);
    const freshWindow = freshEligible.slice(0, limit), ids = baseline.map(key);
    assert.notDeepEqual(freshWindow.map(key), ids, "fixture crosses the display cutoff");
    const retained = reconcileScannerRows(freshWindow, ids, key, true, [], freshEligible);
    assert.deepEqual(retained.rows.map(key), ids, `${universe}/${view}: eligible identities/order survive ranking omission`);
    assert.ok(retained.rows.every(row => row.priceUsd === 2), "current metrics update in place");
    assert.equal(retained.rows.length, limit, "held window never grows");
    assert.equal(retained.pending, true);
    assert.deepEqual(reconcileScannerRows(freshWindow, ids, key, false, [], freshEligible).rows, freshWindow, "release adopts fresh ranking");
    const removed = key(baseline[0]);
    const excluded = freshEligible.filter(row => key(row) !== removed);
    assert.ok(!reconcileScannerRows(excluded.slice(0, limit), ids, key, true, [], excluded).rows.some(row => key(row) === removed), "positive canonical/identity/search/universe exclusion overrides hold");
    const ineligible = changed.map(row => key(row) === removed ? { ...row, volume1h: 0, buys1h: 0, sells1h: 0, ageMinutes: 1_441, priceChange5m: 0, priceChange1h: 0, priceChange24h: 0, signal: null } : row);
    const selected = selectVNextMarketDirectoryView(selectMarketUniverse(ineligible, universe, heldAddresses), view);
    assert.ok(!reconcileScannerRows(selected.slice(0, limit), ids, key, true, [], selected).rows.some(row => key(row) === removed), "activity eligibility loss overrides hold");
    checks++;
  }

  // Genuine identities observed at the production cutoff, controlled ranking.
  const subjects = [
    ["TREE", "0x496f7908020918046554C172B883C546cd353e6C"],
    ["DEGEN", "0x0830A9Dd26a04e959657AB6788d45f5725590c32"],
    ["CASHCAT", "0x020bfC650A365f8BB26819deAAbF3E21291018b4"],
    ["FLOKI", "0x7cc1Cc7fe807b38B0391206CFf4282dB63B2dA80"]
  ].map(([symbol, contract], n) => ({ ...make(contract, 20 + n), symbol }));
  const baseline = [...seed.slice(0, 20), ...subjects];
  const eligible = [...seed.slice(24, 28), ...baseline].map(row => ({ ...row, priceUsd: 3 }));
  const retained = reconcileScannerRows(eligible.slice(0, 24), baseline.map(key), key, true, [], eligible);
  assert.deepEqual(retained.rows.map(key), baseline.map(key));
  assert.ok(subjects.every(subject => retained.rows.some(row => key(row) === key(subject) && row.priceUsd === 3)));
  assert.equal(retained.rows.length, 24);
  assert.equal(retained.newCount, 4);
  for (let n = 0; n < 100; n++) {
    const unrelated = Array.from({ length: 100 }, (_, i) => make(address(200_000 + n * 100 + i), i));
    assert.equal(reconcileScannerRows(unrelated.slice(0, 24), baseline.map(key), key, true, [], [...unrelated, ...eligible]).rows.length, 24, "no accumulation across repeated generations");
  }
  console.log(`Scanner row continuity: ${checks} activity/universe combinations, exclusions, bounded hold, fresh release, and TREE/DEGEN/CASHCAT/FLOKI PASS.`);
}
