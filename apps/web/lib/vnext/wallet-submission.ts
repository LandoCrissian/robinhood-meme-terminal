import { getAddress, type Address, type Hex } from "viem";
import { parseVNextAuthorizationPlan, type VNextAuthorizationPlan } from "./authorization-plan";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./robinhood-assets";

export type VNextWalletTransaction = {
  account: Address;
  chainId: 4_663;
  to: Address;
  data: Hex;
  value: 0n;
  gas: bigint;
};

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
  return {
    account,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    to: getAddress(exact.target),
    data: exact.data,
    value: 0n,
    gas: BigInt(exact.gasLimit)
  };
}
