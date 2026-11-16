import { createHash } from "node:crypto";

const origin = "https://www.rmtlaunch.fun";
const v6Asset = "0xdba33be56c89cc9fc014c4459028d7e5c7878671";
const missingAsset = "0x0000000000000000000000000000000000000000";
const probes = [
  ["directory", "/", ["read-only", "prelaunch"]],
  ["create", "/create-token", ["read-only", "creation", "wallet"]],
  ["legacy-rmt", "/rmt", ["read-only", "legacy"]],
  ["exact-token-page", `/launches/${v6Asset}`, [v6Asset]],
  ["historical-api", "/api/launchpad/launches"],
  ["exact-historical-api", `/api/launchpad/launches/${v6Asset}`],
  ["absent-historical-api", `/api/launchpad/launches/${missingAsset}`],
  ["execution-config", "/api/launchpad/config"],
  ["new-engine-discovery", "/api/launchpad/new-engine"],
  ["new-engine-exact-lookup", `/api/launchpad/new-engine/${v6Asset}`],
  ["fixture-create", "/api/launchpad/test-creation"],
  ["fixture-lifecycle", "/api/launchpad/test-lifecycle"],
];

function bodySummary(body) {
  const checkpoint = body.checkpoint ?? body.evidence?.checkpoint;
  const launches = body.launches ?? body.records;
  const launch = body.launch ?? body.record ?? (launches?.length === 1 ? launches[0] : undefined);
  return {
    keys: Object.keys(body), source: body.source, status: body.status, error: body.error,
    chainId: body.chainId, coverage: body.coverage, future: body.future, finality: body.finality,
    reason: body.reason, recordCount: Array.isArray(launches) ? launches.length : undefined,
    returnedIdentity: launch?.tokenAddress ?? launch?.token ?? launch?.address ?? body.tokenAddress,
    classification: launch?.classification, lifecycle: launch?.lifecycle,
    block: checkpoint?.blockNumber ?? checkpoint?.indexedThroughBlock ?? body.checkpointBlock,
    blockHash: checkpoint?.blockHash ?? checkpoint?.hash,
    observedAt: body.observedAt ?? body.evidence?.observedAt,
    freshness: body.freshness?.status ?? body.freshness, stale: checkpoint?.stale,
  };
}

const observedAt = new Date().toISOString();
const rows = [];
for (const [name, path, markers = []] of probes) {
  try {
    const response = await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(12_000) });
    const body = await response.text();
    const type = response.headers.get("content-type");
    rows.push({
      name, path, method: "GET", status: response.status, type,
      cache: response.headers.get("cache-control"),
      bodySha256: createHash("sha256").update(body).digest("hex"),
      markers: Object.fromEntries(markers.map((marker) => [marker, body.toLowerCase().includes(marker)])),
      ...(type?.includes("application/json") ? { json: bodySummary(JSON.parse(body)) } : {}),
    });
  } catch (error) {
    rows.push({ name, path, method: "GET", transportError: error.message });
  }
}
console.log(JSON.stringify({ observedAt, origin, scope: "READ_ONLY_HTTP", rows }, null, 2));
