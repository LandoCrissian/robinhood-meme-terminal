import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quoteRoute = readFileSync(new URL("../../app/api/vnext/quotes/route.ts", import.meta.url), "utf8");
const verifyRoute = readFileSync(new URL("../../app/api/vnext/verify/route.ts", import.meta.url), "utf8");
const authorizeRoute = readFileSync(new URL("../../app/api/vnext/authorize/route.ts", import.meta.url), "utf8");
const verifier = readFileSync(new URL("../server/vnext-zero-x-firm-quote-verifier.ts", import.meta.url), "utf8");
const commitment = readFileSync(new URL("../server/vnext-zero-x-firm-quote-commitment.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");

for (const route of [quoteRoute, verifyRoute, authorizeRoute]) {
  assert.match(route, /requireAuthenticatedTradeWallet/);
  assert.match(route, /stockTokenExecutionPolicyErrorResponse/);
  assert.doesNotMatch(route, /readVNextVerifiedAssetIdentity|requireProjectIdentityExecutionAdmitted|projectIdentityAdmissionErrorResponse/,
    "Public swaps must not inherit inventory, metadata or project-curation admission");
}

assert.match(quoteRoute, /quoteRobinhoodVNextExecution/);
assert.match(verifyRoute, /verifyRobinhoodVNextExecution/);
assert.match(authorizeRoute, /verifyZeroXFirmQuoteCommitment/);
assert.match(authorizeRoute, /const chainTimestampSeconds = zeroXEvidence \? null : await readVNextAuthorizationChainTimestamp\(\)/,
  "0x authorization must age the committed provider quote without a redundant chain-clock RPC");

assert.match(verifier, /https:\/\/api\.0x\.org/);
assert.match(verifier, /\/swap\/allowance-holder\/quote/);
assert.match(verifier, /"0x-api-key": apiKey, "0x-version": "v2"/);
assert.match(verifier, /sellToken: toZeroXToken\(request\.inputAsset\)/);
assert.match(verifier, /buyToken: toZeroXToken\(request\.outputAsset\)/);
assert.match(verifier, /sellAmount: request\.inputAmountAtomic/);
assert.match(verifier, /taker: request\.recipient/);
assert.match(verifier, /recipient: request\.recipient/);
assert.match(verifier, /swapFeeBps: String\(RMT_ZERO_X_FEE_BPS\)/);
assert.match(verifier, /swapFeeRecipient: RMT_ZERO_X_FEE_TREASURY/);
assert.match(verifier, /swapFeeToken: toZeroXToken\(zeroXFeeAsset/);
assert.match(verifier, /providerReportedMinBuyAmount = positiveAtomic\(body\.minBuyAmount\)/);
assert.match(verifier, /transactionData: quote\.calldata/);
assert.match(verifier, /swapTransactionValueAtomic: quote\.transactionValueAtomic/);
assert.match(verifier, /providerSimulationIncomplete: quote\.simulationIncomplete/);
assert.doesNotMatch(verifier,
  /readVNextZeroXDeploymentAuthority|decodeZeroXExecutableMinimum|verifyZeroXEncodedFee|simulateZeroX|eth_getCode|eth_call|targetRuntimeHash|allowanceHolderRuntimeHash/,
  "The provider-native path must not re-prove 0x internals, runtime registries, calldata routes or swap simulation");

assert.match(commitment, /keccak256\(evidence\.transactionData\) !== evidence\.calldataHash/);
assert.match(commitment, /request\.amountIn\.toString\(\) !== evidence\.inputAmountAtomic/);
assert.match(commitment, /getAddress\(request\.recipient\) !== getAddress\(evidence\.recipient\)/);
assert.doesNotMatch(commitment, /decodeZeroXExecutableMinimum|verifyZeroXEncodedFee/);

assert.match(composer, /formatAtomicOrBaseUnits/);
assert.match(composer, /base units/);
assert.doesNotMatch(composer, /outputDecimals=\{pair\?\.outputAsset\.decimals \?\? 18\}/,
  "Unknown output units must not be silently rendered as 18 decimals");

console.log("Provider-native public swap dependency removal, official 0x binding, immutable commitment and base-unit fallback checks passed.");
