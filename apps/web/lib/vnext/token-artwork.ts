const TRUSTED_TOKEN_ARTWORK_HOSTS = new Set([
  "assets.coingecko.com",
  "cdn.dexscreener.com",
  "coin-images.coingecko.com"
]);

export const RMT_TOKEN_ARTWORK = "/brand/rmt-master-logo.png";

export function safeTokenArtworkUrl(value: unknown) {
  const text = typeof value === "string" ? value.trim().slice(0, 500) : "";
  if (!text) return null;
  if (text === RMT_TOKEN_ARTWORK) return text;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && TRUSTED_TOKEN_ARTWORK_HOSTS.has(url.hostname.toLowerCase())
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
