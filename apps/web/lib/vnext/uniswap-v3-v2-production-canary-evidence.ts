import { getAddress, zeroAddress, type Address, type Hex } from "viem";

export type RmtUniswapV3V2ProductionCanaryEvidence = {
  chainId: number;
  status: "PASS";
  transactionHash: Hex;
  blockNumber: string;
  trader: Address;
  executor: Address;
  executorRuntimeHash: Hex;
  executionId: Hex;
  policyId: "RMT_EXECUTION_V2";
  policyVersion: 2;
  policyHash: Hex;
  treasury: Address;
  provider: "uniswap-v3";
  settlementMode: "VNEXT_V2_ATOMIC_INPUT_FEE";
  feeBps: 25;
  feeSide: "input";
  inputAsset: Address;
  tokenName: "The Index";
  tokenSymbol: "Index";
  tokenAddress: Address;
  routeKind: "DIRECT";
  pool: Address;
  feeTier: 10_000;
  v3WonNormalRanking: true;
  rankingIncludedRmtFee: true;
  userGrossInputAtomic: string;
  actualRmtFeeAtomic: string;
  providerInputAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  actualOutputAtomic: string;
  settlementEventCount: 1;
  treasuryNativeDeltaAtomic: string;
  executorPostState: {
    nativeAtomic: "0";
    canonicalWethAtomic: "0";
    outputAssetAtomic: "0";
    routerAllowanceAtomic: "0";
  };
  replayRejected: true;
  liveErc20ToNativeStatus: "OWNER_WAIVED_NOT_EXECUTED";
  bidirectionalLiveProof: false;
};

/**
 * Owner-accepted public-chain observation from the controlled V2 native-input
 * canary. This immutable evidence does not authorize public execution and does
 * not claim that an ERC20-to-native live canary occurred.
 */
export const RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE = {
  chainId: 4_663,
  status: "PASS",
  transactionHash: "0x2b01ed1cf59a1514236d73d2e5eab2827cd20d516d623a5b86db14536f27890a",
  blockNumber: "51452517",
  trader: getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"),
  executor: getAddress("0xef729FbC9aDfC431ae46ECc198144160e2dD7832"),
  executorRuntimeHash: "0xed8ec8cd44f2c228044678358bb7c4565953067ceab42319b169358354b9693d",
  executionId: "0x522cd323ae5795778774432af8b0ddd319fcba473fe9a8f654508f947cb07de5",
  policyId: "RMT_EXECUTION_V2",
  policyVersion: 2,
  policyHash: "0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484",
  treasury: getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC"),
  provider: "uniswap-v3",
  settlementMode: "VNEXT_V2_ATOMIC_INPUT_FEE",
  feeBps: 25,
  feeSide: "input",
  inputAsset: zeroAddress,
  tokenName: "The Index",
  tokenSymbol: "Index",
  tokenAddress: getAddress("0x56910D4409F3a0C78C64DD8D0545FF0705389870"),
  routeKind: "DIRECT",
  pool: getAddress("0xD29893fFac8b29eC4Db2cfE0CDB3FE1377c028Ff"),
  feeTier: 10_000,
  v3WonNormalRanking: true,
  rankingIncludedRmtFee: true,
  userGrossInputAtomic: "100000000000000",
  actualRmtFeeAtomic: "250000000000",
  providerInputAtomic: "99750000000000",
  expectedOutputAtomic: "8586172043977260462",
  protectedOutputAtomic: "8500310323537487857",
  actualOutputAtomic: "8586172043977260462",
  settlementEventCount: 1,
  treasuryNativeDeltaAtomic: "250000000000",
  executorPostState: {
    nativeAtomic: "0",
    canonicalWethAtomic: "0",
    outputAssetAtomic: "0",
    routerAllowanceAtomic: "0"
  },
  replayRejected: true,
  liveErc20ToNativeStatus: "OWNER_WAIVED_NOT_EXECUTED",
  bidirectionalLiveProof: false
} as const satisfies RmtUniswapV3V2ProductionCanaryEvidence;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected inconsistent V2 production canary evidence: ${message}.`);
}

function exactAddress(actual: Address, expected: Address, label: string) {
  invariant(getAddress(actual) === getAddress(expected) && getAddress(actual) !== zeroAddress, `${label} changed`);
}

export function assertRmtUniswapV3V2ProductionCanaryEvidence(
  proof: RmtUniswapV3V2ProductionCanaryEvidence
) {
  const grossInput = BigInt(proof.userGrossInputAtomic);
  const actualFee = BigInt(proof.actualRmtFeeAtomic);
  const providerInput = BigInt(proof.providerInputAtomic);
  invariant(proof.chainId === 4_663 && proof.status === "PASS", "chain or status changed");
  invariant(proof.transactionHash === "0x2b01ed1cf59a1514236d73d2e5eab2827cd20d516d623a5b86db14536f27890a", "transaction changed");
  invariant(proof.blockNumber === "51452517", "block changed");
  invariant(proof.executionId === "0x522cd323ae5795778774432af8b0ddd319fcba473fe9a8f654508f947cb07de5", "execution ID changed");
  exactAddress(proof.trader, getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"), "trader");
  exactAddress(proof.executor, getAddress("0xef729FbC9aDfC431ae46ECc198144160e2dD7832"), "executor");
  exactAddress(proof.treasury, getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC"), "treasury");
  exactAddress(proof.tokenAddress, getAddress("0x56910D4409F3a0C78C64DD8D0545FF0705389870"), "token");
  exactAddress(proof.pool, getAddress("0xD29893fFac8b29eC4Db2cfE0CDB3FE1377c028Ff"), "pool");
  invariant(proof.executorRuntimeHash === "0xed8ec8cd44f2c228044678358bb7c4565953067ceab42319b169358354b9693d", "runtime changed");
  invariant(proof.policyId === "RMT_EXECUTION_V2" && proof.policyVersion === 2, "policy identity changed");
  invariant(proof.policyHash === "0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484", "policy hash changed");
  invariant(proof.provider === "uniswap-v3" && proof.settlementMode === "VNEXT_V2_ATOMIC_INPUT_FEE", "provider or settlement mode changed");
  invariant(proof.feeBps === 25 && proof.feeSide === "input" && proof.inputAsset === zeroAddress, "fee authority changed");
  invariant(proof.routeKind === "DIRECT" && proof.feeTier === 10_000, "route changed");
  invariant(proof.v3WonNormalRanking && proof.rankingIncludedRmtFee, "ranking evidence changed");
  invariant(actualFee === grossInput * BigInt(proof.feeBps) / 10_000n, "fee math changed");
  invariant(providerInput === grossInput - actualFee, "provider input changed");
  invariant(proof.treasuryNativeDeltaAtomic === proof.actualRmtFeeAtomic, "treasury delta changed");
  invariant(BigInt(proof.actualOutputAtomic) === BigInt(proof.expectedOutputAtomic), "actual output changed");
  invariant(BigInt(proof.actualOutputAtomic) >= BigInt(proof.protectedOutputAtomic), "protected output failed");
  invariant(proof.settlementEventCount === 1 && proof.replayRejected, "settlement uniqueness or replay changed");
  invariant(Object.values(proof.executorPostState).every((value) => value === "0"), "executor retained residue");
  invariant(proof.liveErc20ToNativeStatus === "OWNER_WAIVED_NOT_EXECUTED", "Canary B status changed");
  invariant(proof.bidirectionalLiveProof === false, "bidirectional live proof was fabricated");
  return true;
}

export const RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE_VALID =
  assertRmtUniswapV3V2ProductionCanaryEvidence(RMT_UNISWAP_V3_V2_PRODUCTION_CANARY_EVIDENCE);
