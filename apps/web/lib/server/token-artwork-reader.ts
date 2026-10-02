import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { projectsForContract } from "@rmt/shared/project-identity";
import { geckoPresentationReader, geckoTokenUrl, parseTokenVisual } from "./gecko-presentation-reader";
import { safeTokenArtworkUrl } from "../vnext/token-artwork";
import { readLaunchIntelligence } from "./launch-intelligence-reader";

const MAX_BYTES = 1024 * 1024;
export function publicArtworkIp(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  // Only global-unicast IPv6; exclude documentation, Teredo and 6to4 addresses
  // that could encode or tunnel a private IPv4 destination.
  if (isIP(address) !== 6) return false;
  const parts = address.split(":");
  const first = parseInt(parts[0], 16), second = parts[1] ? parseInt(parts[1], 16) : 0;
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && !(first === 0x2001 && [0, 0xdb8].includes(second));
}
export function artworkMediaType(bytes: Buffer, contentType: string) {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const valid = type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : type === "image/gif" ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))
        : type === "image/webp" ? bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
          : type === "image/avif" ? bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(bytes.subarray(8, 12).toString("ascii")) : false;
  return valid ? type : null;
}
export function artworkUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.href.length > 500 || url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) throw new Error("Unsupported artwork URL.");
  return url;
}

/** Resolve and pin a public destination before EACH hop. HTTPS only, two redirects,
 * one deadline, raster signatures and byte bounds. No SVG/HTML or open URL proxy. */
export async function fetchPublicArtwork(value: string, resolve = lookup, transport = request): Promise<{ bytes: Buffer; type: string }> {
  const deadline = Date.now() + 3_000;
  let url = artworkUrl(value);
  for (let hop = 0; hop <= 2; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Artwork deadline.");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      resolve(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Artwork DNS deadline.")), remaining); })
    ]).finally(() => clearTimeout(timeout));
    if (!addresses.length || addresses.some(item => !publicArtworkIp(item.address))) throw new Error("Nonpublic artwork destination.");
    const destination = addresses[0];
    const result = await new Promise<{ redirect: string } | { bytes: Buffer; type: string }>((resolveRead, reject) => {
      const req = transport(url, { agent: false, family: destination.family, lookup: (_host, _options, callback) => callback(null, destination.address, destination.family), headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          const location = response.headers.location; response.destroy();
          if (!location) reject(new Error("Missing artwork redirect.")); else resolveRead({ redirect: new URL(location, url).href });
          return;
        }
        if (response.statusCode !== 200 || Number(response.headers["content-length"]) > MAX_BYTES) { response.destroy(); reject(new Error("Artwork unavailable.")); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) { response.destroy(); reject(new Error("Artwork too large.")); } else chunks.push(chunk); });
        response.on("error", reject);
        response.on("end", () => { const bytes = Buffer.concat(chunks); const type = artworkMediaType(bytes, String(response.headers["content-type"] ?? "")); if (!type) reject(new Error("Unsupported artwork content.")); else resolveRead({ bytes, type }); });
      });
      const timer = setTimeout(() => req.destroy(new Error("Artwork deadline.")), Math.max(1, deadline - Date.now()));
      req.on("close", () => clearTimeout(timer)); req.on("error", reject); req.end();
    });
    if ("bytes" in result) return result;
    if (hop === 2) throw new Error("Artwork redirect limit.");
    url = artworkUrl(result.redirect);
  }
  throw new Error("Artwork unavailable.");
}

export function createArtworkCache(load = fetchPublicArtwork, now = Date.now) {
  const cache = new Map<string, { value: Awaited<ReturnType<typeof load>>; at: number }>();
  const pending = new Map<string, Promise<Awaited<ReturnType<typeof load>> | null>>();
  const failed = new Map<string, number>();
  return async (url: string) => {
    const cached = cache.get(url);
    if (cached && now() - cached.at < 3_600_000) return cached.value;
    if ((failed.get(url) ?? 0) > now()) return cached && now() - cached.at < 86_400_000 ? cached.value : null;
    if (pending.has(url)) return pending.get(url)!;
    if (pending.size >= 4) return null;
    const work = load(url).then(value => { cache.delete(url); cache.set(url, { value, at: now() }); if (cache.size > 32) cache.delete(cache.keys().next().value!); failed.delete(url); return value; }).catch(() => { failed.set(url, now() + 60_000); if (failed.size > 96) failed.delete(failed.keys().next().value!); return cached && now() - cached.at < 86_400_000 ? cached.value : null; });
    pending.set(url, work); try { return await work; } finally { pending.delete(url); }
  };
}
const readArtwork = createArtworkCache();
export async function tokenArtwork(contract: string, legacy: string | null, launch = false) {
  const project = projectsForContract(contract).find(item => item.artwork !== null)?.artwork;
  // A legacy hint is restricted to already-supported public provider hosts. It
  // confers no identity/project authority and causes no DexScreener API lookup.
  const existing = legacy && safeTokenArtworkUrl(legacy)?.startsWith("https:") ? legacy : null;
  for (const candidate of [...new Set([project?.url, existing].filter((value): value is string => Boolean(value)))]) {
    const image = await readArtwork(candidate); if (image) return image;
  }
  if (launch) {
    const indexed=await readLaunchIntelligence({token:contract,limit:10},{timeoutMs:500});
    for (const candidate of [...new Set(indexed.entries.map(e=>e.identity.artwork).filter((v):v is string=>!!v))].slice(0,2)) {
      const uri=candidate.toLowerCase().startsWith("ipfs://")?`https://ipfs.io/ipfs/${candidate.slice(7).replace(/^ipfs\//i, "")}`:candidate;
      const image=await readArtwork(uri);if(image)return image;
    }
  }
  const visual = await geckoPresentationReader.read(geckoTokenUrl(contract, "info"), value => parseTokenVisual(value, contract), 15 * 60_000, 86_400_000).catch(() => null);
  return visual?.data.image ? readArtwork(visual.data.image) : null;
}
