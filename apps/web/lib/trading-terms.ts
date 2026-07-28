export const TRADING_TERMS_VERSION = "2026-07-28";
export const TRADING_TERMS_STORAGE_KEY = "rmt:trading-terms";
export const TRADING_TERMS_EVENT = "rmt:trading-terms-change";

type TradingTermsAcceptance = {
  version: string;
  acceptedAt: string;
};

export function parseTradingTermsAcceptance(value: string | null) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as Partial<TradingTermsAcceptance>;
    return parsed.version === TRADING_TERMS_VERSION
      && typeof parsed.acceptedAt === "string"
      && Number.isFinite(Date.parse(parsed.acceptedAt));
  } catch {
    return false;
  }
}

export function tradingTermsAcceptanceRecord(now = new Date()) {
  return JSON.stringify({
    version: TRADING_TERMS_VERSION,
    acceptedAt: now.toISOString()
  } satisfies TradingTermsAcceptance);
}
