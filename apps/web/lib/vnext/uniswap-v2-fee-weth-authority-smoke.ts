import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, type Hex } from "viem";
import { createRmtExecutionFeeV2Policy } from "./execution-fee-policy-v2";
import {
  ROBINHOOD_UNISWAP_V2_FACTORY,
  ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_V2_ROUTER,
  ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH
} from "./uniswap-v2-authorization-codec";
import {
  RMT_UNISWAP_V2_V2_POLICY_ID_HASH,
  RMT_UNISWAP_V2_V2_PROVIDER_ID
} from "./uniswap-v2-fee-executor-v2";
import {
  RMT_UNISWAP_V2_V2_CANDIDATE_GATE,
  configuredVNextUniswapV2FeeCandidate,
  requireVNextUniswapV2FeeWalletAdmission
} from "../server/vnext-uniswap-v2-fee-candidate";
import {
  ROBINHOOD_WETH_IMPLEMENTATION,
  ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH,
  ROBINHOOD_WETH_RUNTIME_HASH,
  assertCanonicalRobinhoodWethAuthorityEvidence,
  type VNextRobinhoodWethAuthorityEvidence
} from "../server/vnext-robinhood-weth-authority";
import {
  assertVNextUniswapV2FeeExecutorV2LiveIdentity,
  assertVNextUniswapV2FeeInfrastructureEvidence
} from "../server/vnext-uniswap-v2-fee-executor-v2";
import { readVNextPublicExecutionProviderScope } from "../server/vnext-public-execution-provider-scope";
import { ROBINHOOD_WETH } from "../uniswap-v4";

const blockHash = `0x${"1".repeat(64)}` as Hex;
const otherBlockHash = `0x${"2".repeat(64)}` as Hex;
const canonicalSlot = `0x${"0".repeat(24)}${ROBINHOOD_WETH_IMPLEMENTATION.slice(2).toLowerCase()}` as Hex;
const wrongAddress = getAddress("0x1111111111111111111111111111111111111111");
const wrongSlot = `0x${"0".repeat(24)}${wrongAddress.slice(2).toLowerCase()}` as Hex;
const treasury = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");

function canonicalWethEvidence(
  overrides: Partial<VNextRobinhoodWethAuthorityEvidence> = {}
): VNextRobinhoodWethAuthorityEvidence {
  return {
    chainId: 4_663,
    blockNumber: 51_960_482n,
    blockHash,
    recheckedBlockNumber: 51_960_482n,
    recheckedBlockHash: blockHash,
    wethProxyRuntimeHash: ROBINHOOD_WETH_RUNTIME_HASH,
    implementationSlot: canonicalSlot,
    implementationCodePresent: true,
    wethImplementationRuntimeHash: ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH,
    ...overrides
  };
}

const wethAuthority = assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence());
assert.equal(wethAuthority.weth, ROBINHOOD_WETH);
assert.equal(wethAuthority.wethImplementation, ROBINHOOD_WETH_IMPLEMENTATION);
assert.equal(wethAuthority.verifiedAtBlock, "51960482");
assert.equal(wethAuthority.verifiedAtBlockHash, blockHash);

assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ implementationSlot: `0x${"0".repeat(64)}` as Hex })),
  /implementation is unavailable/
);
assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ implementationSlot: "0x1234" as Hex })),
  /slot is malformed/
);
assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ implementationSlot: wrongSlot })),
  /implementation address changed/
);
assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ implementationCodePresent: false })),
  /implementation has no runtime bytecode/
);
assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ wethImplementationRuntimeHash: `0x${"3".repeat(64)}` })),
  /implementation runtime changed/
);
assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ wethProxyRuntimeHash: `0x${"4".repeat(64)}` })),
  /proxy runtime changed/
);
assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ chainId: 1 })),
  /requires Robinhood Chain 4663/
);
assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ blockHash: null })),
  /block hash is unavailable/
);
assert.throws(
  () => assertCanonicalRobinhoodWethAuthorityEvidence(canonicalWethEvidence({ recheckedBlockHash: otherBlockHash })),
  /verification block changed/
);

const infrastructureEvidence = {
  wethAuthority,
  routerRuntimeHash: ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH,
  factoryRuntimeHash: ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
  routerFactory: ROBINHOOD_UNISWAP_V2_FACTORY,
  routerWeth: ROBINHOOD_WETH,
  recheckedBlockNumber: 51_960_482n,
  recheckedBlockHash: blockHash
};
const infrastructure = assertVNextUniswapV2FeeInfrastructureEvidence(infrastructureEvidence);
assert.equal(infrastructure.router, ROBINHOOD_UNISWAP_V2_ROUTER);
assert.equal(infrastructure.factory, ROBINHOOD_UNISWAP_V2_FACTORY);
assert.equal(infrastructure.pairRuntimeHash, ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH);
assert.throws(
  () => assertVNextUniswapV2FeeInfrastructureEvidence({ ...infrastructureEvidence, routerWeth: wrongAddress }),
  /Router WETH dependency changed/
);
assert.throws(
  () => assertVNextUniswapV2FeeInfrastructureEvidence({ ...infrastructureEvidence, routerFactory: wrongAddress }),
  /Router factory dependency changed/
);
assert.throws(
  () => assertVNextUniswapV2FeeInfrastructureEvidence({ ...infrastructureEvidence, factoryRuntimeHash: `0x${"5".repeat(64)}` }),
  /factory runtime changed/
);
assert.throws(
  () => assertVNextUniswapV2FeeInfrastructureEvidence({ ...infrastructureEvidence, routerRuntimeHash: `0x${"6".repeat(64)}` }),
  /Router runtime changed/
);
assert.throws(
  () => assertVNextUniswapV2FeeInfrastructureEvidence({ ...infrastructureEvidence, recheckedBlockHash: otherBlockHash }),
  /verification block changed/
);

const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "51296658" });
const config = {
  executor: getAddress("0x2222222222222222222222222222222222222222"),
  executorRuntimeHash: `0x${"7".repeat(64)}` as Hex,
  policy
};
const liveIdentity = {
  router: ROBINHOOD_UNISWAP_V2_ROUTER,
  factory: ROBINHOOD_UNISWAP_V2_FACTORY,
  weth: ROBINHOOD_WETH,
  treasury,
  routerRuntimeHash: ROBINHOOD_UNISWAP_V2_ROUTER_RUNTIME_HASH,
  factoryRuntimeHash: ROBINHOOD_UNISWAP_V2_FACTORY_RUNTIME_HASH,
  pairRuntimeHash: ROBINHOOD_UNISWAP_V2_PAIR_RUNTIME_HASH,
  wethRuntimeHash: ROBINHOOD_WETH_RUNTIME_HASH,
  policyHash: policy.policyHash,
  policyFromBlock: 51_296_658n,
  policyBeforeBlock: 0n,
  currentPolicyBlock: 51_960_482n,
  chainId: 4_663n,
  feeBps: 25,
  policyIdHash: RMT_UNISWAP_V2_V2_POLICY_ID_HASH,
  policyVersion: 2n,
  providerId: RMT_UNISWAP_V2_V2_PROVIDER_ID
};
assert.equal(assertVNextUniswapV2FeeExecutorV2LiveIdentity(liveIdentity, config), true);
assert.throws(
  () => assertVNextUniswapV2FeeExecutorV2LiveIdentity({ ...liveIdentity, weth: wrongAddress }, config),
  /immutable policy or dependency identity changed/
);

assert.equal(configuredVNextUniswapV2FeeCandidate({}), null);
assert.throws(() => requireVNextUniswapV2FeeWalletAdmission(), /QUOTE_ONLY/);
assert.throws(() => configuredVNextUniswapV2FeeCandidate({
  [RMT_UNISWAP_V2_V2_CANDIDATE_GATE]: "true",
  VERCEL_ENV: "production"
}), /source-only/);
assert.deepEqual(
  readVNextPublicExecutionProviderScope({ RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: "uniswap-v3" }).providers,
  ["uniswap-v3"]
);

const sharedSource = readFileSync(resolve(process.cwd(), "lib/server/vnext-robinhood-weth-authority.ts"), "utf8");
const v2AuthoritySource = readFileSync(resolve(process.cwd(), "lib/server/vnext-uniswap-v2-fee-executor-v2.ts"), "utf8");
const v3AuthoritySource = readFileSync(resolve(process.cwd(), "lib/server/vnext-uniswap-fee-executor.ts"), "utf8");
assert.doesNotMatch(sharedSource, /NEXT_PUBLIC_/);
assert.doesNotMatch(v2AuthoritySource, /NEXT_PUBLIC_/);
assert.match(v2AuthoritySource, /verifyCanonicalRobinhoodWethAuthority\(authorityClient\)/);
assert.match(v2AuthoritySource, /verifyVNextUniswapV2FeeInfrastructure\(authorityClient\)/);
assert.match(v3AuthoritySource, /verifyCanonicalRobinhoodWethAuthority\(wethAuthorityClient\)/);
assert.equal((v3AuthoritySource.match(/0xC6B81b429797E0f555440b70cD99e032D7AE947e/g) ?? []).length, 0);

console.log("Uniswap V2 server pre-sign WETH implementation authority smoke passed.");
