const TRUSTED_TOKEN_ARTWORK_HOSTS = new Set([
  "assets.coingecko.com",
  "cdn.dexscreener.com",
  "coin-images.coingecko.com"
]);

export const RMT_TOKEN_ARTWORK = "/brand/rmt-master-logo.png";

export function safeTokenArtworkUrl(value: unknown) {
  const text = typeof value === "string" && value.length <= 1500 ? value.trim() : "";
  if (!text) return null;
  if (text === RMT_TOKEN_ARTWORK) return text;
  if (/^\/api\/vnext\/token-artwork\?address=0x[0-9a-fA-F]{40}(?:&legacy=[^#\s&]*)?(?:&revision=\d+)?$/.test(text)) return text;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && TRUSTED_TOKEN_ARTWORK_HOSTS.has(url.hostname.toLowerCase())
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
