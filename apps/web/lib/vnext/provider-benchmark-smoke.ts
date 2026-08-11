import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const benchmark = readFileSync(new URL("../../scripts/vnext-provider-benchmark.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

assert.match(benchmark, /UNISWAP_TRADE_API_URL = "https:\/\/trade-api\.gateway\.uniswap\.org\/v1"/);
assert.match(benchmark, /requested\.pathname === "\/v1\/quote" && method === "POST"/);
assert.match(benchmark, /protocols: \["UNISWAPX_LATEST"\]/);
assert.match(benchmark, /"x-universal-router-version": "2\.1\.1"/);
assert.match(benchmark, /exactOrderVerificationRequired: true/);
assert.match(benchmark, /RMT_UNISWAP_API_KEY/);
assert.match(benchmark, /RMT_ZEROX_API_KEY/);
assert.match(benchmark, /"\/swap\/allowance-holder\/price"/);
assert.match(benchmark, /"\/gasless\/price"/);
assert.match(benchmark, /zeroXSummary: summarizeZeroX/);
assert.match(benchmark, /userPaysGas: executionMode === "swap"/);
assert.match(benchmark, /PCSX_RWA_SAMPLE_LIMIT = 6/);
assert.match(benchmark, /BENCHMARK_NOTIONALS_USD/);
assert.match(benchmark, /pcsxRwaSummary: summarizePcsx/);
assert.match(envExample, /^RMT_UNISWAP_API_KEY=$/m);
assert.match(envExample, /^RMT_VNEXT_UNISWAPX_OBSERVATION_ENABLED=false$/m);
assert.doesNotMatch(benchmark, /\/v1\/(?:order|swap)["'`]/);
assert.doesNotMatch(benchmark, /"\/(?:swap\/allowance-holder|gasless)\/quote"/);
assert.doesNotMatch(benchmark, /signTypedData|sendTransaction|writeContract|walletClient|privateKey/);

console.log("RMT VNext read-only provider benchmark boundary smoke checks passed.");
