import assert from "node:assert/strict";
import { createPublicClient, getAddress, http } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  ROBINHOOD_WETH,
  readPonsProjectMetadata,
  readPonsProjectMetadataBatch,
  safePonsImageUri,
  safePonsSocialUrl
} from "./pons-project-metadata";

assert.equal(safePonsImageUri("ipfs://bafy-example/logo.png"), "ipfs://bafy-example/logo.png");
assert.equal(safePonsImageUri("https://cdn.example/logo.png"), "https://cdn.example/logo.png");
assert.equal(safePonsImageUri("https://cdn.example/logo.svg"), null);
assert.equal(safePonsImageUri("data:image/png;base64,abc"), null);
assert.equal(safePonsImageUri("javascript:alert(1)"), null);
assert.equal(safePonsSocialUrl("https://x.com/example"), "https://x.com/example");
assert.equal(safePonsSocialUrl("http://example.com"), null);

async function main() {
  if (process.env.PONS_LIVE_METADATA_SMOKE === "true") {
    const client = createPublicClient({
      chain: robinhoodChain,
      transport: http(
        process.env.ROBINHOOD_MAINNET_RPC_URL || robinhoodChain.rpcUrls.default.http[0],
        { retryCount: 2, timeout: 12_000 }
      )
    });
    const token = getAddress("0x74b6Aebfa7336ed1013551bCf786a675F194066D");
    const expectedPool = getAddress("0x2C86edaA90D4440D07D338645007cdb80f1A98ff");
    const metadata = await readPonsProjectMetadata(
      client,
      token,
      expectedPool
    );
    assert.equal(metadata.sourceId, "pons");
    assert.equal(metadata.provenance, "factory-and-token-cross-checked");
    const batch = await readPonsProjectMetadataBatch(client, [token, ROBINHOOD_WETH]);
    assert.equal(batch.size, 1);
    assert.equal(batch.get(token.toLowerCase())?.pool, expectedPool);
    console.log(JSON.stringify({ event: "pons_live_project_metadata", ...metadata }, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    ));
  } else {
    console.log("pons metadata sanitizer smoke passed");
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
