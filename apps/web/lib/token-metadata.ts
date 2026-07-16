export type TokenMetadata = { name?: string; symbol?: string; description?: string; image?: string; website?: string; x?: string; telegram?: string };

const gateway = process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://ipfs.io/ipfs/";
const MAX_METADATA_BYTES = 128 * 1024;

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
    if (uri.startsWith("data:application/json,")) {
      if (uri.length > MAX_METADATA_BYTES) return null;
      return safeMetadata(JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length))));
    }
    const isIpfs = uri.startsWith("ipfs://");
    const isBrowserHttps = typeof window !== "undefined" && uri.startsWith("https://");
    // Permissionless launch metadata must never make the RMT server request an
    // arbitrary creator-controlled HTTPS host. Server enrichment is IPFS-only.
    if (!isIpfs && !isBrowserHttps) return null;
    const response = await fetch(ipfsToHttp(uri), {
      cache: "force-cache",
      redirect: typeof window === "undefined" ? "error" : "follow",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) return null;
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_METADATA_BYTES) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("json") && !contentType.includes("text/plain") && !contentType.includes("octet-stream")) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_METADATA_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return safeMetadata(JSON.parse(text));
  } catch { return null; }
}
