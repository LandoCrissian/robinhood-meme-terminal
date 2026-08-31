import { getAddress, zeroAddress } from "viem";

/**
 * Immutable public-chain evidence from the first owner-confirmed production UI
 * canary. This is historical observation only: it does not authorize execution,
 * fee activation, deployment, or a replacement for the controlled release proof.
 */
export const RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE = {
  chainId: 4_663,
  transactionHash: "0x4aad695ebc307042503a03ca8932153d946a6d708eecd9357f322b8f9f5442d7",
  blockNumber: "50989643",
  blockHash: "0xfa400dd770a7e611d2613aca2782d196cfd6498e82ac5dfe4def8ea585f4f436",
  blockTimestamp: "2026-08-31T15:59:12Z",
  transactionIndex: 1,
  receiptStatus: "success",
  trader: getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA"),
  executor: getAddress("0xcB9c00524848038D211921e0f3975190D7Aa1e8f"),
  executorRuntimeHash: "0xc6d54277c89993410fa71ad24c7a6cea0072a4f0f20a8759a04d9e4a4c37813d",
  executionId: "0xc663702d5f2f824b97dac4d395aca44db73befb4c6ccaa7d2b3cb57046b916d6",
  policyIdHash: "0xa7fdfdc2b754862dc94b4ab2366b10527c8dd297beee047425032426c01b4feb",
  policyVersion: 1,
  policyHash: "0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141",
  providerId: "0xf0053fdd2d810156fac49867b1b7098650da64e62c727083a69932e7378a07a7",
  router: getAddress("0xcaf681a66d020601342297493863E78C959E5cb2"),
  routeIdentity: "0x6ec4d1361e126bf60bc52d5558f747f628750d9985fc59efb2118657df97f798",
  pool: getAddress("0xEd50bDeeA8aDC232f159486192a4157281D722ff"),
  inputAsset: zeroAddress,
  outputAsset: getAddress("0x39dbed3a2bd333467115de45665cc57f813c4571"),
  treasury: getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC"),
  feeBps: 25,
  feeSide: "input",
  userGrossInputAtomic: "100000000000000",
  providerInputAtomic: "99750000000000",
  protectedUserNetOutputAtomic: "601800840984940167",
  grossActualOutputAtomic: "607631331538178711",
  actualRmtFeeAtomic: "250000000000",
  actualUserNetOutputAtomic: "607631331538178711",
  settlementEventCount: 1,
  treasurySafeReceivedCount: 1,
  treasurySafeReceivedSender: getAddress("0xcB9c00524848038D211921e0f3975190D7Aa1e8f"),
  treasurySafeReceivedAtomic: "250000000000",
  gasUsed: "225934",
  effectiveGasPriceWei: "276790000",
  gasCostWei: "62536271860000",
  executorPostState: {
    nativeAtomic: "0",
    canonicalWethAtomic: "0",
    outputAssetAtomic: "0",
    routerAllowanceAtomic: "0"
  }
} as const;

export function assertRmtUniswapV3V1ProductionCanaryEvidence() {
  const proof = RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE;
  const grossInput = BigInt(proof.userGrossInputAtomic);
  const providerInput = BigInt(proof.providerInputAtomic);
  const actualFee = BigInt(proof.actualRmtFeeAtomic);
  if (
    proof.chainId !== 4_663 || proof.receiptStatus !== "success"
    || proof.settlementEventCount !== 1 || proof.treasurySafeReceivedCount !== 1
    || proof.feeBps !== 25 || proof.feeSide !== "input"
    || actualFee !== grossInput * 25n / 10_000n
    || providerInput !== grossInput - actualFee
    || proof.grossActualOutputAtomic !== proof.actualUserNetOutputAtomic
    || BigInt(proof.actualUserNetOutputAtomic) < BigInt(proof.protectedUserNetOutputAtomic)
    || proof.treasurySafeReceivedSender !== proof.executor
    || proof.treasurySafeReceivedAtomic !== proof.actualRmtFeeAtomic
    || BigInt(proof.gasUsed) * BigInt(proof.effectiveGasPriceWei) !== BigInt(proof.gasCostWei)
    || Object.values(proof.executorPostState).some((value) => value !== "0")
  ) throw new Error("RMT rejected inconsistent V1 production canary evidence.");
  return true;
}

export const RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE_COMPLETE =
  assertRmtUniswapV3V1ProductionCanaryEvidence();
