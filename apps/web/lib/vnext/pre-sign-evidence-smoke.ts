import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseVNextPreSignEvidence, type VNextPreSignEvidence } from "./pre-sign-evidence";
import { zeroAddress } from "viem";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { directNoRmtFeeSettlement, VNEXT_DIRECT_NO_RMT_FEE } from "./execution-settlement";

const now = 1_786_000_000_000;
const evidence: VNextPreSignEvidence = {
  verificationId: "11111111-1111-4111-8111-111111111111",
  sourceQuoteRequestId: "22222222-2222-4222-8222-222222222222",
  provider: "uniswap-v3",
  status: "verified",
  chainId: 4_663,
  inputAsset: "0x1111111111111111111111111111111111111111",
  outputAsset: "0x2222222222222222222222222222222222222222",
  inputAmountAtomic: "1000000",
  indicativeProtectedOutputFloorAtomic: "980",
  expectedOutputAtomic: "1000",
  protectedOutputAtomic: "990",
  recipient: "0x3333333333333333333333333333333333333333",
  router: ROBINHOOD_SWAP_ROUTER_02,
  approvalSpender: ROBINHOOD_SWAP_ROUTER_02,
  approvalRequired: false,
  sufficientBalance: true,
  allowanceAtomic: "1000000",
  balanceAtomic: "2000000",
  route: "direct",
  fees: [3_000],
  pools: ["0x4444444444444444444444444444444444444444"],
  deadline: "1786000300",
  calldataHash: `0x${"1".repeat(64)}`,
  nextAction: "swap",
  nextActionTarget: ROBINHOOD_SWAP_ROUTER_02,
  nextActionCalldataHash: `0x${"1".repeat(64)}`,
  transactionValueAtomic: "0",
  nativeBalanceWei: "1000000000000000",
  gasPriceWei: "1000000000",
  feeCeilingWei: "3000000000",
  estimatedGasUnits: "100000",
  gasLimitUnits: "120000",
  estimatedNetworkCostWei: "360000000000000",
  estimatedNetworkCostUsdgAtomic: "750000",
  networkCostValuationSource: "canonical_uniswap_v3_weth_usdg_quote_plus_1pct",
  networkCostValuedAtMs: now - 1_000,
  networkCostValuationExpiresAtMs: now + 29_000,
  gasState: "sufficient",
  routerRuntimeHash: `0x${"2".repeat(64)}`,
  factoryRuntimeHash: `0x${"3".repeat(64)}`,
  quoterRuntimeHash: `0x${"4".repeat(64)}`,
  exactSimulationPassed: true,
  userPaysGas: true,
  rmtFeeEnabled: false,
  settlementMode: VNEXT_DIRECT_NO_RMT_FEE,
  directNoRmtFee: directNoRmtFeeSettlement("1000000"),
  verifiedAtMs: now - 1_000,
  expiresAtMs: now + 299_000,
  authorizationReady: false
};
const expected = {
  quoteRequestId: evidence.sourceQuoteRequestId,
  inputAsset: evidence.inputAsset,
  outputAsset: evidence.outputAsset,
  inputAmountAtomic: evidence.inputAmountAtomic,
  provider: evidence.provider,
  protectedOutputFloorAtomic: evidence.indicativeProtectedOutputFloorAtomic,
  recipient: evidence.recipient
};
assert.equal(parseVNextPreSignEvidence(evidence, expected, now).status, "verified");
assert.equal(parseVNextPreSignEvidence({ ...evidence, verifiedAtMs: now + 5_000 }, expected, now).status, "verified");
assert.throws(() => parseVNextPreSignEvidence({ ...evidence, verifiedAtMs: now + 5_001 }, expected, now), /inconsistent/);
assert.throws(() => parseVNextPreSignEvidence({ ...evidence, authorizationReady: true }, expected, now));
assert.throws(() => parseVNextPreSignEvidence({ ...evidence, exactSimulationPassed: false }, expected, now), /false verified/);
assert.throws(() => parseVNextPreSignEvidence({ ...evidence, protectedOutputAtomic: "1001" }, expected, now), /inconsistent/);
assert.throws(() => parseVNextPreSignEvidence({ ...evidence, indicativeProtectedOutputFloorAtomic: "981" }, expected, now), /inconsistent/);
assert.throws(() => parseVNextPreSignEvidence({ ...evidence, protectedOutputAtomic: "979" }, expected, now), /inconsistent/);
assert.throws(() => parseVNextPreSignEvidence({ ...evidence, expiresAtMs: now + 300_001 }, expected, now), /inconsistent/);
const nativeEvidence = {
  ...evidence,
  inputAsset: zeroAddress,
  inputAmountAtomic: "100000000000000",
  directNoRmtFee: directNoRmtFeeSettlement("100000000000000"),
  transactionValueAtomic: "100000000000000",
  balanceAtomic: evidence.nativeBalanceWei
};
const nativeExpected = {
  ...expected,
  inputAsset: zeroAddress,
  inputAmountAtomic: nativeEvidence.inputAmountAtomic
};
assert.equal(parseVNextPreSignEvidence(nativeEvidence, nativeExpected, now).transactionValueAtomic, nativeEvidence.inputAmountAtomic);
assert.throws(() => parseVNextPreSignEvidence({ ...nativeEvidence, transactionValueAtomic: "0" }, nativeExpected, now), /native transaction value/);
assert.equal(parseVNextPreSignEvidence({
  ...evidence,
  status: "approval_required",
  approvalRequired: true,
  exactSimulationPassed: false,
  allowanceAtomic: "0",
  nextAction: "approval",
  nextActionTarget: evidence.inputAsset,
  nextActionCalldataHash: `0x${"5".repeat(64)}`,
  transactionValueAtomic: "0"
}, expected, now).status, "approval_required");
assert.equal(parseVNextPreSignEvidence({
  ...evidence,
  status: "insufficient_gas",
  gasState: "insufficient",
  nativeBalanceWei: "1"
}, expected, now).status, "insufficient_gas");
assert.throws(() => parseVNextPreSignEvidence({
  ...evidence,
  estimatedNetworkCostWei: "1"
}, expected, now), /gas economics/);
assert.throws(() => parseVNextPreSignEvidence({
  ...evidence,
  feeCeilingWei: "999999999"
}, expected, now), /gas economics/);
assert.throws(() => parseVNextPreSignEvidence({
  ...evidence,
  networkCostValuationSource: null
}, expected, now), /incomplete network-cost valuation/);
assert.throws(() => parseVNextPreSignEvidence({
  ...evidence,
  networkCostValuationExpiresAtMs: now
}, expected, now), /stale or inconsistent network-cost valuation/);

const route = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
const verifier = readFileSync(new URL("../server/vnext-uniswap-quote.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(route, /requireAuthenticatedTradeWallet/);
assert.match(route, /readVNextVerifiedAssetIdentity/);
assert.match(route, /verifyRobinhoodVNextExecution/);
assert.match(route, /protectedOutputFloorAtomic/);
assert.match(verifier, /moved below the indicative protected-output floor/);
assert.match(verifier, /ROUTER_RUNTIME_HASH/);
assert.match(verifier, /FACTORY_RUNTIME_HASH/);
assert.match(verifier, /QUOTER_RUNTIME_HASH/);
assert.match(verifier, /functionName: "balanceOf"/);
assert.match(verifier, /functionName: "allowance"/);
assert.match(verifier, /functionName: "multicall"/);
assert.match(verifier, /client\.call/);
assert.match(verifier, /client\.estimateGas/);
assert.match(verifier, /client\.getGasPrice/);
assert.match(verifier, /client\.getBalance/);
assert.match(verifier, /estimatedGasUnits \* 120n \/ 100n/);
assert.match(verifier, /canonical_uniswap_v3_weth_usdg_quote_plus_1pct/);
assert.match(verifier, /WALLET_FEE_CEILING_MULTIPLIER = 3n/);
assert.match(verifier, /calldataHash: keccak256\(calldata\)/);
assert.match(verifier, /authorizationReady: false/);
assert.doesNotMatch(route, /writeContract|sendTransaction|signTypedData|database|firestore/);
assert.doesNotMatch(verifier, /writeContract|sendTransaction|signTypedData/);
assert.match(composer, /parseVNextPreSignEvidence/);
assert.match(composer, /\/api\/vnext\/verify/);
assert.match(composer, /Strict pre-sign evidence/);
assert.match(composer, /Authorization remains disabled/);
assert.match(composer, /Insufficient ETH for gas/);
assert.match(composer, /Robinhood ETH is required only for network gas/);
assert.match(composer, /<FundWalletButton directReceive variant="inline" label="Add Robinhood ETH" \/>/);
assert.match(composer, /estimatedNetworkCostWei/);
assert.match(composer, /estimatedNetworkCostUsdgAtomic/);
assert.match(composer, /selectVNextRoute/);
assert.match(composer, /selectedRoute\.verificationCandidate/);
assert.match(composer, /best strict-verification candidate/);
assert.match(composer, /Quote continuity/);
assert.match(composer, /Indicative floor held/);
assert.doesNotMatch(composer, /writeContract|sendTransaction|signTypedData|useSendTransaction/);

console.log("RMT VNext strict pre-sign evidence smoke checks passed.");
