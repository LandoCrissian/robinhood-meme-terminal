const IPFS_IMAGE_GATEWAY = "https://ipfs.io/ipfs/";
const MAX_PUBLIC_IMAGE_BYTES = 1024 * 1024;
const SAFE_IPFS_PATH = /^[a-zA-Z0-9/_-]{20,240}$/;
const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function fetchPublicMarketImageDataUri(uri: string | null | undefined) {
  if (!uri?.startsWith("ipfs://")) return null;
  const path = uri.slice("ipfs://".length);
  if (!SAFE_IPFS_PATH.test(path)) return null;

  try {
    const response = await fetch(`${IPFS_IMAGE_GATEWAY}${path}`, {
      cache: "force-cache",
      redirect: "error",
      signal: AbortSignal.timeout(4_000)
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
    if (!SAFE_IMAGE_TYPES.has(contentType)) return null;
    const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PUBLIC_IMAGE_BYTES) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PUBLIC_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const image = Buffer.concat(chunks);
    return `data:${contentType};base64,${image.toString("base64")}`;
  } catch {
    return null;
  }
}
