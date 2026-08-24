import assert from "node:assert/strict";
import { parseDexDiscoveryMetadata } from "./dex-discovery-metadata";

const token = "0x1111111111111111111111111111111111111111";
const snapshot = parseDexDiscoveryMetadata([
  [{
    chainId: "robinhood",
    tokenAddress: token,
    icon: "https://cdn.dexscreener.com/cms/images/fresh",
    links: [
      { type: "website", url: "https://fresh.example.com" },
      { type: "twitter", url: "https://x.com/fresh" },
      { type: "telegram", url: "javascript:alert(1)" }
    ]
  }],
  [{
    chainId: "robinhood",
    tokenAddress: "0x" + token.slice(2).toUpperCase(),
    icon: "https://evil.example.com/fresh.png"
  }],
  [{ chainId: "ethereum", tokenAddress: "0x2222222222222222222222222222222222222222" }],
  { malformed: true }
]);

assert.deepEqual(snapshot.tokenAddresses, [token]);
assert.equal(snapshot.metadata.get(token)?.imageUri, "https://cdn.dexscreener.com/cms/images/fresh");
assert.equal(snapshot.metadata.get(token)?.socials?.website, "https://fresh.example.com/");
assert.equal(snapshot.metadata.get(token)?.socials?.x, "https://x.com/fresh");
assert.equal(snapshot.metadata.get(token)?.socials?.telegram, null);

console.info("DexScreener public-discovery metadata smoke passed");
