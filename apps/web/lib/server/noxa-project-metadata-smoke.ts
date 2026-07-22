import assert from "node:assert/strict";
import { createPublicClient, getAddress, http } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";
import { ROBINHOOD_WETH } from "./pons-project-metadata";
import {
  readNoxaProjectMetadata,
  readNoxaProjectMetadataBatch
} from "./noxa-project-metadata";

async function main() {
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(
      process.env.ROBINHOOD_MAINNET_RPC_URL || robinhoodChain.rpcUrls.default.http[0],
      { retryCount: 2, timeout: 12_000 }
    )
  });
  const token = getAddress("0x6399e2bd8af62c0ac13f55613c3469b67332a6fd");
  const expectedPool = getAddress("0x08a9bafc1e4b70302f752d9ee8bf53cad8df939a");
  const metadata = await readNoxaProjectMetadata(client, token, expectedPool);
  assert.equal(metadata.sourceId, "noxa");
  assert.equal(metadata.provenance, "factory-and-token-cross-checked");
  assert.equal(metadata.name, "ROBIN DOG");
  assert.equal(metadata.symbol, "ROBINDOG");
  assert.equal(metadata.imageUri, "ipfs://bafkreih6upnqufpv57qfpnfthtjcdwgdblmsmoa76mjngziclc4kcizv6e");
  const batch = await readNoxaProjectMetadataBatch(client, [token, ROBINHOOD_WETH]);
  assert.equal(batch.size, 1);
  assert.equal(batch.get(token.toLowerCase())?.pool, expectedPool);
  console.log(JSON.stringify({ event: "noxa_live_project_metadata", ...metadata }, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  ));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
