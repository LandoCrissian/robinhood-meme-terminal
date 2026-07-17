import assert from "node:assert/strict";
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

console.info("Web cache header smoke test passed");
