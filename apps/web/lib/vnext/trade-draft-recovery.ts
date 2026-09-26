import type { TradeSide } from "./intent-draft";

export const RMT_TRADE_DRAFT_RECOVERY_KEY = "rmt:trade-draft-recovery:v1";
export const RMT_TRADE_DRAFT_RECOVERY_MAX_AGE_MS = 10 * 60 * 1_000;

export type RmtTradeDraftRecovery = {
  amount: string;
  buyInputKey?: string;
  marketAddress: string;
  savedAtMs: number;
  sellOutputKey?: string;
  side: TradeSide;
};

type DraftStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function boundedKey(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : undefined;
}

function validAmount(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 80
    && /^[0-9.]*$/.test(value);
}

function validMarketAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function persistRmtTradeDraftRecovery(storage: DraftStorage, draft: RmtTradeDraftRecovery) {
  if (!validMarketAddress(draft.marketAddress) || !validAmount(draft.amount)
    || (draft.side !== "buy" && draft.side !== "sell") || !Number.isSafeInteger(draft.savedAtMs)) return false;
  try {
    storage.setItem(RMT_TRADE_DRAFT_RECOVERY_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function consumeRmtTradeDraftRecovery(
  storage: DraftStorage,
  expectedMarketAddress: string,
  nowMs = Date.now()
): RmtTradeDraftRecovery | undefined {
  let encoded: string | null = null;
  try {
    encoded = storage.getItem(RMT_TRADE_DRAFT_RECOVERY_KEY);
    storage.removeItem(RMT_TRADE_DRAFT_RECOVERY_KEY);
  } catch {
    return undefined;
  }
  if (!encoded || !validMarketAddress(expectedMarketAddress)) return undefined;
  try {
    const value = JSON.parse(encoded) as Partial<RmtTradeDraftRecovery>;
    if (!validMarketAddress(value.marketAddress)
      || value.marketAddress.toLowerCase() !== expectedMarketAddress.toLowerCase()
      || !validAmount(value.amount)
      || (value.side !== "buy" && value.side !== "sell")
      || !Number.isSafeInteger(value.savedAtMs)
      || value.savedAtMs! > nowMs + 5_000
      || nowMs - value.savedAtMs! > RMT_TRADE_DRAFT_RECOVERY_MAX_AGE_MS) return undefined;
    return {
      amount: value.amount,
      buyInputKey: boundedKey(value.buyInputKey),
      marketAddress: value.marketAddress,
      savedAtMs: value.savedAtMs!,
      sellOutputKey: boundedKey(value.sellOutputKey),
      side: value.side
    };
  } catch {
    return undefined;
  }
}
