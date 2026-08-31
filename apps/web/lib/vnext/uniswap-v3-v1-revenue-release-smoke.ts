import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import { selectVNextUniswapV3SettlementMode } from "../server/vnext-uniswap-quote";
import { RMT_UNISWAP_V3_FEE_MAINNET_PROOF } from "./uniswap-v3-fee-mainnet-proof";
import { VNEXT_DIRECT_NO_RMT_FEE, VNEXT_LEGACY_V1_FEE } from "./execution-settlement";
import { ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";

const NATIVE = getAddress("0x0000000000000000000000000000000000000000");
const USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const WETH = getAddress(ROBINHOOD_WETH_ADDRESS);
const TOKEN_A = getAddress("0x1111111111111111111111111111111111111111");
const TOKEN_B = getAddress("0x2222222222222222222222222222222222222222");
const PUBLIC_WALLET = getAddress("0x3333333333333333333333333333333333333333");
const feeEnvironment = {
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executorRuntimeHash,
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.treasury,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "35041945",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: [
    `eip155:4663/contract:${WETH.toLowerCase()}`,
    `eip155:4663/contract:${USDG.toLowerCase()}`,
    "eip155:4663/native"
  ].join(",")
} as const;

const saved = Object.fromEntries(Object.keys(feeEnvironment).map((name) => [name, process.env[name]]));
try {
  Object.assign(process.env, feeEnvironment);
  const mode = (inputAsset: `0x${string}`, outputAsset: `0x${string}`) => selectVNextUniswapV3SettlementMode({
    inputAsset,
    outputAsset,
    recipient: PUBLIC_WALLET
  });

  assert.equal(mode(USDG, WETH), VNEXT_LEGACY_V1_FEE, "USDG -> WETH settles the V1 fee on input");
  assert.equal(mode(USDG, TOKEN_A), VNEXT_LEGACY_V1_FEE, "USDG -> arbitrary token is V1 fee-bearing");
  assert.equal(mode(TOKEN_A, USDG), VNEXT_LEGACY_V1_FEE, "arbitrary token -> USDG is V1 fee-bearing");
  assert.equal(mode(WETH, TOKEN_A), VNEXT_LEGACY_V1_FEE, "WETH -> arbitrary token is V1 fee-bearing");
  assert.equal(mode(TOKEN_A, WETH), VNEXT_LEGACY_V1_FEE, "arbitrary token -> WETH is V1 fee-bearing");
  assert.equal(mode(NATIVE, TOKEN_A), VNEXT_LEGACY_V1_FEE, "native ETH -> arbitrary token is V1 fee-bearing");
  assert.equal(mode(TOKEN_A, TOKEN_B), VNEXT_DIRECT_NO_RMT_FEE, "ineligible endpoint assets remain direct/no-fee");
  assert.equal(mode(TOKEN_A, NATIVE), VNEXT_DIRECT_NO_RMT_FEE, "unsupported V1 native output fails over safely");

  delete process.env.RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED;
  assert.equal(
    selectVNextUniswapV3SettlementMode({ inputAsset: USDG, outputAsset: TOKEN_A, recipient: PUBLIC_WALLET }),
    VNEXT_DIRECT_NO_RMT_FEE,
    "proof-wallet scope cannot collect from another wallet"
  );
  assert.equal(
    selectVNextUniswapV3SettlementMode({
      inputAsset: USDG,
      outputAsset: TOKEN_A,
      recipient: RMT_UNISWAP_V3_FEE_MAINNET_PROOF.trader
    }),
    VNEXT_LEGACY_V1_FEE,
    "proof-wallet preflight remains available before public release"
  );
} finally {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const verifyRoute = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
const authorizeRoute = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
const walletReview = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const uniswapQuote = readFileSync(new URL("../server/vnext-uniswap-quote.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

assert.match(verifyRoute, /selectVNextUniswapV3SettlementMode/);
assert.match(authorizeRoute, /selectVNextUniswapV3SettlementMode/);
assert.match(authorizeRoute, /prepared\.evidence\.settlementMode/);
assert.match(composer, /RMT execution fee/);
assert.match(composer, /Protected user output after RMT fee, before network fee/);
assert.match(walletReview, /RMT execution fee:/);
assert.match(walletReview, /Gas and DEX\/provider fees are separate/);
assert.match(uniswapQuote, /process\.env\.RMT_RPC_URL\s*\?\?\s*process\.env\.RMT_MAINNET_RPC_URL/);
assert.match(envExample, /^RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED=false$/m);
assert.match(envExample, /^RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED=false$/m);
assert.match(envExample, /^RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED=false$/m);

console.log("RMT Uniswap V3 V1 public revenue route, fallback, disclosure, and default-off checks passed.");
