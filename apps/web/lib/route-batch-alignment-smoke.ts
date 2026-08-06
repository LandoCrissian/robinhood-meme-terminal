import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scanner = readFileSync(
  new URL("../app/external-market-feed-v10.tsx", import.meta.url),
  "utf8"
);
const availabilityRoute = readFileSync(
  new URL("../app/api/trade/external-availability/route.ts", import.meta.url),
  "utf8"
);
const nextConfig = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");

const scannerLimit = Number(scanner.match(/const MAX_ROUTE_BATCH = (\d+);/)?.[1]);
const endpointLimit = Number(availabilityRoute.match(/const MAX_TOKENS = (\d+);/)?.[1]);
const endpointConcurrency = Number(availabilityRoute.match(/const CONCURRENCY = (\d+);/)?.[1]);

assert.ok(Number.isInteger(scannerLimit) && scannerLimit > 0, "Scanner route batch limit must be explicit.");
assert.ok(Number.isInteger(endpointLimit) && endpointLimit > 0, "Availability endpoint limit must be explicit.");
assert.ok(
  endpointLimit >= scannerLimit,
  `Availability endpoint accepts ${endpointLimit} tokens but scanner can send ${scannerLimit}.`
);
assert.ok(endpointConcurrency >= 6, "Route availability should not serialize a large scanner batch.");
assert.doesNotMatch(nextConfig, /ignoreBuildErrors/, "Production builds must enforce TypeScript errors.");

console.info(
  `Route batch alignment passed: scanner ${scannerLimit}, endpoint ${endpointLimit}, concurrency ${endpointConcurrency}.`
);
