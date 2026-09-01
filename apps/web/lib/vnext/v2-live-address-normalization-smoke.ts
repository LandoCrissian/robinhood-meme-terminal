import assert from "node:assert/strict";
import { getAddress, type Address, type Hex } from "viem";
import {
  assertVNextUniswapFeeExecutorV2LiveIdentity,
  assertVNextUniswapV3V2ExecutorRuntimeHash,
  isVNextUniswapV3V2ProofWalletRecipient,
  sameVNextUniswapV3V2Address,
  type VNextUniswapFeeExecutorV2LiveIdentity
} from "../server/vnext-uniswap-fee-executor-v2";
import {
  ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH,
  ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH,
  ROBINHOOD_WETH_IMPLEMENTATION,
  ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH,
  ROBINHOOD_WETH_RUNTIME_HASH
} from "../server/vnext-uniswap-fee-executor";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_V3_FACTORY, ROBINHOOD_WETH } from "../uniswap-v4";
import { createRmtExecutionFeeV2Policy } from "./execution-fee-policy-v2";
import { RMT_UNISWAP_V3_V2_POLICY_ID_HASH } from "./uniswap-v3-fee-executor-v2";

const executor = getAddress("0xef729FbC9aDfC431ae46ECc198144160e2dD7832");
const executorRuntimeHash = "0xed8ec8cd44f2c228044678358bb7c4565953067ceab42319b169358354b9693d" as Hex;
const treasury = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");
const proofWallet = getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA");
const policy = createRmtExecutionFeeV2Policy({ treasury, fromBlock: "51296658" });
const config = { executor, executorRuntimeHash, policy };

assert.equal(sameVNextUniswapV3V2Address(
  ROBINHOOD_SWAP_ROUTER_02,
  getAddress(ROBINHOOD_SWAP_ROUTER_02)
), true, "lowercase and checksummed Router02 representations must compare equal");
assert.equal(sameVNextUniswapV3V2Address(
  ROBINHOOD_V3_FACTORY,
  getAddress(ROBINHOOD_V3_FACTORY)
), true, "lowercase and checksummed factory representations must compare equal");
assert.equal(sameVNextUniswapV3V2Address(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
  getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
), true, "legal case representations of one EVM address must compare equal");

const validIdentity: VNextUniswapFeeExecutorV2LiveIdentity = {
  router: getAddress(ROBINHOOD_SWAP_ROUTER_02),
  factory: getAddress(ROBINHOOD_V3_FACTORY),
  weth: getAddress(ROBINHOOD_WETH),
  wethImplementation: getAddress(ROBINHOOD_WETH_IMPLEMENTATION),
  treasury: getAddress(treasury),
  routerRuntimeHash: ROBINHOOD_UNISWAP_ROUTER_RUNTIME_HASH,
  factoryRuntimeHash: ROBINHOOD_UNISWAP_FACTORY_RUNTIME_HASH,
  wethRuntimeHash: ROBINHOOD_WETH_RUNTIME_HASH,
  wethImplementationRuntimeHash: ROBINHOOD_WETH_IMPLEMENTATION_RUNTIME_HASH,
  policyIdHash: RMT_UNISWAP_V3_V2_POLICY_ID_HASH,
  policyVersion: 2n,
  policyHash: policy.policyHash,
  feeBps: 25,
  policyFromBlock: 51_296_658n,
  policyBeforeBlock: 0n
};

assert.doesNotThrow(() => assertVNextUniswapFeeExecutorV2LiveIdentity(validIdentity, config));
assert.doesNotThrow(() => assertVNextUniswapV3V2ExecutorRuntimeHash(executorRuntimeHash, executorRuntimeHash));

const wrongAddress = getAddress("0x1111111111111111111111111111111111111111");
const wrongHash = `0x${"1".repeat(64)}` as Hex;
const addressMutations: Array<keyof Pick<VNextUniswapFeeExecutorV2LiveIdentity,
  "router" | "factory" | "weth" | "wethImplementation" | "treasury">> = [
    "router", "factory", "weth", "wethImplementation", "treasury"
  ];
for (const field of addressMutations) {
  assert.throws(
    () => assertVNextUniswapFeeExecutorV2LiveIdentity({ ...validIdentity, [field]: wrongAddress }, config),
    /immutable policy or dependency identity changed/,
    `a genuinely different ${field} address must fail closed`
  );
}

const runtimeMutations: Array<keyof Pick<VNextUniswapFeeExecutorV2LiveIdentity,
  "routerRuntimeHash" | "factoryRuntimeHash" | "wethRuntimeHash" | "wethImplementationRuntimeHash">> = [
    "routerRuntimeHash", "factoryRuntimeHash", "wethRuntimeHash", "wethImplementationRuntimeHash"
  ];
for (const field of runtimeMutations) {
  assert.throws(
    () => assertVNextUniswapFeeExecutorV2LiveIdentity({ ...validIdentity, [field]: wrongHash }, config),
    /immutable policy or dependency identity changed/,
    `a changed ${field} must fail closed`
  );
}

assert.throws(
  () => assertVNextUniswapFeeExecutorV2LiveIdentity({ ...validIdentity, policyHash: wrongHash }, config),
  /immutable policy or dependency identity changed/,
  "a changed policy hash must fail closed"
);
assert.throws(
  () => assertVNextUniswapV3V2ExecutorRuntimeHash(wrongHash, executorRuntimeHash),
  /runtime bytecode is not approved/,
  "a changed executor runtime hash must fail closed"
);

const proofEnv = {
  RMT_VNEXT_UNISWAP_V3_V2_PROOF_WALLET: proofWallet.toLowerCase()
} as unknown as NodeJS.ProcessEnv;
assert.equal(isVNextUniswapV3V2ProofWalletRecipient(proofWallet, proofEnv), true);
assert.equal(isVNextUniswapV3V2ProofWalletRecipient(wrongAddress, proofEnv), false);

console.log("RMT Uniswap V3 V2 live address-normalization smoke checks passed.");
