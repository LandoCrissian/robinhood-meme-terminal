export type AfterBuyProtectionPreset = "off" | "tight" | "balanced" | "wide" | "custom";

export type AfterBuyProtectionSettings = {
  version: 1;
  preset: AfterBuyProtectionPreset;
  stopLossBps: number;
  trailingStopBps: number;
  breakEvenActivationBps: number;
  recoverPrincipal: boolean;
  stagedProfitLock: boolean;
};

const VALID_PRESETS = new Set<AfterBuyProtectionPreset>(["off", "tight", "balanced", "wide", "custom"]);
const VALID_STOP_BPS = new Set([500, 1000, 1500, 2000, 2500, 3000, 4000, 5000]);
const VALID_BREAK_EVEN_BPS = new Set([1000, 2500, 5000, 7500, 10000]);

export function afterBuyProtectionPreset(preset: AfterBuyProtectionPreset): AfterBuyProtectionSettings {
  if (preset === "tight") return {
    version: 1,
    preset,
    stopLossBps: 1_000,
    trailingStopBps: 1_000,
    breakEvenActivationBps: 2_500,
    recoverPrincipal: true,
    stagedProfitLock: true
  };
  if (preset === "wide") return {
    version: 1,
    preset,
    stopLossBps: 3_000,
    trailingStopBps: 3_000,
    breakEvenActivationBps: 7_500,
    recoverPrincipal: true,
    stagedProfitLock: true
  };
  return {
    version: 1,
    preset,
    stopLossBps: 2_000,
    trailingStopBps: 2_000,
    breakEvenActivationBps: 5_000,
    recoverPrincipal: true,
    stagedProfitLock: true
  };
}

export function normalizeAfterBuyProtectionSettings(value: unknown): AfterBuyProtectionSettings {
  if (!value || typeof value !== "object") return afterBuyProtectionPreset("off");
  const candidate = value as Partial<AfterBuyProtectionSettings>;
  if (
    candidate.version !== 1
    || typeof candidate.preset !== "string"
    || !VALID_PRESETS.has(candidate.preset as AfterBuyProtectionPreset)
    || !VALID_STOP_BPS.has(candidate.stopLossBps ?? -1)
    || !VALID_STOP_BPS.has(candidate.trailingStopBps ?? -1)
    || !VALID_BREAK_EVEN_BPS.has(candidate.breakEvenActivationBps ?? -1)
    || typeof candidate.recoverPrincipal !== "boolean"
    || typeof candidate.stagedProfitLock !== "boolean"
  ) return afterBuyProtectionPreset("off");
  return {
    version: 1,
    preset: candidate.preset as AfterBuyProtectionPreset,
    stopLossBps: candidate.stopLossBps!,
    trailingStopBps: candidate.trailingStopBps!,
    breakEvenActivationBps: candidate.breakEvenActivationBps!,
    recoverPrincipal: candidate.recoverPrincipal,
    stagedProfitLock: candidate.stagedProfitLock
  };
}

export function afterBuyProtectionEnabled(settings: AfterBuyProtectionSettings) {
  return settings.preset !== "off";
}
