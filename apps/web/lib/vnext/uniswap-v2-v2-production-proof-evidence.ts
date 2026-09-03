import { getAddress, zeroAddress, type Address, type Hex } from "viem";

export type RmtUniswapV2V2ProductionProofEvidence = {
  chainId: number;
  status: "PASS";
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  trader: Address;
  executor: Address;
  executorRuntimeHash: Hex;
  executionId: Hex;
  policyId: "RMT_EXECUTION_V2";
  policyVersion: 2;
  policyHash: Hex;
  treasury: Address;
  provider: "uniswap-v2";
  settlementMode: "VNEXT_V2_ATOMIC_INPUT_FEE";
  feeBps: 25;
  feeSide: "input";
  inputAsset: Address;
  token: "PONS";
  tokenAddress: Address;
  routeKind: "DIRECT";
  pair: Address;
  pair1: Address;
  v2WonNormalRanking: true;
  rankingIncludedRmtFee: true;
  userGrossInputAtomic: string;
  actualRmtFeeAtomic: string;
  providerInputAtomic: string;
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
 * Owner-accepted public-chain evidence from the controlled Uniswap V2 native
 * input proof. This record proves one exact settlement; it does not activate
 * public V2 execution or claim that an ERC20-to-native live proof occurred.
 */
export const RMT_UNISWAP_V2_V2_PRODUCTION_PROOF_EVIDENCE = {
  chainId: 4_663,
  status: "PASS",
  transactionHash: "0xb8ff9e561d4a333f5f91eb707daf6e8b00d0d0565de68355cf5966c1a6cdbb9e",
  blockNumber: "53089890",
  blockHash: "0x7b8f698dbc5bbb1aa00b3edb57d180d4b5dc764424df3e8f0c30514fa7540156",
  trader: getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"),
  executor: getAddress("0xB4bF1d99a3BF9201f8197682dcD2bF97725D6230"),
  executorRuntimeHash: "0x3a0518035f7a47c752eba630e02db8a72b14c175977fbfcbf6d708ea1a36c647",
  executionId: "0xccd068bd9b9cd7a9dc1a5acfa21bb0e6ac70a37fac6d0086d4e63819656fd8ad",
  policyId: "RMT_EXECUTION_V2",
  policyVersion: 2,
  policyHash: "0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484",
  treasury: getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC"),
  provider: "uniswap-v2",
  settlementMode: "VNEXT_V2_ATOMIC_INPUT_FEE",
  feeBps: 25,
  feeSide: "input",
  inputAsset: zeroAddress,
  token: "PONS",
  tokenAddress: getAddress("0x39dBED3a2bd333467115dE45665cC57F813C4571"),
  routeKind: "DIRECT",
  pair: getAddress("0x8018Ee3ad3c0321bE0e69536733CD28e29564dD4"),
  pair1: zeroAddress,
  v2WonNormalRanking: true,
  rankingIncludedRmtFee: true,
  userGrossInputAtomic: "100000000000000",
  actualRmtFeeAtomic: "250000000000",
  providerInputAtomic: "99750000000000",
  protectedOutputAtomic: "463575468897451774",
  actualOutputAtomic: "468258049391365429",
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
} as const satisfies RmtUniswapV2V2ProductionProofEvidence;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected inconsistent Uniswap V2 V2 production proof evidence: ${message}.`);
}

function exactAddress(actual: Address, expected: Address, label: string) {
  invariant(getAddress(actual) === getAddress(expected), `${label} changed`);
}

export function assertRmtUniswapV2V2ProductionProofEvidence(
  proof: RmtUniswapV2V2ProductionProofEvidence
) {
  const grossInput = BigInt(proof.userGrossInputAtomic);
  const actualFee = BigInt(proof.actualRmtFeeAtomic);
  const providerInput = BigInt(proof.providerInputAtomic);
  invariant(proof.chainId === 4_663 && proof.status === "PASS", "chain or status changed");
  invariant(proof.transactionHash === "0xb8ff9e561d4a333f5f91eb707daf6e8b00d0d0565de68355cf5966c1a6cdbb9e", "transaction changed");
  invariant(proof.blockNumber === "53089890", "block changed");
  invariant(proof.blockHash === "0x7b8f698dbc5bbb1aa00b3edb57d180d4b5dc764424df3e8f0c30514fa7540156", "block hash changed");
  invariant(proof.executionId === "0xccd068bd9b9cd7a9dc1a5acfa21bb0e6ac70a37fac6d0086d4e63819656fd8ad", "execution ID changed");
  exactAddress(proof.trader, getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"), "trader");
  exactAddress(proof.executor, getAddress("0xB4bF1d99a3BF9201f8197682dcD2bF97725D6230"), "executor");
  exactAddress(proof.treasury, getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC"), "treasury");
  exactAddress(proof.tokenAddress, getAddress("0x39dBED3a2bd333467115dE45665cC57F813C4571"), "token");
  exactAddress(proof.pair, getAddress("0x8018Ee3ad3c0321bE0e69536733CD28e29564dD4"), "pair");
  exactAddress(proof.pair1, zeroAddress, "pair1");
  invariant(proof.executorRuntimeHash === "0x3a0518035f7a47c752eba630e02db8a72b14c175977fbfcbf6d708ea1a36c647", "runtime changed");
  invariant(proof.policyId === "RMT_EXECUTION_V2" && proof.policyVersion === 2, "policy identity changed");
  invariant(proof.policyHash === "0x91c988a28bd8b308e57bfbd3a991571b663f1c5d8430f96dfa1db2e5cfb93484", "policy hash changed");
  invariant(proof.provider === "uniswap-v2" && proof.settlementMode === "VNEXT_V2_ATOMIC_INPUT_FEE", "provider or settlement changed");
  invariant(proof.feeBps === 25 && proof.feeSide === "input" && proof.inputAsset === zeroAddress, "fee authority changed");
  invariant(proof.token === "PONS" && proof.routeKind === "DIRECT", "asset or route changed");
  invariant(proof.v2WonNormalRanking && proof.rankingIncludedRmtFee, "ranking evidence changed");
  invariant(proof.userGrossInputAtomic === "100000000000000", "gross input changed");
  invariant(proof.actualRmtFeeAtomic === "250000000000", "actual fee changed");
  invariant(proof.providerInputAtomic === "99750000000000", "provider input changed");
  invariant(proof.protectedOutputAtomic === "463575468897451774", "protected output changed");
  invariant(proof.actualOutputAtomic === "468258049391365429", "actual output changed");
  invariant(actualFee === grossInput * BigInt(proof.feeBps) / 10_000n, "fee math changed");
  invariant(providerInput === grossInput - actualFee, "provider input math changed");
  invariant(BigInt(proof.actualOutputAtomic) >= BigInt(proof.protectedOutputAtomic), "protected output failed");
  invariant(proof.treasuryNativeDeltaAtomic === proof.actualRmtFeeAtomic, "treasury delta changed");
  invariant(proof.settlementEventCount === 1, "settlement event count changed");
  invariant(Object.values(proof.executorPostState).every((value) => value === "0"), "executor residue or Router allowance changed");
  invariant(proof.replayRejected, "replay status changed");
  invariant(proof.liveErc20ToNativeStatus === "OWNER_WAIVED_NOT_EXECUTED", "ERC20-to-native live status changed");
  invariant(proof.bidirectionalLiveProof === false, "bidirectional live proof was fabricated");
  return true;
}

export const RMT_UNISWAP_V2_V2_PRODUCTION_PROOF_EVIDENCE_VALID =
  assertRmtUniswapV2V2ProductionProofEvidence(RMT_UNISWAP_V2_V2_PRODUCTION_PROOF_EVIDENCE);
