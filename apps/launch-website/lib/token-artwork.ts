import { hexToBytes, sha256 } from "viem";

export const artworkOrigin = "https://www.rmtlaunch.fun";
export const artworkLimit = 2 * 1024 * 1024;
export const pixelLimit = 16_000_000;
export const cidPattern = /^bafkrei[a-z2-7]{52}$/;
export type ArtworkReceipt = { projectURI: string; artworkURL: string };
export function assetPath(cid: string, file: "metadata.json" | "image.webp" | "logo.webp") {
  if (!cidPattern.test(cid)) throw new Error("Invalid artwork identifier.");
  return "/api/artwork/" + cid + "/" + file;
}
export function assetCID(uri: unknown, file: "metadata.json" | "image.webp") {
  if (typeof uri !== "string") return;
  const cid = uri.split("/")[5];
  if (cidPattern.test(cid) && uri === artworkOrigin + assetPath(cid, file)) return cid;
}
// CIDv1, raw codec, SHA2-256 multihash, unpadded lowercase base32.
export function artworkCID(bytes: Uint8Array) {
  const digest = hexToBytes(sha256(bytes));
  let result = "b", buffer = 0, bits = 0;
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  for (const byte of [1, 0x55, 0x12, 32, ...digest]) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(buffer >>> bits) & 31]; }
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}
export function artworkProof(origin: string, wallet: string, cid: string, time: number) {
  return ["Save public token artwork to " + origin, "Account: " + wallet.toLowerCase(), "Chain ID: 4663",
    "File CID: " + cid, "Valid until: " + new Date(time + 300_000).toISOString(),
    "This message authorizes storage of this image only. No transaction or spending authority."].join("\n");
}

export function inspectArtwork(b: Uint8Array, mime: string) {
  if (!b.length || b.length > artworkLimit) throw new Error("Choose an image up to 2 MiB.");
  const dimensions = stillRasterDimensions(b, mime);
  if (dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > pixelLimit)
    throw new Error("Use an image up to 16 megapixels and 8192 pixels per side.");
  return dimensions;
}

export function stillRasterDimensions(b: Uint8Array, mime: string) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (i: number) => String.fromCharCode(...b.subarray(i, i + 4));
  let w = 0, h = 0;
  if (mime === "image/png" && b.length >= 33 && v.getUint32(0) === 0x89504e47 &&
      v.getUint32(4) === 0x0d0a1a0a && tag(12) === "IHDR" && v.getUint32(8) === 13) {
    w = v.getUint32(16); h = v.getUint32(20);
    let ended = false, hasPixels = false, chunks = 0;
    for (let offset = 8; offset + 12 <= b.length;) {
      if (++chunks > 65_536) throw new Error("This PNG contains too many chunks.");
      const length = v.getUint32(offset), name = tag(offset + 4);
      if (name === "acTL") throw new Error("Choose a still image.");
      if (name === "IDAT" && length > 0) hasPixels = true;
      offset += length + 12;
      if (name === "IEND" && length === 0 && offset === b.length) { ended = true; break; }
      if (offset + 12 > b.length) throw new Error("Incomplete PNG image.");
    }
    if (!ended || !hasPixels) throw new Error("Incomplete PNG image.");
  } else if (mime === "image/jpeg" && b.length >= 12 && v.getUint16(0) === 0xffd8 && v.getUint16(b.length - 2) === 0xffd9) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      if (i + 3 > b.length) break;
      const marker = b[i++], length = v.getUint16(i);
      if (length < 2 || i + length > b.length) break;
      if ([0xc0,0xc1,0xc2].includes(marker) && length >= 8) { h = v.getUint16(i + 3); w = v.getUint16(i + 5); break; }
      i += length;
    }
  } else if (mime === "image/webp" && b.length >= 30 && tag(0) === "RIFF" && tag(8) === "WEBP" && v.getUint32(4,true) === b.length - 8) {
    if (tag(12) === "VP8X" && (b[20] & 2)) throw new Error("Choose a still image.");
    if (tag(12) === "VP8X") {
      w = 1 + b[24] + (b[25]<<8) + (b[26]<<16); h = 1 + b[27] + (b[28]<<8) + (b[29]<<16);
    } else if (tag(12) === "VP8L" && b[20] === 0x2f) {
      const size = v.getUint32(21,true); w = 1 + (size & 16383); h = 1 + ((size >>> 14) & 16383);
    } else if (tag(12) === "VP8 " && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) {
      w = v.getUint16(26,true) & 16383; h = v.getUint16(28,true) & 16383;
    }
  }
  if (!w || !h) throw new Error("Choose a valid, still PNG, JPEG or WebP image.");
  return { width: w, height: h };
}
export async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit = artworkLimit) {
  if (!body) throw new Error("Missing image.");
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error("Choose an image up to 2 MiB."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) { result.set(chunk,pos); pos += chunk.length; }
  return result;
}

export function receiptForImage(artworkURL: string): ArtworkReceipt {
  if (!assetCID(artworkURL,"image.webp")) throw new Error("Use a saved RMT Launch image URL.");
  const cid = artworkCID(new TextEncoder().encode(JSON.stringify({image:artworkURL})));
  return {projectURI:artworkOrigin + assetPath(cid,"metadata.json"),artworkURL};
}

// Re-read both public resources before associating either a new upload or a manually entered URL.
export async function verifyArtworkReceipt(receipt: ArtworkReceipt, signal: AbortSignal) {
  const metadata = assetCID(receipt.projectURI,"metadata.json"), image = assetCID(receipt.artworkURL,"image.webp");
  if (!metadata || !image) throw new Error("Invalid artwork receipt.");
  const load = async (path: string, expected: string, limit: number, mime: string) => {
    const response = await fetch(path,{cache:"no-store",redirect:"error",signal});
    if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== mime) throw new Error("Saved artwork could not be retrieved. Retry.");
    const bytes = await boundedBytes(response.body,limit);
    if (artworkCID(bytes) !== expected) throw new Error("Stored artwork failed verification.");
    return bytes;
  };
  const document = await load(assetPath(metadata,"metadata.json"),metadata,512,"application/json");
  if (JSON.parse(new TextDecoder().decode(document)).image !== receipt.artworkURL) throw new Error("Metadata image did not match.");
  await load(assetPath(image,"image.webp"),image,artworkLimit,"image/webp");
}
