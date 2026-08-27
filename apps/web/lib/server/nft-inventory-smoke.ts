import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import type { RmtNftItemRead, RmtNftProjectInventoryRead } from "@rmt/shared/nft/project-inventory";
import { readRmtNftItem, readRmtNftProjectInventory } from "./nft-project-market";

const collection = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
const owner = getAddress("0x1111111111111111111111111111111111111111");
const account = getAddress("0x2222222222222222222222222222222222222222");
const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#CCFF00"/></svg>').toString("base64")}`;
const metadata = {
  authority: "ONCHAIN_TOKEN_URI" as const,
  status: "READY" as const,
  tokenUriKind: "DATA_JSON_BASE64" as const,
  name: "#CCFF00",
  description: "This is Robin Neon.",
  image: svg,
  attributes: [{ traitType: "Color", value: "#CCFF00" }],
  metadataDigest: `0x${"1".repeat(64)}` as `0x${string}`,
};
const inventory: RmtNftProjectInventoryRead = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: collection, collectionStandard: "ERC721",
  availability: "AVAILABLE", availabilityReason: null, asOf: "2026-08-27T00:00:00.000Z",
  items: [{ tokenId: "1", owner, metadata }, { tokenId: "2", owner, metadata: { ...metadata, status: "INVALID", name: null, description: null, image: null, attributes: [], metadataDigest: null } }],
  nextCursor: "2",
};
const item: RmtNftItemRead = {
  schemaVersion: 1, projectId: "ccff00", chainId: 4663, collectionAddress: collection, collectionStandard: "ERC721",
  tokenId: "1", owner, metadata, asOf: "2026-08-27T00:00:00.000Z",
  tokenBoundAccount: { authority: "ONCHAIN_ERC6551_ACCOUNT", chainId: 4663, collectionAddress: collection, tokenId: "1", accountAddress: account },
};
const env = { NFT_INDEXER_URL: "https://nft-indexer.internal", NFT_INDEXER_READ_TOKEN: "a".repeat(64) };
const response = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });

async function main() {
const acceptedInventory = await readRmtNftProjectInventory("ccff00", undefined, { env, fetchImpl: response(inventory) });
assert.equal(acceptedInventory && "items" in acceptedInventory && acceptedInventory.items.length, 2);
assert.equal(acceptedInventory && "items" in acceptedInventory && acceptedInventory.items[1]?.metadata.status, "INVALID");
assert.equal(await readRmtNftProjectInventory("unknown", undefined, { env, fetchImpl: response(inventory) }), null);
for (const malformed of [
  { ...inventory, collectionStandard: "ERC1155" },
  { ...inventory, items: [inventory.items[1], inventory.items[0]] },
  { ...inventory, items: [inventory.items[0], inventory.items[0]] },
  { ...inventory, availability: "PARTIAL", availabilityReason: "SOURCE_BACKFILLING" },
  { ...inventory, items: [{ ...inventory.items[0]!, metadata: { ...metadata, image: `data:image/svg+xml;base64,${Buffer.from("<svg><script>x</script></svg>").toString("base64")}` } }] },
]) assert.deepEqual(await readRmtNftProjectInventory("ccff00", undefined, { env, fetchImpl: response(malformed) }), { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });

const acceptedItem = await readRmtNftItem("ccff00", "1", { env, fetchImpl: response(item) });
assert.equal(acceptedItem && "tokenId" in acceptedItem && acceptedItem.tokenBoundAccount.authority, "ONCHAIN_ERC6551_ACCOUNT");
assert.equal(await readRmtNftItem("ccff00", "999", { env, fetchImpl: response({}, 404) }), null);
for (const malformed of [
  { ...item, collectionAddress: account },
  { ...item, tokenBoundAccount: { ...item.tokenBoundAccount, chainId: 1 } },
  { ...item, tokenBoundAccount: { ...item.tokenBoundAccount, tokenId: "2" } },
  { ...item, tokenBoundAccount: { ...item.tokenBoundAccount, collectionAddress: account } },
]) assert.deepEqual(await readRmtNftItem("ccff00", "1", { env, fetchImpl: response(malformed) }), { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });
assert.deepEqual(await readRmtNftProjectInventory("ccff00", undefined, { env: {}, fetchImpl: response(inventory) }), { availability: "UNAVAILABLE", reason: "DATA_UNAVAILABLE" });

const projectPage = readFileSync(new URL("../../app/nft/[projectId]/page.tsx", import.meta.url), "utf8");
const itemPage = readFileSync(new URL("../../app/nft/[projectId]/[tokenId]/page.tsx", import.meta.url), "utf8");
const reader = readFileSync(new URL("./nft-project-market.ts", import.meta.url), "utf8");
assert.match(projectPage, /CANONICAL ONCHAIN INVENTORY/);
assert.match(projectPage, /\/nft\/\$\{model\.project\.projectId\}\/\$\{item\.tokenId\}/);
assert.match(itemPage, /ONCHAIN TOKENURI/);
assert.match(itemPage, /ERC-6551 account/);
assert.match(itemPage, /notFound\(\)/);
for (const source of [projectPage, itemPage]) {
  assert.doesNotMatch(source, />\s*(BUY|LIST|OFFER|ACCEPT|SWEEP)\s*</i);
  assert.doesNotMatch(source, /rarity (?:rank|score)|HoodStreet|discoveryProvenance/i);
}
assert.doesNotMatch(reader, /NEXT_PUBLIC_NFT_(?:INDEXER|MARKETPLACE)/);
console.info("CCFF00 inventory reader and item workspace authority smoke: PASS");
}

void main();
