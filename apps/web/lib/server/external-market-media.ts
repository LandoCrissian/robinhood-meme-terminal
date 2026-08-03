export function safeDexImageUri(value: unknown) {
  const text = typeof value === "string" ? value.trim().slice(0, 500) : "";
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && [
      "cdn.dexscreener.com",
      "assets.coingecko.com",
      "coin-images.coingecko.com"
    ].includes(url.hostname.toLowerCase())
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
