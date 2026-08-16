import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";

export type RmtUniswapV3FeeMainnetProof = {
  chainId: number;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  transactionIndex: number;
  receiptStatus: "success";
  trader: Address;
  executor: Address;
  executorRuntimeHash: Hex;
  executionId: Hex;
  policyIdHash: Hex;
  policyVersion: number;
  policyHash: Hex;
  providerId: Hex;
  router: Address;
  routeIdentity: Hex;
  pool: Address;
  inputAsset: Address;
  outputAsset: Address;
  treasury: Address;
  feeBps: number;
  feeSide: "input";
  userGrossInputAtomic: string;
  providerInputAtomic: string;
  grossActualOutputAtomic: string;
  actualRmtFeeAtomic: string;
  actualUserNetOutputAtomic: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  gasCostWei: string;
  walletBalances: {
    preUsdgAtomic: string;
    postUsdgAtomic: string;
    preWethAtomic: string;
    postWethAtomic: string;
    preNativeWei: string;
    postNativeWei: string;
  };
  treasuryBalances: {
    preFeeAssetAtomic: string;
    postFeeAssetAtomic: string;
  };
  executorPostState: {
    inputAssetAtomic: string;
    outputAssetAtomic: string;
    routerAllowanceAtomic: string;
    executionConsumed: true;
  };
  settlementEventCount: 1;
  minimumConfirmations: number;
};

/**
 * Immutable, independently reconciled evidence for the first controlled
 * RMT_EXECUTION_V1 mainnet settlement. This is public onchain evidence, not a
 * signing secret or transaction authority. Public routing still requires its
 * own server-only release gate and every pre-existing authorization gate.
 */
export const RMT_UNISWAP_V3_FEE_MAINNET_PROOF = {
  chainId: 4_663,
  transactionHash: "0xf2998e49b08e0d0bc4aeb4256c9e84bfeee888aae67db6262bfb94b4a8d9a6fb",
  blockNumber: "37772345",
  blockHash: "0x57076a6d22b99bc591ebb603bdee0cc5e9e8e2dd36ed40f02ec0ebc96aa988e1",
  transactionIndex: 2,
  receiptStatus: "success",
  trader: getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"),
  executor: getAddress("0xcB9c00524848038D211921e0f3975190D7Aa1e8f"),
  executorRuntimeHash: "0xc6d54277c89993410fa71ad24c7a6cea0072a4f0f20a8759a04d9e4a4c37813d",
  executionId: "0xa65dbc9b492453e76b8aa997d71401b62f0517ff0d0943dffdda48eae28d3edf",
  policyIdHash: "0xa7fdfdc2b754862dc94b4ab2366b10527c8dd297beee047425032426c01b4feb",
  policyVersion: 1,
  policyHash: "0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141",
  providerId: "0xf0053fdd2d810156fac49867b1b7098650da64e62c727083a69932e7378a07a7",
  router: getAddress("0xcaf681a66d020601342297493863e78c959e5cb2"),
  routeIdentity: "0x99c8c0e00c39fa0571f1ce026efdd83579eca17236b2f5441cbaca69bd5ce961",
  pool: getAddress("0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca"),
  inputAsset: getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
  outputAsset: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
  treasury: getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC"),
  feeBps: 25,
  feeSide: "input",
  userGrossInputAtomic: "100000",
  providerInputAtomic: "99750",
  grossActualOutputAtomic: "53073785359108",
  actualRmtFeeAtomic: "250",
  actualUserNetOutputAtomic: "53073785359108",
  gasUsed: "271381",
  effectiveGasPriceWei: "24108000",
  gasCostWei: "6542453148000",
  walletBalances: {
    preUsdgAtomic: "243432",
    postUsdgAtomic: "143432",
    preWethAtomic: "1593738836534778",
    postWethAtomic: "1646812621893886",
    preNativeWei: "2507699951877512",
    postNativeWei: "2501157498729512"
  },
  treasuryBalances: {
    preFeeAssetAtomic: "0",
    postFeeAssetAtomic: "250"
  },
  executorPostState: {
    inputAssetAtomic: "0",
    outputAssetAtomic: "0",
    routerAllowanceAtomic: "0",
    executionConsumed: true
  },
  settlementEventCount: 1,
  minimumConfirmations: 64
} as const satisfies RmtUniswapV3FeeMainnetProof;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RMT rejected invalid Uniswap V3 fee mainnet proof: ${message}.`);
}

function atomic(value: string, label: string) {
  invariant(/^(0|[1-9][0-9]*)$/.test(value), `${label} is not canonical`);
  return BigInt(value);
}

function hash(value: string, label: string) {
  invariant(/^0x[0-9a-fA-F]{64}$/.test(value) && value !== `0x${"0".repeat(64)}`, `${label} is invalid`);
}

function exactAddress(value: string, expected: string, label: string) {
  invariant(isAddress(value, { strict: false }) && getAddress(value) === getAddress(expected), `${label} changed`);
  invariant(getAddress(value) !== zeroAddress, `${label} is zero`);
}

export function assertRmtUniswapV3FeeMainnetProof(proof: RmtUniswapV3FeeMainnetProof) {
  invariant(proof.chainId === 4_663, "chain changed");
  invariant(proof.receiptStatus === "success", "receipt did not succeed");
  invariant(proof.transactionIndex >= 0, "transaction index is invalid");
  invariant(proof.settlementEventCount === 1, "settlement event is not unique");
  invariant(proof.minimumConfirmations >= 64, "confirmation floor is too low");
  hash(proof.transactionHash, "transaction hash");
  hash(proof.blockHash, "block hash");
  hash(proof.executionId, "execution ID");
  hash(proof.policyIdHash, "policy ID hash");
  hash(proof.policyHash, "policy hash");
  hash(proof.providerId, "provider ID");
  hash(proof.routeIdentity, "route identity");
  hash(proof.executorRuntimeHash, "executor runtime hash");
  invariant(proof.transactionHash === "0xf2998e49b08e0d0bc4aeb4256c9e84bfeee888aae67db6262bfb94b4a8d9a6fb", "transaction hash changed");
  invariant(proof.blockNumber === "37772345", "block number changed");
  invariant(proof.blockHash === "0x57076a6d22b99bc591ebb603bdee0cc5e9e8e2dd36ed40f02ec0ebc96aa988e1", "block hash changed");
  invariant(proof.transactionIndex === 2, "transaction index changed");
  invariant(proof.executorRuntimeHash === "0xc6d54277c89993410fa71ad24c7a6cea0072a4f0f20a8759a04d9e4a4c37813d", "executor runtime hash changed");
  invariant(proof.executionId === "0xa65dbc9b492453e76b8aa997d71401b62f0517ff0d0943dffdda48eae28d3edf", "execution ID changed");
  invariant(proof.policyIdHash === "0xa7fdfdc2b754862dc94b4ab2366b10527c8dd297beee047425032426c01b4feb", "policy ID hash changed");
  invariant(proof.policyHash === "0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141", "policy hash changed");
  invariant(proof.providerId === "0xf0053fdd2d810156fac49867b1b7098650da64e62c727083a69932e7378a07a7", "provider ID changed");
  invariant(proof.routeIdentity === "0x99c8c0e00c39fa0571f1ce026efdd83579eca17236b2f5441cbaca69bd5ce961", "route identity changed");
  invariant(atomic(proof.blockNumber, "block number") > 35_142_528n, "proof predates corrected executor deployment");
  exactAddress(proof.executor, "0xcB9c00524848038D211921e0f3975190D7Aa1e8f", "executor");
  exactAddress(proof.trader, "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA", "proof trader");
  exactAddress(proof.router, "0xcaf681a66d020601342297493863e78c959e5cb2", "router");
  exactAddress(proof.pool, "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca", "pool");
  exactAddress(proof.inputAsset, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "input asset");
  exactAddress(proof.outputAsset, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", "output asset");
  exactAddress(proof.treasury, "0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC", "treasury");
  invariant(proof.policyVersion === 1 && proof.feeBps === 25 && proof.feeSide === "input", "policy economics changed");
  const grossInput = atomic(proof.userGrossInputAtomic, "gross input");
  const providerInput = atomic(proof.providerInputAtomic, "provider input");
  const actualFee = atomic(proof.actualRmtFeeAtomic, "actual fee");
  const grossOutput = atomic(proof.grossActualOutputAtomic, "gross output");
  const userNetOutput = atomic(proof.actualUserNetOutputAtomic, "user net output");
  invariant(grossInput === 100_000n, "proof trade size changed");
  invariant(actualFee === grossInput * BigInt(proof.feeBps) / 10_000n, "fee math changed");
  invariant(providerInput === grossInput - actualFee, "provider input changed");
  invariant(grossOutput > 0n && userNetOutput === grossOutput, "input-side output changed");
  const balances = proof.walletBalances;
  invariant(atomic(balances.preUsdgAtomic, "pre USDG") - atomic(balances.postUsdgAtomic, "post USDG") === grossInput, "wallet USDG delta changed");
  invariant(atomic(balances.postWethAtomic, "post WETH") - atomic(balances.preWethAtomic, "pre WETH") === userNetOutput, "wallet WETH delta changed");
  const gasCost = atomic(proof.gasUsed, "gas used") * atomic(proof.effectiveGasPriceWei, "effective gas price");
  invariant(atomic(proof.gasCostWei, "gas cost") === gasCost, "gas accounting changed");
  invariant(atomic(balances.preNativeWei, "pre native") - atomic(balances.postNativeWei, "post native") === gasCost, "wallet native delta changed");
  invariant(
    atomic(proof.treasuryBalances.postFeeAssetAtomic, "treasury post balance")
      - atomic(proof.treasuryBalances.preFeeAssetAtomic, "treasury pre balance") === actualFee,
    "treasury delta changed"
  );
  invariant(
    proof.executorPostState.inputAssetAtomic === "0"
      && proof.executorPostState.outputAssetAtomic === "0"
      && proof.executorPostState.routerAllowanceAtomic === "0"
      && proof.executorPostState.executionConsumed === true,
    "executor residual or replay state changed"
  );
  return true;
}

export const RMT_UNISWAP_V3_FEE_MAINNET_PROOF_COMPLETE = assertRmtUniswapV3FeeMainnetProof(
  RMT_UNISWAP_V3_FEE_MAINNET_PROOF
);
