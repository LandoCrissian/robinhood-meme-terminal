import { getAddress, type Address, type Hex } from "viem";
import {
  parseVNextAuthorizationPlan,
  VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS,
  type VNextAuthorizationPlan
} from "./authorization-plan";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./robinhood-assets";

export type VNextWalletTransaction = {
  account: Address;
  chainId: 4_663;
  to: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
};

const WALLET_FEE_CEILING_MULTIPLIER = 3n;

export function assessVNextWalletGasReadiness(input: {
  nativeBalanceWei: bigint;
  currentGasPriceWei: bigint;
  evidenceFeeCeilingWei: string;
  gasLimitUnits: string;
  transactionValueAtomic?: string;
}) {
  if (input.nativeBalanceWei < 0n || input.currentGasPriceWei <= 0n) throw new Error("RMT rejected invalid live gas inputs.");
  if (!/^[1-9][0-9]*$/.test(input.evidenceFeeCeilingWei) || !/^[1-9][0-9]*$/.test(input.gasLimitUnits)) {
    throw new Error("RMT rejected incomplete verified gas evidence.");
  }
  if (input.transactionValueAtomic !== undefined && !/^(0|[1-9][0-9]*)$/.test(input.transactionValueAtomic)) {
    throw new Error("RMT rejected invalid native transaction value.");
  }
  const evidenceFeeCeiling = BigInt(input.evidenceFeeCeilingWei);
  const liveFeeCeiling = input.currentGasPriceWei * WALLET_FEE_CEILING_MULTIPLIER;
  const effectiveFeeCeiling = liveFeeCeiling > evidenceFeeCeiling ? liveFeeCeiling : evidenceFeeCeiling;
  const transactionValue = BigInt(input.transactionValueAtomic ?? "0");
  const requiredWei = transactionValue + BigInt(input.gasLimitUnits) * effectiveFeeCeiling;
  const shortfallWei = input.nativeBalanceWei >= requiredWei ? 0n : requiredWei - input.nativeBalanceWei;
  return {
    ready: shortfallWei === 0n,
    availableWei: input.nativeBalanceWei,
    requiredWei,
    shortfallWei,
    effectiveFeeCeilingWei: effectiveFeeCeiling
  };
}

export function prepareVNextWalletTransaction(input: {
  plan: VNextAuthorizationPlan;
  evidence: VNextPreSignEvidence;
  connectedAddress: string;
  connectedChainId: number;
  nowMs: number;
}): VNextWalletTransaction {
  if (input.connectedChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
    throw new Error("RMT rejected wallet submission on the wrong chain.");
  }
  const account = getAddress(input.connectedAddress);
  if (account !== getAddress(input.plan.recipient)) {
    throw new Error("RMT rejected a wallet that does not match the verified recipient.");
  }
  const exact = parseVNextAuthorizationPlan(input.plan, input.evidence, input.nowMs);
  if (Number(BigInt(exact.deadline) * 1_000n) - input.nowMs < VNEXT_MINIMUM_WALLET_REVIEW_RUNWAY_MS) {
    throw new Error("The verified wallet-review runway expired. Refresh the verified request before opening the wallet.");
  }
  return {
    account,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    to: getAddress(exact.target),
    data: exact.data,
    value: BigInt(exact.value),
    gas: BigInt(exact.gasLimit)
  };
}
