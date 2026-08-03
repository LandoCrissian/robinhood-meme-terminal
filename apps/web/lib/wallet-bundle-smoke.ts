import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const configSource = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
const providersSource = readFileSync(new URL("../app/providers.tsx", import.meta.url), "utf8");

assert.match(configSource, /"@react-native-async-storage\/async-storage": false/);
assert.match(configSource, /"pino-pretty": false/);
assert.match(providersSource, /metaMask\(/);
assert.match(providersSource, /coinbaseWallet\(/);
assert.match(providersSource, /injected\(/);
assert.match(providersSource, /walletConnect\(/);

console.info("Wallet browser bundle smoke test passed");
