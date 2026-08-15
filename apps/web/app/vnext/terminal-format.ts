const PRICE_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const COMPACT_USD_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function formatTerminalPrice(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "$0";
  if (value >= 1) return PRICE_FORMAT.format(value);
  if (value >= 0.01) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

export function formatTerminalCompactUsd(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "$0";
  return COMPACT_USD_FORMAT.format(value);
}

export function formatTerminalPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized > 0 ? "+" : normalized < 0 ? "−" : ""}${Math.abs(normalized).toFixed(1)}%`;
}

export function formatTerminalAge(ageMinutes: number | null) {
  if (ageMinutes === null || !Number.isFinite(ageMinutes) || ageMinutes < 0) return "—";
  if (ageMinutes < 60) return `${Math.max(1, Math.floor(ageMinutes))}m`;
  if (ageMinutes < 1_440) return `${Math.floor(ageMinutes / 60)}h`;
  if (ageMinutes < 43_800) return `${Math.floor(ageMinutes / 1_440)}d`;
  return `${Math.floor(ageMinutes / 43_800)}mo`;
}
