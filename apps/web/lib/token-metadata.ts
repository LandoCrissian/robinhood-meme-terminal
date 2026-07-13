export type TokenMetadata = { name?: string; symbol?: string; description?: string; image?: string; website?: string; x?: string; telegram?: string };

const gateway = process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.io/ipfs/";

export function ipfsToHttp(uri: string) {
  return uri.startsWith("ipfs://") ? `${gateway.replace(/\/$/, "")}/${uri.slice(7)}` : uri;
}

function safeMetadata(value: unknown): TokenMetadata | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const text = (key: string) => typeof source[key] === "string" ? source[key] as string : undefined;
  const image = text("image");
  const secureLink = (key: string) => { const value = text(key); return value?.startsWith("https://") ? value.slice(0, 500) : undefined; };
  return { name: text("name")?.slice(0, 80), symbol: text("symbol")?.slice(0, 20), description: text("description")?.slice(0, 1_000), image: image && (image.startsWith("ipfs://") || image.startsWith("https://")) ? image : undefined, website: secureLink("website"), x: secureLink("x"), telegram: secureLink("telegram") };
}

export async function resolveTokenMetadata(uri: string): Promise<TokenMetadata | null> {
  try {
    if (uri.startsWith("data:application/json,")) return safeMetadata(JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length))));
    if (!uri.startsWith("ipfs://") && !uri.startsWith("https://")) return null;
    const response = await fetch(ipfsToHttp(uri), { cache: "force-cache", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    return safeMetadata(await response.json());
  } catch { return null; }
}
