import assert from "node:assert/strict";
import { MAX_METADATA_JSON_BYTES, MAX_TOKEN_URI_BYTES, resolveOnchainTokenMetadata } from "./metadata.js";

const data = (value: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}`;
const svg = (value: string) => `data:image/svg+xml;base64,${Buffer.from(value, "utf8").toString("base64")}`;
const actualCcff00Svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#CCFF00"/></svg>';
const valid = data({
  name: "#CCFF00",
  description: "This is Robin Neon.",
  image: svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#CCFF00"/></svg>'),
  attributes: [{ trait_type: "Color", value: "#CCFF00" }],
});
const ready = resolveOnchainTokenMetadata(valid);
assert.equal(ready.status, "READY");
assert.equal(ready.tokenUriKind, "DATA_JSON_BASE64");
assert.equal(ready.name, "#CCFF00");
assert.equal(ready.description, "This is Robin Neon.");
assert.equal(ready.attributes[0]?.value, "#CCFF00");
assert.match(ready.image ?? "", /^data:image\/svg\+xml;base64,/);
assert.match(ready.metadataDigest ?? "", /^0x[0-9a-f]{64}$/);
assert.match(resolveOnchainTokenMetadata(data({ image: svg(actualCcff00Svg) })).image ?? "", /^data:image\/svg\+xml;base64,/);
assert.match(resolveOnchainTokenMetadata(data({ image: svg('<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1" fill="#abcdef"/></svg>') })).image ?? "", /^data:image\/svg\+xml;base64,/);

for (const invalid of [
  "data:application/json;base64,%%%bad%%%",
  `data:application/json;base64,${Buffer.from("{".repeat(MAX_METADATA_JSON_BYTES + 1)).toString("base64")}`,
  "data:application/json;base64," + Buffer.from("not json").toString("base64"),
  "x".repeat(MAX_TOKEN_URI_BYTES + 1),
]) assert.equal(resolveOnchainTokenMetadata(invalid).status, "INVALID");

for (const unsafe of [
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.invalid/x)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u&#114;l(https://example.invalid/x)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="&#117;rl(https://example.invalid/x)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u&#x72;l(https://example.invalid/x)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="javascript:alert(1)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="j&#97;vascript:alert(1)"/></svg>',
  '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"><rect fill="#CCFF00"/></svg>',
  '<!DOCTYPE svg [<!ENTITY x "#CCFF00">]><svg xmlns="http://www.w3.org/2000/svg"><rect fill="&x;"/></svg>',
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect fill="#CCFF00"/></svg>',
  '<?xml-stylesheet href="https://example.invalid/x"?><svg xmlns="http://www.w3.org/2000/svg"><rect fill="#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect href="https://example.invalid/x"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect src="https://example.invalid/x"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/x"/></svg>',
  '<svg xmlns="https://example.invalid/svg"><rect fill="#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><circle fill="#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect class="badge" fill="#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="-1"><rect fill="#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="Infinity"><rect fill="#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100"><rect fill="#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1000000001" fill="#CCFF00"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#CCFF00"/>not markup</svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><!-- hidden --><rect fill="#CCFF00"/></svg>',
]) {
  const result = resolveOnchainTokenMetadata(data({ name: "safe metadata", image: svg(unsafe) }));
  assert.equal(result.status, "READY");
  assert.equal(result.image, null);
}

assert.equal(resolveOnchainTokenMetadata("ipfs://example").status, "UNSUPPORTED");
assert.equal(resolveOnchainTokenMetadata("ipfs://example").tokenUriKind, "IPFS");
assert.equal(resolveOnchainTokenMetadata("https://example.com/metadata.json").status, "UNSUPPORTED");
assert.equal(resolveOnchainTokenMetadata("https://example.com/metadata.json").tokenUriKind, "HTTPS");
console.info("nft-indexer onchain metadata safety smoke: PASS");
