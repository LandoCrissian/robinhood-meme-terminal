const MAX_EXTERNAL_URL_LENGTH = 500;

export type ExternalSocialNavigationKind = "x" | "telegram" | "discord" | "farcaster";

const EXTERNAL_SOCIAL_HOSTS: Record<ExternalSocialNavigationKind, ReadonlySet<string>> = {
  x: new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]),
  telegram: new Set(["t.me", "telegram.me", "www.telegram.me"]),
  discord: new Set(["discord.gg", "discord.com", "www.discord.com"]),
  farcaster: new Set(["warpcast.com", "www.warpcast.com", "farcaster.xyz", "www.farcaster.xyz"])
};

function privateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 0 || first === 10 || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19));
}

function privateDevelopmentHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || host.endsWith(".internal") || host === "test" || host.endsWith(".test")
    || host === "invalid" || host.endsWith(".invalid") || host === "example" || host.endsWith(".example")
    || host === "::1" || /^f[cd][0-9a-f]*:/i.test(host) || /^fe[89ab][0-9a-f]*:/i.test(host)
    || (host.startsWith("::ffff:") && privateIpv4(host.slice(7))) || privateIpv4(host);
}

export function safeExternalNavigationUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_EXTERNAL_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || privateDevelopmentHost(url.hostname)) return null;
    return url.href.length <= MAX_EXTERNAL_URL_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}

export function safeExternalSocialNavigationUrl(value: unknown, kind: ExternalSocialNavigationKind) {
  const safe = safeExternalNavigationUrl(value);
  if (!safe) return null;
  return EXTERNAL_SOCIAL_HOSTS[kind].has(new URL(safe).hostname.toLowerCase()) ? safe : null;
}
