import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, zeroAddress } from "viem";
import {
  configuredVNextUniswapV3V2ProofWallet,
  isVNextUniswapV3V2ProofWalletRecipient,
  requireVNextUniswapV3V2ProofWalletRecipient,
  VNEXT_UNISWAP_V3_V2_RELEASE_SCOPE
} from "../server/vnext-uniswap-fee-executor-v2";
import { selectVNextUniswapV3SettlementMode } from "../server/vnext-uniswap-quote";
import {
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_LEGACY_V1_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE
} from "./execution-settlement";

const proofWallet = getAddress("0x7e8e7d3af28584a8b9eeddbE16cd3308bd1e76ca");
const otherWallet = getAddress("0x8888888888888888888888888888888888888888");
const inputAsset = zeroAddress;
const outputAsset = getAddress("0x2222222222222222222222222222222222222222");
const executor = getAddress("0x4444444444444444444444444444444444444444");
const treasury = getAddress("0x5555555555555555555555555555555555555555");

const select = (recipient: typeof proofWallet, env: NodeJS.ProcessEnv, v2Configured = true) =>
  selectVNextUniswapV3SettlementMode({ inputAsset, outputAsset, recipient, env, v2Configured });

const enabledProofEnv = {
  RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET: proofWallet.toLowerCase()
} as unknown as NodeJS.ProcessEnv;

assert.equal(VNEXT_UNISWAP_V3_V2_RELEASE_SCOPE, "PROOF_WALLET_ONLY");
assert.equal(configuredVNextUniswapV3V2ProofWallet({} as NodeJS.ProcessEnv), null);
assert.equal(configuredVNextUniswapV3V2ProofWallet({
  RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET: proofWallet.toLowerCase()
} as unknown as NodeJS.ProcessEnv), proofWallet, "the server must checksum-normalize the configured V2 proof wallet");
assert.throws(() => configuredVNextUniswapV3V2ProofWallet({
  RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET: "not-an-address"
} as unknown as NodeJS.ProcessEnv), /valid nonzero EVM address/);
assert.throws(() => configuredVNextUniswapV3V2ProofWallet({
  RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET: zeroAddress
} as unknown as NodeJS.ProcessEnv), /valid nonzero EVM address/);

assert.equal(select(proofWallet, {} as NodeJS.ProcessEnv), VNEXT_DIRECT_NO_RMT_FEE,
  "an absent V2 gate must leave the prior settlement lane unchanged");
assert.equal(select(proofWallet, {
  RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv), VNEXT_DIRECT_NO_RMT_FEE,
"an absent V2 proof wallet must not admit controlled V2 authorization");
assert.equal(select(proofWallet, enabledProofEnv), VNEXT_V2_ATOMIC_INPUT_FEE);
assert.equal(select(otherWallet, enabledProofEnv), VNEXT_DIRECT_NO_RMT_FEE,
  "a non-proof wallet must never enter the V2 canary lane");
assert.equal(isVNextUniswapV3V2ProofWalletRecipient(proofWallet, enabledProofEnv), true);
assert.equal(isVNextUniswapV3V2ProofWalletRecipient(otherWallet, enabledProofEnv), false);
assert.doesNotThrow(() => requireVNextUniswapV3V2ProofWalletRecipient(proofWallet, enabledProofEnv));
assert.throws(() => requireVNextUniswapV3V2ProofWalletRecipient(otherWallet, enabledProofEnv), /restricted to the configured proof wallet/);
assert.throws(() => select(proofWallet, enabledProofEnv, false), /enabled without a complete executor policy/,
  "a proof-wallet V2 authority failure must not downgrade to direct or V1 settlement");
assert.throws(() => select(otherWallet, {
  ...enabledProofEnv,
  RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET: "malformed"
} as unknown as NodeJS.ProcessEnv), /valid nonzero EVM address/,
"malformed enabled proof authority must fail closed");

const v1BaselineEnv = {
  ...enabledProofEnv,
  RMT_VNEXT_EXECUTION_FEE_POLICY_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_PUBLIC_AUTHORIZATION_ENABLED: "false",
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_ADDRESS: executor,
  RMT_VNEXT_UNISWAP_V3_FEE_EXECUTOR_RUNTIME_HASH: `0x${"8".repeat(64)}`,
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: otherWallet,
  RMT_VNEXT_EXECUTION_FEE_TREASURY: treasury,
  RMT_VNEXT_EXECUTION_FEE_POLICY_FROM_BLOCK: "1",
  RMT_VNEXT_EXECUTION_FEE_SETTLEMENT_ASSET_IDS: "eip155:4663/native"
} as unknown as NodeJS.ProcessEnv;
assert.equal(select(otherWallet, v1BaselineEnv), VNEXT_LEGACY_V1_FEE,
  "a non-V2-proof wallet must retain its independently configured V1 behavior");
assert.equal(select(proofWallet, {
  RMT_VNEXT_UNISWAP_V3_V2_AUTHORIZATION_ENABLED: "true",
  RMT_VNEXT_UNISWAP_V3_FEE_PROOF_WALLET: proofWallet
} as unknown as NodeJS.ProcessEnv), VNEXT_DIRECT_NO_RMT_FEE,
"the V1 proof-wallet variable alone must not authorize V2");
assert.equal(select(proofWallet, {
  RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET: proofWallet
} as unknown as NodeJS.ProcessEnv), VNEXT_DIRECT_NO_RMT_FEE,
"the V2 proof-wallet variable alone must not authorize V1 or V2");

const verifyRoute = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
const authorizeRoute = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../server/vnext-uniswap-v3-adapter.ts", import.meta.url), "utf8");
const commitment = readFileSync(new URL("../server/vnext-v2-verification-commitment.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
assert.match(verifyRoute, /requireVNextUniswapV3V2ProofWalletRecipient\(recipient\)/);
assert.match(authorizeRoute, /requireVNextUniswapV3V2ProofWalletRecipient\(recipient\)/);
assert.equal((adapter.match(/requireVNextUniswapV3V2ProofWalletRecipient\(request\.recipient\)/g) ?? []).length, 2,
  "both direct adapter verification and authorization entry points must enforce proof-wallet authority");
assert.match(commitment, /wallet:\s*getAddress\(input\.evidence\.recipient\)/);
assert.match(commitment, /getAddress\(claims\.wallet\) !== getAddress\(input\.wallet\)/);
assert.match(envExample, /^RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET=$/m);
assert.doesNotMatch(envExample, /NEXT_PUBLIC_RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET/);

console.log("RMT Uniswap V3 V2 proof-wallet canary admission smoke checks passed.");
