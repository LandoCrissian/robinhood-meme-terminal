import { getAddress, isAddress, zeroAddress, type Address } from "viem";

export const RMT_EXECUTION_FEE_TARGET_BPS = 25;
export const RMT_EXECUTION_FEE_MAX_BPS = 100;
const UNIVERSAL_ROUTER_SENDER_SENTINEL = "0x0000000000000000000000000000000000000001";
const UNIVERSAL_ROUTER_SELF_SENTINEL = "0x0000000000000000000000000000000000000002";

export type RmtExecutionFeeConfig = {
  enabled: boolean;
  feeBps: number;
  treasury: Address | null;
};

export function parseRmtExecutionFeeConfig(env: {
  enabled?: string;
  feeBps?: string;
  treasury?: string;
}): RmtExecutionFeeConfig {
  const feeBps = Number(env.feeBps ?? RMT_EXECUTION_FEE_TARGET_BPS);
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > RMT_EXECUTION_FEE_MAX_BPS) {
    throw new Error(`RMT execution fee must be between 0 and ${RMT_EXECUTION_FEE_MAX_BPS} basis points.`);
  }

  const requested = env.enabled === "true";
  const treasuryInput = env.treasury?.trim();
  if (!requested) return { enabled: false, feeBps, treasury: null };
  if (!treasuryInput || !isAddress(treasuryInput, { strict: false })) {
    throw new Error("RMT execution fee requires an exact treasury address.");
  }

  const treasury = getAddress(treasuryInput);
  if (treasury.toLowerCase() === zeroAddress) {
    throw new Error("RMT execution fee treasury cannot be the zero address.");
  }
  if (
    treasury.toLowerCase() === UNIVERSAL_ROUTER_SENDER_SENTINEL
    || treasury.toLowerCase() === UNIVERSAL_ROUTER_SELF_SENTINEL
  ) {
    throw new Error("RMT execution fee treasury cannot use a Universal Router sentinel address.");
  }
  if (feeBps === 0) throw new Error("RMT execution fee cannot be enabled at zero basis points.");

  return { enabled: true, feeBps, treasury };
}

export function calculateRmtExecutionFee(grossOutput: bigint, feeBps: number) {
  if (grossOutput < 0n) throw new Error("Gross output cannot be negative.");
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > RMT_EXECUTION_FEE_MAX_BPS) {
    throw new Error(`RMT execution fee must be between 0 and ${RMT_EXECUTION_FEE_MAX_BPS} basis points.`);
  }
  const fee = grossOutput * BigInt(feeBps) / 10_000n;
  return { grossOutput, fee, netOutput: grossOutput - fee };
}

export function currentRmtExecutionFeeConfig() {
  return parseRmtExecutionFeeConfig({
    enabled: process.env.RMT_EXECUTION_FEE_ENABLED,
    feeBps: process.env.RMT_EXECUTION_FEE_BPS,
    treasury: process.env.RMT_EXECUTION_FEE_TREASURY
  });
}
