export function safeDexImageUri(value: unknown) {
  const text = typeof value === "string" ? value.trim().slice(0, 500) : "";
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname === "cdn.dexscreener.com"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
