import { getAddress, isAddress } from "viem";
import {
  acrossFundingSourceChain,
  prepareAcrossFundingPreflightQuote,
  readAcrossFundingWalletReadiness,
  trustedAcrossFundingPair
} from "../lib/server/vnext-across-funding";

async function main() {
  const chainId = acrossFundingSourceChain(Number(process.env.RMT_ACROSS_PREFLIGHT_SOURCE_CHAIN_ID));
  const sourceToken = process.env.RMT_ACROSS_PREFLIGHT_SOURCE_TOKEN?.trim() ?? "";
  const wallet = process.env.RMT_ACROSS_PREFLIGHT_WALLET?.trim() ?? "";
  const amount = process.env.RMT_ACROSS_PREFLIGHT_AMOUNT_ATOMIC?.trim() ?? "";
  if (!chainId || !isAddress(sourceToken, { strict: false }) || !isAddress(wallet, { strict: false }) || !/^[1-9][0-9]{0,77}$/.test(amount)) {
    throw new Error("Set a trusted source chain, exact source token, funded wallet, and atomic amount for the read-only Across preflight.");
  }
  const token = getAddress(sourceToken);
  const recipient = getAddress(wallet);
  if (!trustedAcrossFundingPair(chainId, token)) throw new Error("The requested preflight pair is not in RMT's trusted registry.");
  const walletReadiness = await readAcrossFundingWalletReadiness({
    sourceChainId: chainId,
    sourceToken: token,
    wallet: recipient,
    requestedInputAtomic: amount
  });
  if (!walletReadiness.fundedPreflightReady) {
    throw new Error(JSON.stringify({
      status: "source_wallet_not_funded",
      sourceChainId: chainId,
      sourceToken: token,
      wallet: recipient,
      requestedInputAtomic: amount,
      sourceBalanceAtomic: walletReadiness.sourceBalanceAtomic,
      nativeGasBalanceAtomic: walletReadiness.nativeGasBalanceAtomic,
      sufficientSourceBalance: walletReadiness.sufficientSourceBalance,
      hasNativeGas: walletReadiness.hasNativeGas,
      transactionAttempted: false
    }));
  }
  const prepared = await prepareAcrossFundingPreflightQuote({
    sourceChainId: chainId,
    sourceToken: token,
    inputAmountAtomic: amount,
    depositor: recipient,
    recipient,
    requestedAtMs: Date.now()
  });
  console.log(JSON.stringify({
    status: "strict_read_only_preflight_passed",
    sourceChainId: prepared.evidence.sourceChainId,
    destinationChainId: prepared.evidence.destinationChainId,
    sourceToken: prepared.evidence.sourceToken,
    sourceBalanceAtomic: walletReadiness.sourceBalanceAtomic,
    nativeGasBalanceAtomic: walletReadiness.nativeGasBalanceAtomic,
    fundedPreflightReady: walletReadiness.fundedPreflightReady,
    destinationToken: prepared.evidence.destinationToken,
    inputAmountAtomic: prepared.evidence.inputAmountAtomic,
    expectedOutputAtomic: prepared.evidence.expectedOutputAtomic,
    protectedOutputAtomic: prepared.evidence.protectedOutputAtomic,
    totalFeeAtomic: prepared.evidence.totalFeeAtomic,
    expectedCompletionSeconds: prepared.evidence.expectedCompletionSeconds,
    recipient: prepared.evidence.recipient,
    refundChainId: prepared.evidence.refundChainId,
    refundToken: prepared.evidence.refundToken,
    quoteExpiresAtMs: prepared.evidence.quoteExpiresAtMs,
    sourceSpokePool: prepared.evidence.sourceSpokePool,
    sourceImplementation: prepared.evidence.sourceSpokePoolImplementation,
    destinationSpokePool: prepared.evidence.destinationSpokePool,
    destinationImplementation: prepared.evidence.destinationSpokePoolImplementation,
    approvalRequired: prepared.approvalRequired,
    userAuthorizationRequired: true,
    serverSubmissionEnabled: false
  }, null, 2));
}

void main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : "Across funding preflight failed.");
  process.exitCode = 1;
});
