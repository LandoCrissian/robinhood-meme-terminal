import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress } from "viem";
import {
  ACROSS_FUNDING_DEPLOYMENT_V1,
  acrossReviewedDeploymentPins,
  verifyAcrossFundingDeploymentAdmission,
  type AcrossFundingDeploymentAdmission
} from "./across-funding-deployment";
import { verifyAcrossReleaseDiscovery } from "../server/vnext-across-release-discovery";
import {
  acrossQuoteRemainsFreshAfterApproval,
  evaluateAcrossPostQuoteGasReadiness
} from "../server/vnext-across-gas-readiness";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID,
  TRUSTED_ASSET_ADDRESSES
} from "./trusted-asset-registry";
import type { AcrossFundingEvidence } from "../server/vnext-across-funding";

const chainIds = [ETHEREUM_MAINNET_CHAIN_ID, ARBITRUM_MAINNET_CHAIN_ID, BASE_MAINNET_CHAIN_ID, ROBINHOOD_MAINNET_CHAIN_ID] as const;
for (const chainId of chainIds) assert.equal(verifyAcrossFundingDeploymentAdmission(ACROSS_FUNDING_DEPLOYMENT_V1[chainId]), true);

function mutated(chainId: typeof chainIds[number], change: Partial<AcrossFundingDeploymentAdmission>) {
  return { ...ACROSS_FUNDING_DEPLOYMENT_V1[chainId], ...change } as AcrossFundingDeploymentAdmission;
}
assert.equal(verifyAcrossFundingDeploymentAdmission(mutated(1, { proxyRuntimeHash: `0x${"1".repeat(64)}` })), false);
assert.equal(verifyAcrossFundingDeploymentAdmission(mutated(1, { implementationAddress: getAddress("0x1111111111111111111111111111111111111111") })), false);
assert.equal(verifyAcrossFundingDeploymentAdmission(mutated(1, { implementationRuntimeHash: `0x${"2".repeat(64)}` })), false);
assert.equal(verifyAcrossFundingDeploymentAdmission(mutated(1, { evidenceBlockHash: `0x${"3".repeat(64)}` })), false);
assert.equal(verifyAcrossFundingDeploymentAdmission(mutated(1, { chainId: 42161 })), false);
for (const chainId of chainIds) {
  const evidenceBlock = (BigInt(ACROSS_FUNDING_DEPLOYMENT_V1[chainId].evidenceBlock) + 1n).toString();
  assert.equal(verifyAcrossFundingDeploymentAdmission(mutated(chainId, { evidenceBlock })), false);
}

const prefixes = [[1, "ETHEREUM"], [42161, "ARBITRUM"], [8453, "BASE"], [4663, "ROBINHOOD"]] as const;
const manifestEnvironment = Object.fromEntries(prefixes.flatMap(([chainId, prefix]) => {
  const value = ACROSS_FUNDING_DEPLOYMENT_V1[chainId];
  return [
    [`RMT_ACROSS_${prefix}_SPOKE_POOL_PROXY_CODE_HASH`, value.proxyRuntimeHash],
    [`RMT_ACROSS_${prefix}_SPOKE_POOL_IMPLEMENTATION_ADDRESS`, value.implementationAddress],
    [`RMT_ACROSS_${prefix}_SPOKE_POOL_IMPLEMENTATION_CODE_HASH`, value.implementationRuntimeHash]
  ];
}));
assert.ok(acrossReviewedDeploymentPins(manifestEnvironment));
assert.equal(acrossReviewedDeploymentPins({ ...manifestEnvironment, RMT_ACROSS_BASE_SPOKE_POOL_IMPLEMENTATION_CODE_HASH: `0x${"4".repeat(64)}` }), null);

const chains = chainIds.map((chainId) => ({ chainId, name: ACROSS_FUNDING_DEPLOYMENT_V1[chainId].chainName }));
const tokens = [
  { chainId: 1, address: TRUSTED_ASSET_ADDRESSES.ETHEREUM_USDC, decimals: 6 },
  { chainId: 42161, address: TRUSTED_ASSET_ADDRESSES.ARBITRUM_USDC, decimals: 6 },
  { chainId: 8453, address: TRUSTED_ASSET_ADDRESSES.BASE_USDC, decimals: 6 },
  { chainId: 4663, address: TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG, decimals: 6 }
];
assert.equal(verifyAcrossReleaseDiscovery({ chains, tokens }).legacyAvailableRoutesAuthoritative, false);
assert.throws(() => verifyAcrossReleaseDiscovery({ chains: chains.filter((chain) => chain.chainId !== 4663), tokens }), /chain 4663/);
assert.throws(() => verifyAcrossReleaseDiscovery({ chains, tokens: tokens.map((token) => token.chainId === 8453 ? { ...token, address: getAddress("0x1111111111111111111111111111111111111111") } : token) }), /asset on chain 8453/);
assert.throws(() => verifyAcrossReleaseDiscovery({ chains, tokens: tokens.map((token) => token.chainId === 4663 ? { ...token, decimals: 18 } : token) }), /asset on chain 4663/);

const gasBase = {
  chainId: BASE_MAINNET_CHAIN_ID,
  wallet: getAddress("0x1111111111111111111111111111111111111111"),
  approvalRequired: true,
  approvalGasEstimate: "50000",
  depositGasEstimate: "250000",
  feeCapBasis: { kind: "eip1559" as const, baseFeePerGasAtomic: "1000000000", priorityFeePerGasAtomic: "100000000", maxFeePerGasAtomic: "2100000000" },
  observedNativeBalanceAtomic: "1000000000000000000",
  observedBlockNumber: "100",
  observedBlockHash: `0x${"5".repeat(64)}` as const,
  observedAtMs: 1_700_000_000_000,
  validUntilMs: 1_700_000_120_000,
  approvalCalldataHash: `0x${"6".repeat(64)}` as const,
  depositCalldataHash: `0x${"7".repeat(64)}` as const
};
assert.equal(evaluateAcrossPostQuoteGasReadiness(gasBase).status, "sufficient");
assert.equal(evaluateAcrossPostQuoteGasReadiness({ ...gasBase, observedNativeBalanceAtomic: "1" }).status, "insufficient");
assert.equal(evaluateAcrossPostQuoteGasReadiness({ ...gasBase, depositGasEstimate: null }).status, "unavailable");

const evidence = { quoteExpiresAtMs: 1_700_000_100_000, fillDeadline: 1_700_000_100 } as AcrossFundingEvidence;
assert.equal(acrossQuoteRemainsFreshAfterApproval(evidence, 1_700_000_000_000), true);
assert.equal(acrossQuoteRemainsFreshAfterApproval(evidence, 1_700_000_100_000), false);

const fundingSource = readFileSync(new URL("../server/vnext-across-funding.ts", import.meta.url), "utf8");
const infrastructure = readFileSync(new URL("../../scripts/vnext-across-infrastructure-preflight.ts", import.meta.url), "utf8");
const quoteRoute = readFileSync(new URL("../../app/api/vnext/funding/across/quote/route.ts", import.meta.url), "utf8");
const spendBalance = readFileSync(new URL("../../app/vnext/spend-balance.tsx", import.meta.url), "utf8");
assert.doesNotMatch(fundingSource, /swapTx\.data\s*[+]=|swapTx\.data\s*=\s*`\$\{.*1dc0de/);
assert.doesNotMatch(infrastructure, /available-routes/);
assert.match(quoteRoute, /retiredTransactionPreparationResponse/);
assert.doesNotMatch(quoteRoute, /readAcrossPostQuoteGasReadiness|approvalTransaction|depositTransaction/);
for (const field of ["expectedOutputAtomic", "protectedOutputAtomic", "pendingCrossChainFundingOutput", "availableCrossChainFundingOutput"]) {
  assert.equal(spendBalance.includes(field), false, `${field} must never create wallet spend balance`);
}

console.log("RMT Across trust-rebind, deployment admission, gas-readiness, and no-phantom-credit checks passed.");
