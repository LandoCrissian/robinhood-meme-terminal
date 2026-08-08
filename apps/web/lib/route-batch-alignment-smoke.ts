import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scanner = readFileSync(
  new URL("../app/external-market-feed-v10.tsx", import.meta.url),
  "utf8"
);
const mobileScanner = readFileSync(
  new URL("../app/external-market-feed.tsx", import.meta.url),
  "utf8"
);
const availabilityRoute = readFileSync(
  new URL("../app/api/trade/external-availability/route.ts", import.meta.url),
  "utf8"
);
const nextConfig = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");

const endpointLimit = Number(availabilityRoute.match(/const MAX_TOKENS = (\d+);/)?.[1]);
const endpointConcurrency = Number(availabilityRoute.match(/const CONCURRENCY = (\d+);/)?.[1]);

assert.ok(Number.isInteger(endpointLimit) && endpointLimit > 0, "Availability endpoint limit must be explicit.");
assert.ok(endpointConcurrency >= 6, "Route availability should not serialize a large scanner batch.");
assert.doesNotMatch(scanner, /api\/trade\/external-availability/, "Desktop discovery must defer route verification until the workspace opens.");
assert.doesNotMatch(mobileScanner, /api\/trade\/external-availability/, "Mobile discovery must defer route verification until the workspace opens.");
assert.doesNotMatch(nextConfig, /ignoreBuildErrors/, "Production builds must enforce TypeScript errors.");

console.info(
  `Optimistic discovery passed: no card fanout; on-demand endpoint remains bounded to ${endpointLimit} tokens at concurrency ${endpointConcurrency}.`
);
