import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import { confirmedVNextFeePresentation } from "./confirmed-fee-receipt";
import {
  readVNextExecutionJournal,
  resolveVNextExecution,
  settledVNextFeeExecution,
  VNEXT_EXECUTION_STORAGE_KEY,
  type VNextExecutionRecord,
  type VNextExecutionStorage
} from "./execution-recovery";
import { RMT_UNISWAP_V3_PROVIDER_ID, rmtUniswapV3FeeExecutorAbi } from "./uniswap-v3-fee-executor";
import {
  RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE,
  RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE_COMPLETE
} from "./uniswap-v3-v1-production-canary-evidence";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";

const canaryTx = "0x4aad695ebc307042503a03ca8932153d946a6d708eecd9357f322b8f9f5442d7" as const;
const executor = getAddress("0xcB9c00524848038D211921e0f3975190D7Aa1e8f");
const treasury = getAddress("0x61700479A4A1F62584Fd3ABA2c2b290EA727d2eC");
const trader = getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA");
const pons = getAddress("0x39dbed3a2bd333467115de45665cc57f813c4571");
const executionId = "0xc663702d5f2f824b97dac4d395aca44db73befb4c6ccaa7d2b3cb57046b916d6" as const;
const policyIdHash = "0xa7fdfdc2b754862dc94b4ab2366b10527c8dd297beee047425032426c01b4feb" as const;
const policyHash = "0x295c900143405bb585a4d88c3788fadab522fd4313f69242f64e52e39827f141" as const;
const routeIdentity = "0x6ec4d1361e126bf60bc52d5558f747f628750d9985fc59efb2118657df97f798" as const;
const grossInput = 100_000_000_000_000n;
const providerInput = 99_750_000_000_000n;
const actualFee = 250_000_000_000n;
const actualOutput = 607_631_331_538_178_711n;
const protectedOutput = 601_800_840_984_940_167n;
const now = 1_788_192_200_000;
assert.equal(RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE_COMPLETE, true);
assert.equal(RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE.transactionHash, canaryTx);
assert.equal(RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE.actualRmtFeeAtomic, actualFee.toString());
assert.equal(RMT_UNISWAP_V3_V1_PRODUCTION_CANARY_EVIDENCE.actualUserNetOutputAtomic, actualOutput.toString());

const record: VNextExecutionRecord = {
  schemaVersion: 1,
  chainId: 4_663,
  wallet: trader,
  provider: "uniswap-v3",
  kind: "swap",
  inputAsset: zeroAddress,
  outputAsset: pons,
  inputAmountAtomic: grossInput.toString(),
  feeSettlement: {
    executor,
    executionId,
    policyIdHash,
    policyHash,
    policyVersion: 1,
    treasury,
    feeAsset: zeroAddress,
    feeBps: 25,
    feeSide: "input",
    routeIdentity,
    providerInputAtomic: providerInput.toString(),
    protectedUserNetOutputAtomic: protectedOutput.toString(),
    maximumFeeAtomic: actualFee.toString()
  },
  planId: "4aad695e-bc30-4042-903a-03ca8932153d",
  payloadHash: `0x${"9".repeat(64)}`,
  deadline: "1788192175",
  txHash: canaryTx,
  state: "submitted",
  submittedAtMs: now,
  updatedAtMs: now
};

const settlementDataParameters = parseAbiParameters(
  "bytes32 policyIdHash, uint256 policyVersion, bytes32 providerId, address router, bytes32 routeIdentity, address feeAsset, uint16 feeBps, uint8 feeSide, uint256 userGrossInput, uint256 providerInput, uint256 grossActualOutput, uint256 actualRmtFee, uint256 actualUserNetOutput, address treasury"
);
type SettlementValues = {
  emitter: Address;
  executionId: Hex;
  policyHash: Hex;
  trader: Address;
  policyIdHash: Hex;
  policyVersion: bigint;
  providerId: Hex;
  router: Address;
  routeIdentity: Hex;
  feeAsset: Address;
  feeBps: number;
  feeSide: number;
  userGrossInput: bigint;
  providerInput: bigint;
  grossActualOutput: bigint;
  actualRmtFee: bigint;
  actualUserNetOutput: bigint;
  treasury: Address;
};
const canonicalValues: SettlementValues = {
  emitter: executor,
  executionId,
  policyHash,
  trader,
  policyIdHash,
  policyVersion: 1n,
  providerId: RMT_UNISWAP_V3_PROVIDER_ID,
  router: ROBINHOOD_SWAP_ROUTER_02,
  routeIdentity,
  feeAsset: zeroAddress,
  feeBps: 25,
  feeSide: 0,
  userGrossInput: grossInput,
  providerInput,
  grossActualOutput: actualOutput,
  actualRmtFee: actualFee,
  actualUserNetOutput: actualOutput,
  treasury
};

function settlementLog(overrides: Partial<SettlementValues> = {}) {
  const values = { ...canonicalValues, ...overrides };
  const topics = encodeEventTopics({
    abi: rmtUniswapV3FeeExecutorAbi,
    eventName: "RMTUniswapV3FeeSettled",
    args: { executionId: values.executionId, policyHash: values.policyHash, trader: values.trader }
  }).flatMap((topic) => typeof topic === "string" ? [topic as Hex] : []);
  const data = encodeAbiParameters(settlementDataParameters, [
    values.policyIdHash, values.policyVersion, values.providerId, values.router,
    values.routeIdentity, values.feeAsset, values.feeBps, values.feeSide,
    values.userGrossInput, values.providerInput, values.grossActualOutput,
    values.actualRmtFee, values.actualUserNetOutput, values.treasury
  ]);
  return { address: values.emitter, topics, data };
}

const exactCanaryLog = {
  address: executor,
  topics: [
    "0xb5b9019547037bceeeebe2789d6d37098104b30017e12d2f12be47c13a0bdab5",
    executionId,
    policyHash,
    "0x0000000000000000000000007e8e7d3af28584a8b9eeddbe16cd3308bd1e76ca"
  ] as Hex[],
  data: "0xa7fdfdc2b754862dc94b4ab2366b10527c8dd297beee047425032426c01b4feb0000000000000000000000000000000000000000000000000000000000000001f0053fdd2d810156fac49867b1b7098650da64e62c727083a69932e7378a07a7000000000000000000000000caf681a66d020601342297493863e78c959e5cb26ec4d1361e126bf60bc52d5558f747f628750d9985fc59efb2118657df97f79800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000019000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005af3107a400000000000000000000000000000000000000000000000000000005ab8db50fc00000000000000000000000000000000000000000000000000086ebd7a06bb12970000000000000000000000000000000000000000000000000000003a35294400000000000000000000000000000000000000000000000000086ebd7a06bb129700000000000000000000000061700479a4a1f62584fd3aba2c2b290ea727d2ec" as Hex
};

const settlement = settledVNextFeeExecution(record, [exactCanaryLog]);
assert.deepEqual(settlement, {
  outputAmountAtomic: actualOutput.toString(),
  actualFeeAtomic: actualFee.toString(),
  grossActualOutputAtomic: actualOutput.toString(),
  actualUserNetOutputAtomic: actualOutput.toString()
});
assert.equal(settledVNextFeeExecution(record, []), null, "missing settlement evidence must fail closed");
assert.equal(settledVNextFeeExecution(record, [exactCanaryLog, exactCanaryLog]), null, "duplicate settlement evidence must fail closed");

const wrong = "0x1111111111111111111111111111111111111111" as const;
const mutations: Partial<SettlementValues>[] = [
  { emitter: wrong },
  { executionId: `0x${"1".repeat(64)}` },
  { policyHash: `0x${"2".repeat(64)}` },
  { trader: wrong },
  { treasury: wrong },
  { feeBps: 26 },
  { userGrossInput: grossInput + 1n },
  { providerInput: providerInput + 1n },
  { actualRmtFee: actualFee + 1n },
  { actualUserNetOutput: protectedOutput - 1n, grossActualOutput: protectedOutput - 1n }
];
mutations.forEach((mutation) => assert.equal(settledVNextFeeExecution(record, [settlementLog(mutation)]), null));

const values = new Map<string, string>();
const storage: VNextExecutionStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); }
};
values.set(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, executions: [record], walletRequests: [] }));
const confirmed = resolveVNextExecution(canaryTx, "confirmed", storage, now + 1, settlement!);
assert.equal(confirmed?.feeSettlement?.actualFeeAtomic, actualFee.toString());
assert.equal(confirmed?.feeSettlement?.grossActualOutputAtomic, actualOutput.toString());
assert.equal(confirmed?.feeSettlement?.actualUserNetOutputAtomic, actualOutput.toString());
assert.equal(readVNextExecutionJournal(storage, now + 2)[0]?.feeSettlement?.actualUserNetOutputAtomic, actualOutput.toString());

assert.deepEqual(confirmedVNextFeePresentation({
  record: confirmed,
  inputDecimals: 18,
  outputDecimals: 18,
  inputSymbol: "ETH",
  outputSymbol: "PONS"
}), { state: "settled", display: "0.00000025 ETH" });
assert.deepEqual(confirmedVNextFeePresentation({
  record: { ...confirmed!, feeSettlement: { ...confirmed!.feeSettlement!, actualFeeAtomic: undefined } },
  inputDecimals: 18,
  outputDecimals: 18,
  inputSymbol: "ETH",
  outputSymbol: "PONS"
}), { state: "unavailable", display: "RMT fee reconciliation unavailable" });
assert.equal(resolveVNextExecution(canaryTx, "confirmed", storage, now + 3, {
  outputAmountAtomic: actualOutput.toString()
}), null, "confirmed V1 resolution must not default missing canonical fee evidence to zero");

console.log("Exact V1 production canary receipt, persistence, adversarial reconciliation, and fee display checks passed.");
