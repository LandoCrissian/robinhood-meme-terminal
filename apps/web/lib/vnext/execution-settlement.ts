import { getAddress, isAddress, keccak256, type Hex } from "viem";

export const VNEXT_DIRECT_NO_RMT_FEE = "DIRECT_NO_RMT_FEE" as const;
export const VNEXT_V2_ATOMIC_INPUT_FEE = "V2_ATOMIC_INPUT_FEE" as const;
export const VNEXT_LEGACY_V1_FEE = "LEGACY_V1_FEE" as const;

export type VNextExecutionSettlementMode =
  | typeof VNEXT_DIRECT_NO_RMT_FEE
  | typeof VNEXT_V2_ATOMIC_INPUT_FEE
  | typeof VNEXT_LEGACY_V1_FEE;
export type VNextWalletSettlementMode =
  | typeof VNEXT_DIRECT_NO_RMT_FEE
  | typeof VNEXT_V2_ATOMIC_INPUT_FEE
  | typeof VNEXT_LEGACY_V1_FEE;

export type VNextDirectNoRmtFeeSettlement = {
  mode: typeof VNEXT_DIRECT_NO_RMT_FEE;
  rmtFeeEnabled: false;
  userGrossInputAtomic: string;
  providerInputAtomic: string;
  rmtFeeAtomic: "0";
  treasuryTransferAtomic: "0";
  feeRecipient: null;
  feePolicyRequired: false;
  feeExecutorRequired: false;
};

export type VNextDirectExecutionBinding = {
  mode: typeof VNEXT_DIRECT_NO_RMT_FEE;
  provider: "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "up-v2" | "up-cl";
  kind: "erc20_approval" | "swap";
  chainId: 4_663;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  providerTarget: string;
  executionTarget: string;
  approvalSpender: string;
  approvalAmountAtomic: string;
  calldataHash: Hex;
  valueAtomic: string;
  deadline: string;
};

const ATOMIC = /^(0|[1-9][0-9]*)$/;

export function directNoRmtFeeSettlement(inputAmountAtomic: string): VNextDirectNoRmtFeeSettlement {
  if (!ATOMIC.test(inputAmountAtomic) || BigInt(inputAmountAtomic) <= 0n) {
    throw new Error("RMT rejected an invalid fee-free gross input.");
  }
  return {
    mode: VNEXT_DIRECT_NO_RMT_FEE,
    rmtFeeEnabled: false,
    userGrossInputAtomic: inputAmountAtomic,
    providerInputAtomic: inputAmountAtomic,
    rmtFeeAtomic: "0",
    treasuryTransferAtomic: "0",
    feeRecipient: null,
    feePolicyRequired: false,
    feeExecutorRequired: false
  };
}

export function assertVNextDirectNoRmtFeeSettlement(
  value: VNextDirectNoRmtFeeSettlement | undefined,
  inputAmountAtomic: string
) {
  if (
    !value
    || value.mode !== VNEXT_DIRECT_NO_RMT_FEE
    || value.rmtFeeEnabled !== false
    || value.userGrossInputAtomic !== inputAmountAtomic
    || value.providerInputAtomic !== inputAmountAtomic
    || value.rmtFeeAtomic !== "0"
    || value.treasuryTransferAtomic !== "0"
    || value.feeRecipient !== null
    || value.feePolicyRequired !== false
    || value.feeExecutorRequired !== false
  ) throw new Error("RMT rejected inconsistent DIRECT_NO_RMT_FEE settlement evidence.");
  return true;
}

export function directExecutionBinding(input: Omit<VNextDirectExecutionBinding, "mode" | "calldataHash"> & { data: Hex }): VNextDirectExecutionBinding {
  if (
    input.chainId !== 4_663
    || !isAddress(input.inputAsset)
    || !isAddress(input.outputAsset)
    || !isAddress(input.recipient)
    || !isAddress(input.providerTarget)
    || !isAddress(input.executionTarget)
    || !isAddress(input.approvalSpender)
    || !ATOMIC.test(input.inputAmountAtomic)
    || BigInt(input.inputAmountAtomic) <= 0n
    || !ATOMIC.test(input.protectedOutputAtomic)
    || BigInt(input.protectedOutputAtomic) <= 0n
    || input.approvalAmountAtomic !== input.inputAmountAtomic
    || !ATOMIC.test(input.valueAtomic)
    || !/^[1-9][0-9]*$/.test(input.deadline)
  ) throw new Error("RMT rejected an invalid fee-free execution binding.");
  const { data, ...fields } = input;
  return {
    ...fields,
    mode: VNEXT_DIRECT_NO_RMT_FEE,
    inputAsset: getAddress(input.inputAsset),
    outputAsset: getAddress(input.outputAsset),
    recipient: getAddress(input.recipient),
    providerTarget: getAddress(input.providerTarget),
    executionTarget: getAddress(input.executionTarget),
    approvalSpender: getAddress(input.approvalSpender),
    calldataHash: keccak256(data)
  };
}

export function assertVNextDirectExecutionBinding(input: {
  binding: VNextDirectExecutionBinding | undefined;
  provider: VNextDirectExecutionBinding["provider"];
  kind: VNextDirectExecutionBinding["kind"];
  chainId: number;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  providerTarget: string;
  executionTarget: string;
  approvalSpender: string;
  data: Hex;
  valueAtomic: string;
  deadline: string;
}) {
  const binding = input.binding;
  if (
    !binding
    || binding.mode !== VNEXT_DIRECT_NO_RMT_FEE
    || binding.provider !== input.provider
    || binding.kind !== input.kind
    || binding.chainId !== input.chainId
    || getAddress(binding.inputAsset) !== getAddress(input.inputAsset)
    || getAddress(binding.outputAsset) !== getAddress(input.outputAsset)
    || binding.inputAmountAtomic !== input.inputAmountAtomic
    || binding.protectedOutputAtomic !== input.protectedOutputAtomic
    || getAddress(binding.recipient) !== getAddress(input.recipient)
    || getAddress(binding.providerTarget) !== getAddress(input.providerTarget)
    || getAddress(binding.executionTarget) !== getAddress(input.executionTarget)
    || getAddress(binding.approvalSpender) !== getAddress(input.approvalSpender)
    || binding.approvalAmountAtomic !== input.inputAmountAtomic
    || binding.calldataHash.toLowerCase() !== keccak256(input.data).toLowerCase()
    || binding.valueAtomic !== input.valueAtomic
    || binding.deadline !== input.deadline
  ) throw new Error("RMT rejected changed DIRECT_NO_RMT_FEE execution authority.");
  return true;
}
