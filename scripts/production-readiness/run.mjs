import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runIndexerProbe } from "./indexer.mjs";
import { makeReadOnlyRpc, ROBINHOOD_SOURCES, runRpcProbe } from "./rpc.mjs";
import { routingPrerequisites } from "./routing.mjs";
import { runSafeProbe, verifySafeCreation } from "./safe.mjs";

const manifest = new URL("../../docs/evidence/fixed-supply-release/release-manifest.json", import.meta.url);
const manifestText = readFileSync(manifest, "utf8").replaceAll("\r\n", "\n");
const release = JSON.parse(manifestText);
const { values } = parseArgs({
  options: {
    live: { type: "boolean" }, fixture: { type: "boolean" }, output: { type: "string" },
    "safe-receipt": { type: "string" }, "safe-role": { type: "string" }, "approved-payer": { type: "string" },
  },
});
assert.equal(Number(Boolean(values.live)) + Number(Boolean(values.fixture)) + Number(Boolean(values["safe-receipt"])), 1,
  "Specify --live, --fixture, or --safe-receipt");
assert.equal(release.status, "BLOCKED_NO_BROADCAST");
assert.equal(release.broadcastAuthorized, false);
const result = {
  observedAt: new Date().toISOString(),
  mode: values.live ? "PUBLIC_READ_ONLY" : values.fixture ? "LOCAL_ARCHIVED_FIXTURE" : "PUBLIC_READ_ONLY_SAFE_RECEIPT",
  chainId: 4663, status: release.status, broadcastAuthorized: false,
  compilerInputSha256: release.compiler.inputSha256,
  reviewedManifestSha256: createHash("sha256").update(manifestText).digest("hex"),
};
if (values["safe-receipt"]) {
  assert.ok(values["safe-role"] && values["approved-payer"], "Supply the separately approved Safe role and payer");
  result.safeReceipt = await verifySafeCreation({
    reader: makeReadOnlyRpc({ name: "official", url: ROBINHOOD_SOURCES.official }),
    corroboratingReader: makeReadOnlyRpc({ name: "pocket", url: ROBINHOOD_SOURCES.pocket }),
    role: values["safe-role"], hash: values["safe-receipt"], approvedPayer: values["approved-payer"],
  });
} else {
  assert.ok(!values["safe-role"] && !values["approved-payer"], "Receipt qualifiers require --safe-receipt");
  result.routing = routingPrerequisites();
  if (values.live) {
    // Serialize suites to bound total concurrent requests at shared public providers.
    result.indexer = await runIndexerProbe();
    const checkpoint = result.indexer.releases.historicalRegistrationWitnesses === "VERIFIED_L2"
      ? result.indexer.directory?.checkpoint : undefined;
    result.rpc = await runRpcProbe({ checkpoint: checkpoint && { number: checkpoint.blockNumber, hash: checkpoint.blockHash } });
    result.safes = await runSafeProbe();
  }
}
const json = JSON.stringify(result, (_, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n";
if (values.output) {
  writeFileSync(values.output, json, { flag: "wx" });
  console.log(result.mode + " evidence saved; " + result.status);
} else {
  process.stdout.write(json);
}
