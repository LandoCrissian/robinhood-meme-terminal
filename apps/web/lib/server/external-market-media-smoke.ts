import assert from "node:assert/strict";
import { safeDexImageUri } from "./external-market-media";

const image = "https://cdn.dexscreener.com/cms/images/example?width=800&format=auto";
assert.equal(safeDexImageUri(image), image);
assert.equal(safeDexImageUri("http://cdn.dexscreener.com/image.png"), undefined);
assert.equal(safeDexImageUri("https://creator.example/image.png"), undefined);
assert.equal(safeDexImageUri("javascript:alert(1)"), undefined);
assert.equal(safeDexImageUri(null), undefined);

console.info("External market artwork sanitizer passed");
