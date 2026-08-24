import assert from "node:assert/strict";
import fs from "node:fs";
import { sharedCacheHeaders } from "./cache-headers";

assert.deepEqual(
  sharedCacheHeaders({
    sharedMaxAgeSeconds: 15,
    staleIfErrorSeconds: 600,
    staleWhileRevalidateSeconds: 180
  }),
  {
    "Cache-Control": "public, max-age=2, s-maxage=15, stale-while-revalidate=180, stale-if-error=600",
    "CDN-Cache-Control": "public, s-maxage=15, stale-while-revalidate=180, stale-if-error=600",
    "Vercel-CDN-Cache-Control": "public, s-maxage=15, stale-while-revalidate=180, stale-if-error=600"
  }
);

assert.deepEqual(sharedCacheHeaders({ browserMaxAgeSeconds: 0, sharedMaxAgeSeconds: 5 }), {
  "Cache-Control": "public, max-age=0, s-maxage=5",
  "CDN-Cache-Control": "public, s-maxage=5",
  "Vercel-CDN-Cache-Control": "public, s-maxage=5"
});

assert.throws(() => sharedCacheHeaders({ sharedMaxAgeSeconds: -1 }), /nonnegative integer/);

const healthRoute = fs.readFileSync(new URL("../../app/api/health/route.ts", import.meta.url), "utf8");
assert.match(healthRoute, /await readFreshSystemHealth\(\)/);
assert.doesNotMatch(healthRoute, /await readSystemHealth\(\)/);

const systemHealth = fs.readFileSync(new URL("./system-health.ts", import.meta.url), "utf8");
assert.match(systemHealth, /latestBlock = blockNumber\.toString\(\)/);
assert.match(systemHealth, /schemaVersion: 2/);
assert.match(systemHealth, /product: "rmt-terminal"/);
assert.match(systemHealth, /readInventory\(\{ limit: 1 \}\)/);

console.info("Web cache header smoke test passed");
